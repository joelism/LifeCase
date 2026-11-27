import { Inflate } from 'fflate';

const endSignature = 0x06054b50;
const noExport = () => new Error('Die ZIP-Datei enthält keine export.xml.');
const damagedArchive = () => new Error('Die ZIP-Datei ist beschädigt oder unvollständig. Wähle den vollständigen Health-Export erneut.');
const viewOf = async (file, start, length) => new DataView(await file.slice(start, start + length).arrayBuffer());
const u16 = (view, offset) => view.getUint16(offset, true);
const u32 = (view, offset) => view.getUint32(offset, true);

const crcTable = Uint32Array.from({ length: 256 }, (_, initial) => {
  let crc = initial;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc;
});

function u64(view, offset) {
  if (offset + 8 > view.byteLength) throw damagedArchive();
  const value = Number(view.getBigUint64(offset, true));
  if (!Number.isSafeInteger(value)) throw damagedArchive();
  return value;
}

async function directoryOf(file) {
  const start = Math.max(0, file.size - 65557);
  const tail = await viewOf(file, start, file.size - start);
  let end = tail.byteLength - 22;
  while (end >= 0 && (u32(tail, end) !== endSignature || end + 22 + u16(tail, end + 20) !== tail.byteLength)) end--;
  if (end < 0 || u16(tail, end + 4) !== 0 || u16(tail, end + 6) !== 0) throw damagedArchive();
  const size = u32(tail, end + 12);
  const offset = u32(tail, end + 16);
  if (size !== 0xffffffff && offset !== 0xffffffff && u16(tail, end + 10) !== 0xffff) return { size, offset };
  const locatorOffset = start + end - 20;
  if (locatorOffset < 0) throw damagedArchive();
  const locator = await viewOf(file, locatorOffset, 20);
  if (u32(locator, 0) !== 0x07064b50 || u32(locator, 4) !== 0 || u32(locator, 16) !== 1) throw damagedArchive();
  const position = u64(locator, 8);
  if (position + 56 > locatorOffset) throw damagedArchive();
  const zip64 = await viewOf(file, position, 56);
  if (u32(zip64, 0) !== 0x06064b50 || u32(zip64, 16) !== 0 || u32(zip64, 20) !== 0) throw damagedArchive();
  return { size: u64(zip64, 40), offset: u64(zip64, 48) };
}

function entrySizes(header, extraStart, extraEnd) {
  const sizes = { original: u32(header, 24), compressed: u32(header, 20), local: u32(header, 42) };
  const extended = Object.keys(sizes).filter(key => sizes[key] === 0xffffffff);
  if (!extended.length) return sizes;
  for (let offset = extraStart; offset + 4 <= extraEnd;) {
    const tag = u16(header, offset);
    const length = u16(header, offset + 2);
    offset += 4;
    if (offset + length > extraEnd) throw damagedArchive();
    if (tag === 1 && length >= extended.length * 8) {
      extended.forEach((key, index) => { sizes[key] = u64(header, offset + index * 8); });
      return sizes;
    }
    offset += length;
  }
  throw damagedArchive();
}

async function exportEntry(file) {
  const { size, offset } = await directoryOf(file);
  const end = offset + size;
  if (!Number.isSafeInteger(end) || end > file.size) throw damagedArchive();
  const decoder = new TextDecoder();
  let blockStart = 0;
  let block = new DataView(new ArrayBuffer(0));
  async function headerAt(position, needed) {
    if (position + needed > end) throw damagedArchive();
    if (position < blockStart || position + needed > blockStart + block.byteLength) {
      block = await viewOf(file, position, Math.min(end - position, Math.max(needed, 64 * 1024)));
      blockStart = position;
    }
    return new DataView(block.buffer, position - blockStart, needed);
  }
  for (let position = offset; position < end;) {
    const header = await headerAt(position, 46);
    if (u32(header, 0) !== 0x02014b50) throw damagedArchive();
    const nameLength = u16(header, 28);
    const extraLength = u16(header, 30);
    const headerSize = 46 + nameLength + extraLength;
    const record = await headerAt(position, headerSize);
    const name = decoder.decode(new Uint8Array(record.buffer, record.byteOffset + 46, nameLength));
    position += headerSize + u16(header, 32);
    if (position > end) throw damagedArchive();
    if (!/(^|\/)export\.xml$/i.test(name)) continue;
    if (u16(header, 8) & 1) throw new Error('Wähle den unverschlüsselten ZIP-Export direkt aus Apple Health.');
    const method = u16(header, 10);
    if (method !== 0 && method !== 8) throw new Error('Dieses ZIP-Format wird nicht unterstützt. Wähle den Originalexport von Apple Health.');
    const sizes = entrySizes(record, 46 + nameLength, headerSize);
    if (sizes.local + 30 > offset || (method === 0 && sizes.original !== sizes.compressed)) throw damagedArchive();
    const local = await viewOf(file, sizes.local, 30);
    if (u32(local, 0) !== 0x04034b50 || u16(local, 8) !== method || u16(local, 6) & 1) throw damagedArchive();
    const start = sizes.local + 30 + u16(local, 26) + u16(local, 28);
    if (start > offset || sizes.compressed > offset - start) throw damagedArchive();
    return { input: file.slice(start, start + sizes.compressed), original: sizes.original, method, checksum: u32(header, 16) };
  }
  throw noExport();
}

export async function readHealthXml(file, onChunk) {
  const signature = await viewOf(file, 0, 4);
  const isZip = signature.byteLength === 4 && [0x04034b50, endSignature, 0x08074b50].includes(u32(signature, 0));
  const { input, original, method, checksum } = isZip ? await exportEntry(file) : { input: file, original: file.size, method: 0 };
  const decoder = new TextDecoder();
  let read = 0;
  let crc = 0xffffffff;
  function consume(bytes) {
    read += bytes.length;
    if (read > original) throw damagedArchive();
    if (isZip) for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024) {
      onChunk(decoder.decode(bytes.subarray(offset, offset + 512 * 1024), { stream: true }),
        (read - bytes.length + Math.min(bytes.length, offset + 512 * 1024)) / original);
    }
  }
  const blockSize = method === 8 ? 16 * 1024 : 512 * 1024;
  const inflate = method === 8 ? new Inflate(consume) : null;
  for (let offset = 0; offset < input.size; offset += blockSize) {
    const bytes = new Uint8Array(await input.slice(offset, offset + blockSize).arrayBuffer());
    if (inflate) {
      try { inflate.push(bytes, offset + bytes.length === input.size); }
      catch (error) { if (typeof error.code === 'number') throw damagedArchive(); throw error; }
    } else consume(bytes);
  }
  if (read !== original || (isZip && (~crc >>> 0) !== checksum)) throw damagedArchive();
  onChunk(decoder.decode(), 1);
}
