import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

// SQLite's WebAssembly binary (used by lib/localdb.js), served at a fixed
// path next to the app: from node_modules in dev, copied into the build for
// production. Vite's own /@fs/ URLs break when the project path contains
// characters like "&" or "'".
const SQL_WASM = path.join(projectRoot, 'node_modules/sql.js/dist/sql-wasm.wasm');
const SQL_WASM_NAME = `sql-wasm-${JSON.parse(fs.readFileSync(path.join(projectRoot, 'node_modules/sql.js/package.json'))).version}.wasm`;
function sqlWasm(base) {
  return {
    name: 'sql-wasm',
    config: () => ({ define: { __SQL_WASM__: JSON.stringify(base + SQL_WASM_NAME) } }),
    configureServer(server) {
      server.middlewares.use(base + SQL_WASM_NAME, (req, res) => {
        res.setHeader('Content-Type', 'application/wasm');
        fs.createReadStream(SQL_WASM).pipe(res);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: SQL_WASM_NAME, source: fs.readFileSync(SQL_WASM) });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '');
  // GitHub Pages serves the site at /<repo-name>/. The deploy workflow sets
  // BASE_PATH from the repository name; locally we default to /pfba/.
  const base = env.BASE_PATH || '/pfba/';
  return {
    root: __dirname,
    base,
    envDir: projectRoot,
    plugins: [react(), sqlWasm(base)],
    server: { port: Number(env.PORT) || 5173 },
    build: {
      outDir: path.join(__dirname, 'dist'),
      emptyOutDir: true,
    },
  };
});
