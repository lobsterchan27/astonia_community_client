import { decodeRenderListSprites } from './sprite-resolver.js';
import { resolveAstoniaRenderListSprites } from './sprite-transforms.js';

const CLEAR_COLOR = { r: 0, g: 0, b: 0, a: 1 };
const READBACK_FORMAT = 'rgba8unorm';
const DEFAULT_MAX_DECODED_SPRITES = 16;

export async function renderAstoniaRenderListWithWebGpu(canvas, renderList, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('Astonia WebGPU rendering requires a canvas');
  }
  if (!renderList || !Array.isArray(renderList.commands)) {
    throw new TypeError('Astonia WebGPU rendering requires a render list with commands');
  }

  const gpu = options.gpu === undefined ? globalThis.navigator?.gpu : options.gpu;
  if (!gpu) {
    return skipped('navigator-gpu-unavailable', 'navigator.gpu is not available');
  }

  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    return skipped('adapter-unavailable', 'navigator.gpu did not grant an adapter');
  }

  let device;
  try {
    device = await adapter.requestDevice();
  } catch (error) {
    return skipped('device-request-failed', errorMessage(error));
  }

  try {
    const context = canvas.getContext('webgpu');
    if (!context) {
      return skipped('webgpu-context-unavailable', 'Canvas did not provide a WebGPU context');
    }

    const width = positiveInteger(renderList.viewport?.canvasWidth, 1);
    const height = positiveInteger(renderList.viewport?.canvasHeight, 1);
    const format = options.format ?? gpu.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    try {
      context.configure({
        device,
        format,
        alphaMode: 'premultiplied'
      });
    } catch (error) {
      return skipped('webgpu-context-unavailable', errorMessage(error));
    }

    const spriteRenderList = await resolveTexturedRenderList(renderList, options);
    const spriteResolution = options.spriteAssets
      ? await decodeRenderListSprites(spriteRenderList, options.spriteAssets, {
          spriteIds: options.spriteIds,
          maxSprites: options.maxDecodedSprites ?? DEFAULT_MAX_DECODED_SPRITES
        })
      : emptySpriteResolution();
    const encoder = device.createCommandEncoder();
    const pipelines = new PipelineCache(device);
    const frame = createFrameResources(
      device,
      spriteRenderList,
      spriteResolution.decodedSprites,
      width,
      height,
      pipelines.textureBindGroupLayout
    );

    recordRenderPass({
      device,
      encoder,
      targetView: context.getCurrentTexture().createView(),
      format,
      frame,
      pipelines
    });

    let pixelSample = null;
    let readbackBuffer = null;
    let readbackTexture = null;
    if (options.samplePixels) {
      const readback = recordReadbackPass({
        device,
        encoder,
        frame,
        pipelines,
        width,
        height
      });
      readbackBuffer = readback.buffer;
      readbackTexture = readback.texture;
    }

    device.queue.submit([encoder.finish()]);

    if (readbackBuffer) {
      pixelSample = await sampleReadbackBuffer(readbackBuffer, width, height);
      readbackBuffer.destroy();
      readbackTexture?.destroy();
    } else {
      await device.queue.onSubmittedWorkDone();
    }

    return {
      status: 'rendered',
      canvas: {
        width,
        height,
        format
      },
      draw: {
        fallbackCommands: spriteRenderList.commands.length,
        texturedCommands: frame.texturedCommandCount
      },
      sprites: {
        decoded: spriteResolution.decoded.map(spriteMetadata),
        missing: spriteResolution.missing,
        skipped: spriteResolution.skipped
      },
      ...(pixelSample ? { pixelSample } : {})
    };
  } finally {
    device.destroy();
  }
}

async function resolveTexturedRenderList(renderList, options) {
  if (options.resolveSpriteTransforms === false) {
    return renderList;
  }

  try {
    return await resolveAstoniaRenderListSprites(
      renderList,
      options.spriteTransformConfig ? { config: options.spriteTransformConfig } : {}
    );
  } catch {
    return renderList;
  }
}

function skipped(reason, detail) {
  return {
    status: 'skipped',
    reason,
    detail
  };
}

class PipelineCache {
  constructor(device) {
    this.device = device;
    this.colorPipelines = new Map();
    this.texturePipelines = new Map();
    this.textureBindGroupLayout = createTextureBindGroupLayout(device);
    this.texturePipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.textureBindGroupLayout]
    });
  }

  color(format) {
    if (!this.colorPipelines.has(format)) {
      this.colorPipelines.set(format, createColorPipeline(this.device, format));
    }
    return this.colorPipelines.get(format);
  }

  texture(format) {
    if (!this.texturePipelines.has(format)) {
      this.texturePipelines.set(format, createTexturePipeline(this.device, format, this.texturePipelineLayout));
    }
    return this.texturePipelines.get(format);
  }
}

function createFrameResources(device, renderList, decodedSprites, width, height, textureBindGroupLayout) {
  const fallbackVertices = buildFallbackVertices(renderList, width, height);
  const fallbackVertexBuffer = createVertexBuffer(device, fallbackVertices);
  const textures = createSpriteTextures(device, decodedSprites);
  const texturedDraws = buildTexturedDraws(device, renderList, textures, textureBindGroupLayout, width, height);

  return {
    fallbackVertexBuffer,
    fallbackVertexCount: fallbackVertices.length / 6,
    textures,
    texturedDraws,
    texturedCommandCount: texturedDraws.length
  };
}

function recordReadbackPass({ device, encoder, frame, pipelines, width, height }) {
  const usage = globalThis.GPUTextureUsage;
  const readbackTexture = device.createTexture({
    size: [width, height],
    format: READBACK_FORMAT,
    usage: usage.RENDER_ATTACHMENT | usage.COPY_SRC
  });
  const paddedBytesPerRow = alignTo(width * 4, 256);
  const readbackBuffer = device.createBuffer({
    size: paddedBytesPerRow * height,
    usage: globalThis.GPUBufferUsage.COPY_DST | globalThis.GPUBufferUsage.MAP_READ
  });

  recordRenderPass({
    device,
    encoder,
    targetView: readbackTexture.createView(),
    format: READBACK_FORMAT,
    frame,
    pipelines
  });
  encoder.copyTextureToBuffer(
    { texture: readbackTexture },
    {
      buffer: readbackBuffer,
      bytesPerRow: paddedBytesPerRow,
      rowsPerImage: height
    },
    [width, height]
  );

  return {
    buffer: readbackBuffer,
    texture: readbackTexture
  };
}

function recordRenderPass({ encoder, targetView, format, frame, pipelines }) {
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: targetView,
        clearValue: CLEAR_COLOR,
        loadOp: 'clear',
        storeOp: 'store'
      }
    ]
  });

  if (frame.fallbackVertexCount > 0) {
    pass.setPipeline(pipelines.color(format));
    pass.setVertexBuffer(0, frame.fallbackVertexBuffer);
    pass.draw(frame.fallbackVertexCount);
  }

  if (frame.texturedDraws.length > 0) {
    pass.setPipeline(pipelines.texture(format));
    for (const draw of frame.texturedDraws) {
      pass.setBindGroup(0, draw.bindGroup);
      pass.setVertexBuffer(0, draw.vertexBuffer);
      pass.draw(6);
    }
  }

  pass.end();
}

function createColorPipeline(device, format) {
  const module = device.createShaderModule({
    code: `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
}

@vertex
fn vertexMain(@location(0) position: vec2<f32>, @location(1) color: vec4<f32>) -> VertexOut {
  var out: VertexOut;
  out.position = vec4<f32>(position, 0.0, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fragmentMain(in: VertexOut) -> @location(0) vec4<f32> {
  return in.color;
}
`
  });

  return device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vertexMain',
      buffers: [
        {
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x4' }
          ]
        }
      ]
    },
    fragment: {
      module,
      entryPoint: 'fragmentMain',
      targets: [{ format }]
    },
    primitive: {
      topology: 'triangle-list'
    }
  });
}

function createTextureBindGroupLayout(device) {
  return device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: globalThis.GPUShaderStage.FRAGMENT,
        sampler: { type: 'filtering' }
      },
      {
        binding: 1,
        visibility: globalThis.GPUShaderStage.FRAGMENT,
        texture: {
          sampleType: 'float',
          viewDimension: '2d'
        }
      }
    ]
  });
}

function createTexturePipeline(device, format, pipelineLayout) {
  const module = device.createShaderModule({
    code: `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var spriteSampler: sampler;
@group(0) @binding(1) var spriteTexture: texture_2d<f32>;

@vertex
fn vertexMain(@location(0) position: vec2<f32>, @location(1) uv: vec2<f32>) -> VertexOut {
  var out: VertexOut;
  out.position = vec4<f32>(position, 0.0, 1.0);
  out.uv = uv;
  return out;
}

@fragment
fn fragmentMain(in: VertexOut) -> @location(0) vec4<f32> {
  return textureSample(spriteTexture, spriteSampler, in.uv);
}
`
  });

  return device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module,
      entryPoint: 'vertexMain',
      buffers: [
        {
          arrayStride: 16,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x2' }
          ]
        }
      ]
    },
    fragment: {
      module,
      entryPoint: 'fragmentMain',
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add'
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add'
            }
          }
        }
      ]
    },
    primitive: {
      topology: 'triangle-list'
    }
  });
}

function buildFallbackVertices(renderList, width, height) {
  const vertices = [];
  for (const command of renderList.commands) {
    const rect = fallbackRect(command, renderList.viewport);
    const color = colorFromHex(command.fallbackColor);
    pushColorQuad(vertices, rect, color, width, height);
  }
  return new Float32Array(vertices);
}

function buildTexturedDraws(device, renderList, textures, bindGroupLayout, width, height) {
  const draws = [];

  for (const command of renderList.commands) {
    const texture = textures.get(command.spriteId);
    if (!texture) {
      continue;
    }

    const vertices = buildTextureVertices(command, texture.sprite, width, height);
    const vertexBuffer = createVertexBuffer(device, vertices);
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: texture.sampler
        },
        {
          binding: 1,
          resource: texture.texture.createView()
        }
      ]
    });

    draws.push({ vertexBuffer, bindGroup });
  }

  return draws;
}

function createSpriteTextures(device, decodedSprites) {
  const textures = new Map();
  const usage = globalThis.GPUTextureUsage;

  for (const [spriteId, sprite] of decodedSprites.entries()) {
    const texture = device.createTexture({
      size: [sprite.width, sprite.height],
      format: READBACK_FORMAT,
      usage: usage.TEXTURE_BINDING | usage.COPY_DST
    });
    device.queue.writeTexture(
      { texture },
      sprite.pixels,
      {
        bytesPerRow: sprite.width * 4,
        rowsPerImage: sprite.height
      },
      [sprite.width, sprite.height]
    );

    textures.set(spriteId, {
      texture,
      sprite,
      sampler: device.createSampler({
        magFilter: 'nearest',
        minFilter: 'nearest'
      })
    });
  }

  return textures;
}

function buildTextureVertices(command, sprite, width, height) {
  const rect = textureRect(command, sprite);
  return new Float32Array([
    ...clipPoint(rect.x, rect.y, width, height),
    0,
    0,
    ...clipPoint(rect.x + rect.width, rect.y, width, height),
    1,
    0,
    ...clipPoint(rect.x, rect.y + rect.height, width, height),
    0,
    1,
    ...clipPoint(rect.x, rect.y + rect.height, width, height),
    0,
    1,
    ...clipPoint(rect.x + rect.width, rect.y, width, height),
    1,
    0,
    ...clipPoint(rect.x + rect.width, rect.y + rect.height, width, height),
    1,
    1
  ]);
}

function pushColorQuad(vertices, rect, color, width, height) {
  const topLeft = clipPoint(rect.x, rect.y, width, height);
  const topRight = clipPoint(rect.x + rect.width, rect.y, width, height);
  const bottomLeft = clipPoint(rect.x, rect.y + rect.height, width, height);
  const bottomRight = clipPoint(rect.x + rect.width, rect.y + rect.height, width, height);

  pushColorVertex(vertices, topLeft, color);
  pushColorVertex(vertices, topRight, color);
  pushColorVertex(vertices, bottomLeft, color);
  pushColorVertex(vertices, bottomLeft, color);
  pushColorVertex(vertices, topRight, color);
  pushColorVertex(vertices, bottomRight, color);
}

function pushColorVertex(vertices, position, color) {
  vertices.push(position[0], position[1], color[0], color[1], color[2], color[3]);
}

function clipPoint(x, y, width, height) {
  return [(x / width) * 2 - 1, 1 - (y / height) * 2];
}

function fallbackRect(command, viewport) {
  const baseWidth = viewport?.tileWidth ?? 40;
  const baseHeight = viewport?.tileHeight ?? 20;
  const center = command.screen ?? { x: 0, y: 0 };

  if (command.layer === 'character') {
    const width = Math.max(18, Math.round(baseWidth * 0.65));
    const height = Math.max(34, Math.round(baseHeight * 2.1));
    return {
      x: center.x - width / 2,
      y: center.y - height + baseHeight,
      width,
      height
    };
  }

  if (command.layer === 'item') {
    const size = Math.max(12, Math.round(baseHeight * 0.8));
    return {
      x: center.x - size / 2,
      y: center.y - size / 2,
      width: size,
      height: size
    };
  }

  return {
    x: center.x - baseWidth / 4,
    y: center.y - baseHeight / 4,
    width: Math.max(12, baseWidth / 2),
    height: Math.max(6, baseHeight / 2)
  };
}

function textureRect(command, sprite) {
  const center = command.screen ?? { x: 0, y: 0 };
  const maxWidth = command.layer === 'character' ? 64 : 48;
  const maxHeight = command.layer === 'character' ? 96 : 48;
  const scale = Math.min(1, maxWidth / sprite.width, maxHeight / sprite.height);
  const width = Math.max(1, Math.round(sprite.width * scale));
  const height = Math.max(1, Math.round(sprite.height * scale));

  return {
    x: center.x - width / 2,
    y: command.layer === 'character' ? center.y - height + 20 : center.y - height / 2,
    width,
    height
  };
}

function createVertexBuffer(device, vertices) {
  const usage = globalThis.GPUBufferUsage;
  const buffer = device.createBuffer({
    size: Math.max(4, vertices.byteLength),
    usage: usage.VERTEX | usage.COPY_DST
  });

  if (vertices.byteLength > 0) {
    device.queue.writeBuffer(buffer, 0, vertices);
  }

  return buffer;
}

async function sampleReadbackBuffer(buffer, width, height) {
  const paddedBytesPerRow = alignTo(width * 4, 256);
  await buffer.mapAsync(globalThis.GPUMapMode.READ);
  const data = new Uint8Array(buffer.getMappedRange());
  let checkedPixels = 0;
  let nonZeroColorPixels = 0;
  let nonTransparentPixels = 0;

  for (let y = 0; y < height; y += 1) {
    const row = y * paddedBytesPerRow;
    for (let x = 0; x < width; x += 1) {
      const offset = row + x * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const alpha = data[offset + 3];
      checkedPixels += 1;
      if (red !== 0 || green !== 0 || blue !== 0) {
        nonZeroColorPixels += 1;
      }
      if (alpha !== 0) {
        nonTransparentPixels += 1;
      }
    }
  }

  buffer.unmap();
  return {
    checkedPixels,
    nonZeroColorPixels,
    nonTransparentPixels
  };
}

function colorFromHex(color) {
  const match = /^#([0-9a-f]{6})$/i.exec(color ?? '');
  if (!match) {
    return [0.8, 0.8, 0.8, 1];
  }

  const value = Number.parseInt(match[1], 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255, 0.92];
}

function spriteMetadata(sprite) {
  return {
    spriteId: sprite.spriteId,
    entryName: sprite.entryName,
    archiveName: sprite.archiveName,
    width: sprite.width,
    height: sprite.height,
    pixelByteLength: sprite.pixelByteLength
  };
}

function emptySpriteResolution() {
  return {
    decoded: [],
    decodedSprites: new Map(),
    missing: [],
    skipped: []
  };
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function alignTo(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
