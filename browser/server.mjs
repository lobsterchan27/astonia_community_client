import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const nativeArtifactPaths = new Set([
  resolve(rootDir, './dist/astonia-client.js'),
  resolve(rootDir, './dist/astonia-client.wasm'),
  resolve(rootDir, './dist/astonia-client.data')
]);
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.data', 'application/octet-stream'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.worker.js', 'text/javascript; charset=utf-8']
]);

function getOption(name, fallback) {
  const prefix = `${name}=`;
  const index = process.argv.indexOf(name);

  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }

  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

const host = getOption('--host', '127.0.0.1');
const port = Number.parseInt(getOption('--port', '5173'), 10);

function send(res, statusCode, message) {
  res.writeHead(statusCode, secureHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
  res.end(message);
}

function secureHeaders(headers = {}) {
  return {
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...headers
  };
}

function isInsideDirectory(filePath, directory) {
  const directoryPrefix = directory.endsWith(sep) ? directory : `${directory}${sep}`;
  return filePath === directory || filePath.startsWith(directoryPrefix);
}

function toFilePath(requestUrl) {
  const url = new URL(requestUrl, `http://${host}:${port}`);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const decodedPathname = decodeURIComponent(pathname);

  if (!decodedPathname.startsWith('/src/') && !decodedPathname.startsWith('/dist/') && decodedPathname !== '/index.html') {
    return null;
  }

  const filePath = resolve(rootDir, `.${decodedPathname}`);
  return isInsideDirectory(filePath, rootDir) ? filePath : null;
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed');
    return;
  }

  let filePath;
  try {
    filePath = toFilePath(req.url ?? '/');
  } catch {
    send(res, 400, 'Bad request');
    return;
  }

  if (!filePath) {
    send(res, 403, 'Forbidden');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      send(res, 404, 'Not found');
      return;
    }

    const ext = filePath.endsWith('.worker.js') ? '.worker.js' : extname(filePath);
    res.writeHead(
      200,
      secureHeaders({
        'Content-Type': contentTypes.get(ext) ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Content-Length': fileStat.size
      })
    );

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    createReadStream(filePath).pipe(res);
  } catch {
    if (req.method === 'HEAD' && nativeArtifactPaths.has(filePath)) {
      res.writeHead(
        204,
        secureHeaders({
          'Cache-Control': 'no-store',
          'X-Astonia-Artifact-Missing': '1',
          'X-Astonia-Module-Missing': '1'
        })
      );
      res.end();
      return;
    }

    send(res, 404, 'Not found');
  }
});

server.listen(port, host, () => {
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  console.log(`Astonia WASM/WebGPU host running at http://${host}:${boundPort}/`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
