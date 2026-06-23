import { inflateSync } from 'node:zlib';

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function bytesPerPixel(colorType) {
  if (colorType === 6) {
    return 4;
  }
  if (colorType === 2) {
    return 3;
  }
  throw new Error(`unsupported PNG color type ${colorType}`);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);

  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

function unfilterPngScanlines(inflated, width, height, pixelBytes) {
  const stride = width * pixelBytes;
  const rows = Buffer.alloc(stride * height);
  let sourceOffset = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[sourceOffset++];
    const rowOffset = y * stride;
    const previousRowOffset = rowOffset - stride;

    for (let x = 0; x < stride; x++) {
      const raw = inflated[sourceOffset++];
      const left = x >= pixelBytes ? rows[rowOffset + x - pixelBytes] : 0;
      const up = y > 0 ? rows[previousRowOffset + x] : 0;
      const upLeft = y > 0 && x >= pixelBytes ? rows[previousRowOffset + x - pixelBytes] : 0;

      if (filter === 0) {
        rows[rowOffset + x] = raw;
      } else if (filter === 1) {
        rows[rowOffset + x] = (raw + left) & 0xff;
      } else if (filter === 2) {
        rows[rowOffset + x] = (raw + up) & 0xff;
      } else if (filter === 3) {
        rows[rowOffset + x] = (raw + Math.floor((left + up) / 2)) & 0xff;
      } else if (filter === 4) {
        rows[rowOffset + x] = (raw + paethPredictor(left, up, upLeft)) & 0xff;
      } else {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
    }
  }

  return rows;
}

function readPngPixels(pngBuffer) {
  const signature = pngBuffer.subarray(0, 8);
  if (!signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('not a PNG file');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  let offset = 8;

  while (offset < pngBuffer.length) {
    const length = readUInt32(pngBuffer, offset);
    const type = pngBuffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = pngBuffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = readUInt32(data, 0);
      height = readUInt32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8) {
    throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  }

  const pixelBytes = bytesPerPixel(colorType);
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const pixels = unfilterPngScanlines(inflated, width, height, pixelBytes);
  return { width, height, pixelBytes, pixels };
}

function regionStats(image, bounds) {
  const { width, pixelBytes, pixels } = image;
  const x0 = Math.max(0, Math.floor(bounds.x));
  const y0 = Math.max(0, Math.floor(bounds.y));
  const x1 = Math.min(width, Math.ceil(bounds.x + bounds.width));
  const y1 = Math.min(image.height, Math.ceil(bounds.y + bounds.height));
  const buckets = new Set();
  const exactColors = new Set();
  const counts = new Map();
  let pixelsSeen = 0;
  let nonBlackPixels = 0;
  let lumaSum = 0;
  let lumaMin = 255;
  let lumaMax = 0;
  let edgeTransitions = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * width + x) * pixelBytes;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const bucket = `${r >> 3},${g >> 3},${b >> 3}`;
      const exact = `${r},${g},${b}`;

      pixelsSeen++;
      lumaSum += luma;
      lumaMin = Math.min(lumaMin, luma);
      lumaMax = Math.max(lumaMax, luma);
      if (r > 8 || g > 8 || b > 8) {
        nonBlackPixels++;
      }
      buckets.add(bucket);
      if (exactColors.size < 4096) {
        exactColors.add(exact);
      }
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);

      if (x > x0) {
        const leftOffset = offset - pixelBytes;
        const distance =
          Math.abs(r - pixels[leftOffset]) +
          Math.abs(g - pixels[leftOffset + 1]) +
          Math.abs(b - pixels[leftOffset + 2]);
        if (distance > 30) {
          edgeTransitions++;
        }
      }
      if (y > y0) {
        const upOffset = offset - width * pixelBytes;
        const distance =
          Math.abs(r - pixels[upOffset]) +
          Math.abs(g - pixels[upOffset + 1]) +
          Math.abs(b - pixels[upOffset + 2]);
        if (distance > 30) {
          edgeTransitions++;
        }
      }
    }
  }

  const dominantBucketPixels = Math.max(0, ...counts.values());
  return {
    pixels: pixelsSeen,
    uniqueColorBuckets: buckets.size,
    sampledExactColors: exactColors.size,
    nonBlackRatio: Number((nonBlackPixels / pixelsSeen).toFixed(6)),
    dominantColorRatio: Number((dominantBucketPixels / pixelsSeen).toFixed(6)),
    lumaMin: Number(lumaMin.toFixed(3)),
    lumaMax: Number(lumaMax.toFixed(3)),
    lumaMean: Number((lumaSum / pixelsSeen).toFixed(3)),
    edgeTransitions
  };
}

export function analyzeScreenshot(pngBuffer) {
  const image = readPngPixels(pngBuffer);
  const full = regionStats(image, { x: 0, y: 0, width: image.width, height: image.height });
  const world = regionStats(image, {
    x: image.width * 0.18,
    y: image.height * 0.08,
    width: image.width * 0.64,
    height: image.height * 0.58
  });
  const lowerUi = regionStats(image, {
    x: 0,
    y: image.height * 0.68,
    width: image.width,
    height: image.height * 0.32
  });

  return {
    width: image.width,
    height: image.height,
    full,
    world,
    lowerUi
  };
}
