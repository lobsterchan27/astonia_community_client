import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8']
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
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function toFilePath(requestUrl) {
  const url = new URL(requestUrl, `http://${host}:${port}`);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const decodedPathname = decodeURIComponent(pathname);
  const filePath = resolve(rootDir, `.${decodedPathname}`);

  return filePath.startsWith(rootDir) ? filePath : null;
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
  } catch {
    send(res, 404, 'Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
    'Cache-Control': 'no-store'
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  console.log(`Astonia browser shell running at http://${host}:${boundPort}/`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
