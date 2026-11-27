import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: ['safari16.4', 'chrome110', 'firefox115'] },
  plugins: [{
    name: 'lifecase-offline-shell',
    apply: 'build',
    async closeBundle() {
      const assets = (await readdir('dist/assets')).sort().map(name => './assets/' + name);
      const paths = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', ...assets];
      const worker = await readFile('public/sw.js', 'utf8');
      const html = await readFile('dist/index.html');
      const hash = createHash('sha256').update(worker).update(html).update(paths.join('\n')).digest('hex').slice(0, 16);
      await writeFile('dist/sw.js', worker.replace('__LIFECASE_CACHE__', 'lifecase-shell-' + hash).replace('__LIFECASE_FILES__', JSON.stringify(paths)));
    },
  }],
});
