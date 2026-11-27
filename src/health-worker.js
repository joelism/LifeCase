import { importHealthExport } from './health-data.js';

self.onmessage = async ({ data }) => {
  try {
    let lastUpdate = -Infinity;
    const groups = await importHealthExport(data.file, data.from, data.through, progress => {
      const now = performance.now();
      if (now - lastUpdate < 200 && progress < 1) return;
      lastUpdate = now;
      self.postMessage({ progress: Math.min(100, Math.floor(progress * 100)) });
    });
    self.postMessage({ groups });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Die Datei konnte nicht gelesen werden.' });
  }
};
