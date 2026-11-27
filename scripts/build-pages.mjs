import { copyFile, cp, rm, writeFile } from 'node:fs/promises';

await rm('site-assets', { recursive: true, force: true });
await cp('dist/site-assets', 'site-assets', { recursive: true });
for (const file of ['index.html', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']) {
  await copyFile('dist/' + file, file);
}
await writeFile('.nojekyll', '');
