export const CL_MOVE = 2;
export const ASTONIA_MOVE_COMMAND_LENGTH = 5;

export function encodeAstoniaMoveCommand(target) {
  const x = validateCoordinate(target?.x, 'x');
  const y = validateCoordinate(target?.y, 'y');
  const bytes = new Uint8Array(ASTONIA_MOVE_COMMAND_LENGTH);

  bytes[0] = CL_MOVE;
  bytes[1] = x & 0xff;
  bytes[2] = x >>> 8;
  bytes[3] = y & 0xff;
  bytes[4] = y >>> 8;

  return bytes;
}

function validateCoordinate(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`Astonia move command ${name} coordinate must be a uint16`);
  }

  return value;
}
