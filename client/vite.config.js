import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '');
  // GitHub Pages serves the site at /<repo-name>/. The deploy workflow sets
  // BASE_PATH from the repository name; locally we default to /pfba/.
  const base = env.BASE_PATH || '/pfba/';
  return {
    root: __dirname,
    base,
    envDir: projectRoot,
    plugins: [react()],
    server: { port: Number(env.PORT) || 5173 },
    build: {
      outDir: path.join(__dirname, 'dist'),
      emptyOutDir: true,
    },
  };
});
