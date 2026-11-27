import { openHealthExport, summarizeHealthExport } from './health-data.js';

self.onmessage = async ({ data }) => {
  try {
    const xml = await openHealthExport(data.file);
    self.postMessage({ groups: summarizeHealthExport(xml, data.from, data.through) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Die Datei konnte nicht gelesen werden.' });
  }
};
