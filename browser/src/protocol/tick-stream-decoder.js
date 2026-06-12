export class AstoniaTickStreamDecoder {
  #buffer;
  #streamOffset;
  #inflateReader;
  #inflateWriter;

  constructor() {
    this.#buffer = new Uint8Array(0);
    this.#streamOffset = 0;
    this.#inflateReader = null;
    this.#inflateWriter = null;
  }

  async pushChunk(chunk) {
    const bytes = toUint8Array(chunk);
    this.#buffer = concatBytes(this.#buffer, bytes);

    const ticks = [];
    while (this.#buffer.length > 0) {
      const header = readTickHeader(this.#buffer);
      if (!header) {
        break;
      }

      const framedPayload = this.#buffer.subarray(header.headerLength, header.totalLength);
      const payload = header.compressed
        ? await this.#inflatePayload(framedPayload)
        : copyBytes(framedPayload);
      ticks.push({
        header: header.header,
        compressed: header.compressed,
        rawLength: header.totalLength,
        compressedLength: header.compressed ? framedPayload.length : undefined,
        payload,
        streamOffset: this.#streamOffset
      });

      this.#buffer = this.#buffer.subarray(header.totalLength);
      this.#streamOffset += header.totalLength;
    }

    return ticks;
  }

  async #inflatePayload(compressedPayload) {
    if (compressedPayload.length === 0) {
      return new Uint8Array(0);
    }

    this.#ensureInflater();
    const inflatedTick = this.#inflateReader.read();
    await this.#inflateWriter.write(copyBytes(compressedPayload));

    const result = await inflatedTick;
    if (result.done) {
      throw new Error('Compressed Astonia tick ended the zlib stream unexpectedly');
    }

    return copyBytes(result.value);
  }

  #ensureInflater() {
    if (this.#inflateReader && this.#inflateWriter) {
      return;
    }

    if (typeof DecompressionStream !== 'function') {
      throw new Error('Compressed Astonia ticks require browser DecompressionStream support');
    }

    const stream = new DecompressionStream('deflate');
    this.#inflateReader = stream.readable.getReader();
    this.#inflateWriter = stream.writable.getWriter();
  }
}

function readTickHeader(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xff) {
    if (buffer.length < 4) {
      return null;
    }

    const payloadLength = readUInt16BE(buffer, 2);
    const totalLength = 4 + payloadLength;
    if (buffer.length < totalLength) {
      return null;
    }

    return {
      header: 'big',
      compressed: false,
      headerLength: 4,
      totalLength
    };
  }

  if (buffer.length === 1 && buffer[0] === 0xff) {
    return null;
  }

  if ((buffer[0] & 0x40) !== 0) {
    const payloadLength = buffer[0] & 0x3f;
    const totalLength = 1 + payloadLength;
    if (buffer.length < totalLength) {
      return null;
    }

    return {
      header: 'small',
      compressed: (buffer[0] & 0x80) !== 0,
      headerLength: 1,
      totalLength
    };
  }

  if (buffer.length < 2) {
    return null;
  }

  const payloadLength = readUInt16BE(buffer, 0) & 0x3fff;
  const totalLength = 2 + payloadLength;
  if (buffer.length < totalLength) {
    return null;
  }

  return {
    header: 'normal',
    compressed: (buffer[0] & 0x80) !== 0,
    headerLength: 2,
    totalLength
  };
}

function readUInt16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function toUint8Array(chunk) {
  if (chunk instanceof Uint8Array) {
    return chunk;
  }

  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk);
  }

  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }

  throw new TypeError('Tick stream chunks must be Uint8Array or ArrayBuffer values');
}

function concatBytes(left, right) {
  if (left.length === 0) {
    return copyBytes(right);
  }

  if (right.length === 0) {
    return left;
  }

  const combined = new Uint8Array(left.length + right.length);
  combined.set(left);
  combined.set(right, left.length);
  return combined;
}

function copyBytes(bytes) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
