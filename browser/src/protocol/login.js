const CLIENT_PROTOCOL_VERSION = 3;
const LOGIN_MAGIC = 0x8fd46100;
const USERNAME_BYTES = 40;
const PASSWORD_BYTES = 16;
const PASSWORD_WORK_BYTES = 17;

const PASSWORD_SECRETS = [
  stringBytes('\0cgf\0de8etzdf\0dx'),
  stringBytes('jrfa\0v7d\0drt\0edm'),
  stringBytes('t6zh\0dlr\0fu4dms\0'),
  stringBytes('jkdm\0u7z5g\0j77\0g')
];

export function buildAstoniaLoginFrames(options = {}) {
  const username = options.username ?? '';
  const password = options.password ?? '';
  const protocolVersion = options.protocolVersion ?? CLIENT_PROTOCOL_VERSION;

  validateAsciiBounded(username, USERNAME_BYTES - 1, 'username');
  validateAsciiBounded(password, PASSWORD_BYTES - 1, 'password');
  if (!Number.isInteger(protocolVersion) || protocolVersion < 0 || protocolVersion > 0xff) {
    throw new RangeError('protocolVersion must be an integer between 0 and 255');
  }

  const usernameFrame = asciiFrame(username, USERNAME_BYTES);
  const passwordWork = asciiFrame(password, PASSWORD_WORK_BYTES);
  encryptPassword(usernameFrame, passwordWork);

  const magic = new Uint8Array(4);
  new DataView(magic.buffer).setUint32(0, (LOGIN_MAGIC | protocolVersion) >>> 0, true);

  return [usernameFrame, passwordWork.subarray(0, PASSWORD_BYTES), magic, new Uint8Array(12)];
}

function encryptPassword(usernameFrame, passwordFrame) {
  const key = PASSWORD_SECRETS[usernameFrame[1] % PASSWORD_SECRETS.length];

  for (let index = 0; index < passwordFrame.length; index += 1) {
    passwordFrame[index] = passwordFrame[index] ^ key[index] ^ usernameFrame[index % 3];
  }
}

function asciiFrame(value, length) {
  const frame = new Uint8Array(length);
  for (let index = 0; index < value.length; index += 1) {
    frame[index] = value.charCodeAt(index);
  }
  return frame;
}

function validateAsciiBounded(value, maxLength, fieldName) {
  if (typeof value !== 'string') {
    throw new TypeError(`${fieldName} must be a string`);
  }
  if (!/^[\x20-\x7e]*$/.test(value)) {
    throw new Error(`${fieldName} must be printable ASCII`);
  }
  if (value.length > maxLength) {
    throw new Error(`${fieldName} must be at most ${maxLength} byte(s)`);
  }
}

function stringBytes(value) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index);
  }
  return bytes;
}
