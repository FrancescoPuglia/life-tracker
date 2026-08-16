import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = 3200;
const PREFIX = '/life-tracker';
const outputRoot = resolve(fileURLToPath(new URL('../out', import.meta.url)));

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
]);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);
  if (!url.pathname.startsWith(`${PREFIX}/`) && url.pathname !== PREFIX) {
    response.writeHead(404).end('Not found');
    return;
  }
  const relativePath = decodeURIComponent(url.pathname.slice(PREFIX.length)).replace(/^\/+/, '');
  const candidates = relativePath
    ? [relativePath, `${relativePath}.html`, `${relativePath}/index.html`]
    : ['index.html'];
  const file = candidates
    .map((candidate) => resolve(outputRoot, candidate))
    .find((candidate) => (
      candidate.startsWith(`${outputRoot}${sep}`)
      && existsSync(candidate)
      && statSync(candidate).isFile()
    ));
  if (!file) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': contentTypes.get(extname(file)) ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(response);
});

server.listen(PORT, HOST);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
