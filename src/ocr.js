import { createWorker, PSM } from 'tesseract.js';
import workerPath from 'tesseract.js/dist/worker.min.js?url';
import { linesFromWords } from './scan-layout.js';

async function openWorker(onProgress) {
  let cancel;
  let timer;
  let expired = false;
  const timeout = new Promise((_, reject) => {
    cancel = reject;
    timer = setTimeout(() => reject(new Error('OCR initialisation timed out')), 35000);
  });
  const creating = createWorker('deu+eng', 1, {
    workerPath: new URL(workerPath, document.baseURI).href,
    workerBlobURL: false,
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
    errorHandler: error => cancel(new Error(String(error))),
    logger: entry => onProgress(entry.status === 'recognizing text' ? 0.5 + entry.progress * 0.5 : 0.35),
  });
  creating.then(worker => { if (expired) worker.terminate(); }, () => {});
  try { return await Promise.race([creating, timeout]); }
  catch (error) { expired = true; throw error; }
  finally { clearTimeout(timer); }
}

export async function readPhoto(file, plan, onProgress) {
  const worker = await openWorker(onProgress);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: plan ? PSM.SPARSE_TEXT : PSM.AUTO });
    // Resizing bounds memory on iPhone. The private attachment keeps the original bytes.
    const bitmap = typeof createImageBitmap === 'function' ? await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null) : null;
    let input = file;
    try {
      if (bitmap && Math.max(bitmap.width, bitmap.height) > 2300) {
        const ratio = 2300 / Math.max(bitmap.width, bitmap.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * ratio);
        canvas.height = Math.round(bitmap.height * ratio);
        const context = canvas.getContext('2d');
        if (context) {
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          input = await new Promise(resolve => canvas.toBlob(blob => resolve(blob ?? file), 'image/jpeg', 0.95));
        }
      }
    } finally { bitmap?.close(); }
    const { data } = await worker.recognize(input, {}, { text: true, blocks: true });
    return { text: data.text ?? '', lines: linesFromWords(data.blocks) };
  } finally {
    await worker.terminate();
  }
}
