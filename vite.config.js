import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// После сборки вписывает список файлов в sw.js, чтобы игра работала офлайн.
function swPrecache() {
  let outDir;
  return {
    name: 'sw-precache',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = [];
      const walk = (dir) => {
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name);
          if (fs.statSync(full).isDirectory()) walk(full);
          else files.push(path.relative(outDir, full).split(path.sep).join('/'));
        }
      };
      walk(outDir);
      const list = ['./', ...files.filter((f) => f !== 'sw.js').map((f) => './' + f)];
      const swPath = path.join(outDir, 'sw.js');
      const sw = fs
        .readFileSync(swPath, 'utf8')
        .replace('self.__PRECACHE__', JSON.stringify(list))
        .replace('__VERSION__', Date.now().toString(36));
      fs.writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [swPrecache()],
  build: { target: 'es2020', chunkSizeWarningLimit: 2000 },
});
