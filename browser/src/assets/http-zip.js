const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MAX_ZIP_COMMENT_LENGTH = 0xffff;
const END_OF_CENTRAL_DIRECTORY_LENGTH = 22;

const textDecoder = new TextDecoder();

export class ZipArchiveNotFoundError extends Error {
  constructor(url) {
    super(`Zip archive not found: ${url}`);
    this.name = 'ZipArchiveNotFoundError';
    this.url = url;
  }
}

export class ZipArchive {
  constructor({ url, size, entries, fetchRange }) {
    this.url = url;
    this.size = size;
    this.#entries = entries;
    this.#entriesByName = new Map(entries.map((entry) => [entry.name, entry]));
    this.#fetchRange = fetchRange;
  }

  #entries;
  #entriesByName;
  #fetchRange;

  listEntries() {
    return this.#entries.slice();
  }

  getEntry(name) {
    return this.#entriesByName.get(name) ?? null;
  }

  hasEntry(name) {
    return this.#entriesByName.has(name);
  }

  async readEntry(name) {
    const entry = this.getEntry(name);
    if (!entry) {
      throw new Error(`Zip entry not found in ${this.url}: ${name}`);
    }

    const localHeader = await this.#fetchRange(
      entry.localHeaderOffset,
      entry.localHeaderOffset + 29
    );
    const headerView = new DataView(localHeader);

    if (headerView.getUint32(0, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`Invalid local file header for ${name} in ${this.url}`);
    }

    const nameLength = headerView.getUint16(26, true);
    const extraLength = headerView.getUint16(28, true);
    const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
    const compressedData = new Uint8Array(
      await this.#fetchRange(dataOffset, dataOffset + entry.compressedSize - 1)
    );

    if (entry.compressionMethod === 0) {
      return compressedData;
    }

    if (entry.compressionMethod === 8) {
      return inflateRawDeflate(compressedData);
    }

    throw new Error(
      `Unsupported compression method ${entry.compressionMethod} for ${name} in ${this.url}`
    );
  }
}

export async function openHttpZip(url, options = {}) {
  const fetchFn = options.fetchFn ?? fetch;
  const normalizedUrl = String(url);
  const size = await fetchContentLength(normalizedUrl, fetchFn);
  const tailLength = Math.min(size, END_OF_CENTRAL_DIRECTORY_LENGTH + MAX_ZIP_COMMENT_LENGTH);
  const tailStart = size - tailLength;
  const fetchRange = (start, end) => fetchByteRange(normalizedUrl, start, end, fetchFn);
  const tail = await fetchRange(tailStart, size - 1);
  const directory = findEndOfCentralDirectory(tail);
  const entries = await readCentralDirectory({
    directory,
    fetchRange,
    url: normalizedUrl
  });

  return new ZipArchive({
    url: normalizedUrl,
    size,
    entries,
    fetchRange
  });
}

async function fetchContentLength(url, fetchFn) {
  const response = await fetchFn(url, { method: 'HEAD' });

  if (response.status === 404) {
    throw new ZipArchiveNotFoundError(url);
  }

  if (!response.ok) {
    throw new Error(`Failed to inspect zip archive ${url}: HTTP ${response.status}`);
  }

  const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (!Number.isSafeInteger(contentLength) || contentLength < END_OF_CENTRAL_DIRECTORY_LENGTH) {
    throw new Error(`Zip archive ${url} does not expose a valid Content-Length`);
  }

  return contentLength;
}

async function fetchByteRange(url, start, end, fetchFn) {
  const response = await fetchFn(url, {
    headers: {
      Range: `bytes=${start}-${end}`
    }
  });

  if (response.status === 404) {
    throw new ZipArchiveNotFoundError(url);
  }

  if (response.status === 206) {
    return response.arrayBuffer();
  }

  if (response.status === 200) {
    const body = await response.arrayBuffer();
    return body.slice(start, end + 1);
  }

  throw new Error(`Failed to fetch byte range ${start}-${end} from ${url}: HTTP ${response.status}`);
}

function findEndOfCentralDirectory(tail) {
  const view = new DataView(tail);

  for (let offset = tail.byteLength - END_OF_CENTRAL_DIRECTORY_LENGTH; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }

    const commentLength = view.getUint16(offset + 20, true);
    if (offset + END_OF_CENTRAL_DIRECTORY_LENGTH + commentLength !== tail.byteLength) {
      continue;
    }

    const diskNumber = view.getUint16(offset + 4, true);
    const centralDirectoryDisk = view.getUint16(offset + 6, true);
    if (diskNumber !== 0 || centralDirectoryDisk !== 0) {
      throw new Error('Multi-disk zip archives are not supported');
    }

    const entryCount = view.getUint16(offset + 10, true);
    const centralDirectorySize = view.getUint32(offset + 12, true);
    const centralDirectoryOffset = view.getUint32(offset + 16, true);

    if (
      entryCount === 0xffff ||
      centralDirectorySize === 0xffffffff ||
      centralDirectoryOffset === 0xffffffff
    ) {
      throw new Error('Zip64 archives are not supported');
    }

    return {
      centralDirectoryOffset,
      centralDirectorySize,
      entryCount
    };
  }

  throw new Error('End of central directory record was not found');
}

async function readCentralDirectory({ directory, fetchRange, url }) {
  const centralDirectory = await fetchRange(
    directory.centralDirectoryOffset,
    directory.centralDirectoryOffset + directory.centralDirectorySize - 1
  );
  const view = new DataView(centralDirectory);
  const entries = [];
  let recordCount = 0;
  let offset = 0;

  while (offset < centralDirectory.byteLength) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
      throw new Error(`Invalid central directory header in ${url} at offset ${offset}`);
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const crc32 = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const name = textDecoder.decode(new Uint8Array(centralDirectory, nameStart, nameLength));
    recordCount += 1;

    if (!name.endsWith('/')) {
      entries.push(
        Object.freeze({
          name,
          compressionMethod,
          compressedSize,
          uncompressedSize,
          crc32,
          localHeaderOffset
        })
      );
    }

    offset = nameEnd + extraLength + commentLength;
  }

  if (recordCount !== directory.entryCount) {
    throw new Error(
      `Central directory entry count mismatch in ${url}: expected ${directory.entryCount}, read ${recordCount}`
    );
  }

  return entries;
}

async function inflateRawDeflate(compressedData) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Deflated zip entries require browser DecompressionStream support');
  }

  const stream = new Blob([compressedData])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}
