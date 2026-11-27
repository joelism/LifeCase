import PostalMime from 'postal-mime';
import { MAX_FILE, sha256, today } from './model.js';

function plainText(html) {
  return String(html ?? '').replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6]|tr)\s*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g, entity => ({
      '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'",
    })[entity]).trim();
}

export async function readMailFile(file) {
  const invalid = () => Object.assign(new Error(), { userMessage: 'Wähle eine gültige .eml-Datei mit höchstens 25 MB aus.' });
  if (!file || !file.name.toLowerCase().endsWith('.eml') || file.size > MAX_FILE || file.size === 0) throw invalid();
  let parsed;
  try { parsed = await PostalMime.parse(await file.arrayBuffer()); } catch { throw invalid(); }
  if (!parsed?.headers?.some(header => ['subject', 'from', 'date', 'message-id'].includes(header.key))) throw invalid();
  const timestamp = new Date(parsed.date ?? '');
  const date = Number.isFinite(timestamp.getTime()) ? timestamp : new Date();
  const files = new Map([['', new Blob([file], { type: 'message/rfc822' })]]);
  const attachments = parsed.attachments.map((item, index) => {
    const id = String(index);
    const blob = new Blob([item.content], { type: item.mimeType || 'application/octet-stream' });
    files.set(id, blob);
    return { id, name: item.filename || 'Anhang ' + (index + 1), size: blob.size };
  });
  return { files, mail: { provider: 'local', filename: file.name, key: await sha256(file), day: today(date), date: date.toISOString(),
    subject: parsed.subject || '(Ohne Betreff)', sender: [parsed.from?.name, parsed.from?.address].filter(Boolean).join(' · '),
    text: (parsed.text || plainText(parsed.html)).slice(0, 24000), attachments } };
}
