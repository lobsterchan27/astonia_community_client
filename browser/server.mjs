import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const assetDir = resolve(rootDir, '..', 'res');
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.zip', 'application/zip']
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

function isInsideDirectory(filePath, directory) {
  const directoryPrefix = directory.endsWith(sep) ? directory : `${directory}${sep}`;
  return filePath.startsWith(directoryPrefix);
}

function toFilePath(requestUrl) {
  const url = new URL(requestUrl, `http://${host}:${port}`);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const decodedPathname = decodeURIComponent(pathname);

  if (decodedPathname.startsWith('/assets/')) {
    const assetName = decodedPathname.slice('/assets/'.length);
    if (!/^[A-Za-z0-9_.-]+$/.test(assetName)) {
      return null;
    }

    const filePath = resolve(assetDir, assetName);
    return isInsideDirectory(filePath, assetDir) ? filePath : null;
  }

  const filePath = resolve(rootDir, `.${decodedPathname}`);

  return filePath.startsWith(rootDir) ? filePath : null;
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return undefined;
  }

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) {
    return undefined;
  }

  if (!rawStart) {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return undefined;
    }

    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1
    };
  }

  const start = Number.parseInt(rawStart, 10);
  const end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return undefined;
  }

  return {
    start,
    end: Math.min(end, size - 1)
  };
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

    const range = parseRange(req.headers.range, fileStat.size);
    if (range === undefined) {
      res.writeHead(416, {
        'Content-Range': `bytes */${fileStat.size}`,
        'Content-Type': 'text/plain; charset=utf-8'
      });
      res.end('Range not satisfiable');
      return;
    }

    const statusCode = range ? 206 : 200;
    const start = range?.start ?? 0;
    const end = range?.end ?? fileStat.size - 1;
    const contentLength = range ? end - start + 1 : fileStat.size;

    res.writeHead(statusCode, {
      'Content-Type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
      'Content-Length': contentLength,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${fileStat.size}` } : {})
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    createReadStream(filePath, range ? { start, end } : undefined).pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
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
