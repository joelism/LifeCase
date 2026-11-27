import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  root: 'web',
  publicDir: '../public',
  build: {
    outDir: '../dist', emptyOutDir: true, assetsDir: 'site-assets', target: ['safari16.4', 'chrome110', 'firefox115'],
    rolldownOptions: {
      output: {
        entryFileNames: 'app.js',
        assetFileNames: asset => asset.names.includes('index.css') ? 'styles.css' : 'site-assets/[name]-[hash][extname]',
      },
    },
  },
  plugins: [{
    name: 'lifecase-offline-shell',
    apply: 'build',
    async closeBundle() {
      const assets = (await readdir('dist/site-assets')).sort().map(name => './site-assets/' + name);
      const [worker, html, app, css] = await Promise.all([
        readFile('public/sw.js', 'utf8'), readFile('dist/index.html', 'utf8'),
        readFile('dist/app.js'), readFile('dist/styles.css'),
      ]);
      const release = createHash('sha256').update(worker).update(html).update(app).update(css).update(assets.join('\n')).digest('hex').slice(0, 16);
      const entry = ['./app.js', './styles.css'];
      const entryUrls = entry.map(path => path + '?v=' + release);
      const paths = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', ...entryUrls, ...assets];
      await Promise.all([
        writeFile('dist/index.html', entry.reduce((result, path, index) => result.replace('"' + path + '"', '"' + entryUrls[index] + '"'), html)),
        writeFile('dist/sw.js', worker.replace('__LIFECASE_CACHE__', 'lifecase-shell-' + release).replace('__LIFECASE_FILES__', JSON.stringify(paths))),
      ]);
    },
  }],
});
