const SV_SCROLL_UP = 1;
const SV_SCROLL_DOWN = 2;
const SV_SCROLL_LEFT = 3;
const SV_SCROLL_RIGHT = 4;
const SV_SCROLL_LEFTUP = 5;
const SV_SCROLL_RIGHTUP = 6;
const SV_SCROLL_LEFTDOWN = 7;
const SV_SCROLL_RIGHTDOWN = 8;
const SV_TEXT = 9;
const SV_SETVAL0 = 10;
const SV_SETVAL1 = 11;
const SV_SETHP = 12;
const SV_SETMANA = 13;
const SV_SETITEM = 14;
const SV_SETORIGIN = 15;
const SV_SETTICK = 16;
const SV_SETCITEM = 17;
const SV_ACT = 18;
const SV_EXIT = 19;
const SV_NAME = 20;
const SV_SERVER = 21;
const SV_CONTAINER = 22;
const SV_CONCNT = 23;
const SV_ENDURANCE = 24;
const SV_LIFESHIELD = 25;
const SV_EXP = 26;
const SV_EXP_USED = 27;
const SV_PRICE = 28;
const SV_CPRICE = 29;
const SV_GOLD = 30;
const SV_LOOKINV = 31;
const SV_ITEMPRICE = 32;
const SV_AREAINFO = 33;
const SV_UEFFECT = 35;
const SV_REALTIME = 36;
const SV_SPEEDMODE = 37;
const SV_CONTYPE = 39;
const SV_CONNAME = 40;
const SV_LOGINDONE = 43;
const SV_SPECIAL = 44;
const SV_TELEPORT = 45;
const SV_SETRAGE = 46;
const SV_MIRROR = 47;
const SV_PROF = 48;
const SV_PING = 49;
const SV_UNIQUE = 50;
const SV_MIL_EXP = 51;
const SV_PROTOCOL = 53;

const SV_MAPTHIS = 0;
const SV_MAPNEXT = 16;
const SV_MAPOFF = 32;
const SV_MAPPOS = 48;

const SV_MAP01 = 64;
const SV_MAP10 = 128;
const SV_MAP11 = 192;

const P3_MAX = 20;
const P35_MAX = 10;
const DEFAULT_DISTANCE = 25;

const COMMAND_NAMES = new Map([
  [SV_SCROLL_UP, 'SV_SCROLL_UP'],
  [SV_SCROLL_DOWN, 'SV_SCROLL_DOWN'],
  [SV_SCROLL_LEFT, 'SV_SCROLL_LEFT'],
  [SV_SCROLL_RIGHT, 'SV_SCROLL_RIGHT'],
  [SV_SCROLL_LEFTUP, 'SV_SCROLL_LEFTUP'],
  [SV_SCROLL_RIGHTUP, 'SV_SCROLL_RIGHTUP'],
  [SV_SCROLL_LEFTDOWN, 'SV_SCROLL_LEFTDOWN'],
  [SV_SCROLL_RIGHTDOWN, 'SV_SCROLL_RIGHTDOWN'],
  [SV_TEXT, 'SV_TEXT'],
  [SV_SETVAL0, 'SV_SETVAL0'],
  [SV_SETVAL1, 'SV_SETVAL1'],
  [SV_SETHP, 'SV_SETHP'],
  [SV_SETMANA, 'SV_SETMANA'],
  [SV_SETITEM, 'SV_SETITEM'],
  [SV_SETORIGIN, 'SV_SETORIGIN'],
  [SV_SETTICK, 'SV_SETTICK'],
  [SV_SETCITEM, 'SV_SETCITEM'],
  [SV_ACT, 'SV_ACT'],
  [SV_EXIT, 'SV_EXIT'],
  [SV_NAME, 'SV_NAME'],
  [SV_SERVER, 'SV_SERVER'],
  [SV_CONTAINER, 'SV_CONTAINER'],
  [SV_CONCNT, 'SV_CONCNT'],
  [SV_ENDURANCE, 'SV_ENDURANCE'],
  [SV_LIFESHIELD, 'SV_LIFESHIELD'],
  [SV_EXP, 'SV_EXP'],
  [SV_EXP_USED, 'SV_EXP_USED'],
  [SV_PRICE, 'SV_PRICE'],
  [SV_CPRICE, 'SV_CPRICE'],
  [SV_GOLD, 'SV_GOLD'],
  [SV_LOOKINV, 'SV_LOOKINV'],
  [SV_ITEMPRICE, 'SV_ITEMPRICE'],
  [SV_AREAINFO, 'SV_AREAINFO'],
  [SV_UEFFECT, 'SV_UEFFECT'],
  [SV_REALTIME, 'SV_REALTIME'],
  [SV_SPEEDMODE, 'SV_SPEEDMODE'],
  [SV_CONTYPE, 'SV_CONTYPE'],
  [SV_CONNAME, 'SV_CONNAME'],
  [SV_LOGINDONE, 'SV_LOGINDONE'],
  [SV_SPECIAL, 'SV_SPECIAL'],
  [SV_TELEPORT, 'SV_TELEPORT'],
  [SV_SETRAGE, 'SV_SETRAGE'],
  [SV_MIRROR, 'SV_MIRROR'],
  [SV_PROF, 'SV_PROF'],
  [SV_PING, 'SV_PING'],
  [SV_UNIQUE, 'SV_UNIQUE'],
  [SV_MIL_EXP, 'SV_MIL_EXP'],
  [SV_PROTOCOL, 'SV_PROTOCOL']
]);

const textDecoder = new TextDecoder('windows-1252');

export class AstoniaProtocolStateReplay {
  #protocolVersion;
  #distance;
  #width;
  #height;
  #currentTick;
  #loginDone;
  #loginDoneCount;
  #origin;
  #carriedItem;
  #playersById;
  #textMessages;
  #mapCells;
  #modeledCounts;
  #skippedCounts;
  #ticksReplayed;

  constructor() {
    this.#protocolVersion = null;
    this.#distance = DEFAULT_DISTANCE;
    this.#width = DEFAULT_DISTANCE * 2 + 1;
    this.#height = DEFAULT_DISTANCE * 2 + 1;
    this.#currentTick = null;
    this.#loginDone = false;
    this.#loginDoneCount = 0;
    this.#origin = null;
    this.#carriedItem = null;
    this.#playersById = new Map();
    this.#textMessages = [];
    this.#mapCells = new Map();
    this.#modeledCounts = new Map();
    this.#skippedCounts = new Map();
    this.#ticksReplayed = 0;
  }

  replayTick(tick, metadata = {}) {
    if (tick && typeof tick === 'object' && 'payload' in tick) {
      return this.replayTickPayload(tick.payload, {
        tickIndex: tick.index,
        streamOffset: tick.streamOffset,
        ...metadata
      });
    }

    return this.replayTickPayload(tick, metadata);
  }

  replayTickPayload(payload, metadata = {}) {
    const bytes = toUint8Array(payload);
    let offset = 0;
    const mapCursor = { lastCellIndex: -1 };
    const result = {
      payloadLength: bytes.length,
      commandCount: 0,
      tickIndex: metadata.tickIndex
    };

    while (offset < bytes.length) {
      const commandOffset = offset;
      const length = this.#processCommand(bytes, offset, metadata, mapCursor);
      if (!Number.isInteger(length) || length <= 0) {
        throw new Error(`Astonia replay command at payload offset ${commandOffset} did not advance`);
      }
      ensureAvailable(bytes, commandOffset, length);
      offset += length;
      result.commandCount += 1;
    }

    this.#ticksReplayed += 1;
    return result;
  }

  snapshot() {
    const playersById = Object.fromEntries(
      [...this.#playersById.entries()]
        .sort(([left], [right]) => left - right)
        .map(([id, player]) => [id, clonePlayer(player)])
    );
    const visibleWorld = this.#visibleWorldSnapshot(playersById);

    return {
      protocolVersion: this.#protocolVersion,
      currentTick: this.#currentTick,
      login: {
        done: this.#loginDone,
        doneCount: this.#loginDoneCount
      },
      origin: clonePoint(this.#origin),
      position: clonePoint(this.#origin),
      player: this.#currentPlayerSnapshot(visibleWorld.characters, playersById),
      playersById,
      carriedItem: this.#carriedItem ? { ...this.#carriedItem } : null,
      textMessages: this.#textMessages.map((message) => ({ ...message })),
      visibleWorld,
      commands: {
        modeled: countSnapshot(this.#modeledCounts),
        skipped: countSnapshot(this.#skippedCounts)
      },
      ticksReplayed: this.#ticksReplayed
    };
  }

  #processCommand(bytes, offset, metadata, mapCursor) {
    ensureAvailable(bytes, offset, 1);
    const command = bytes[offset];
    const mapFamily = command & 0xc0;

    if (mapFamily === SV_MAP01) {
      this.#countModeled('SV_MAP01');
      return this.#processMap01(bytes, offset, mapCursor);
    }
    if (mapFamily === SV_MAP10) {
      this.#countModeled('SV_MAP10');
      return this.#processMap10(bytes, offset, mapCursor);
    }
    if (mapFamily === SV_MAP11) {
      this.#countModeled('SV_MAP11');
      return this.#processMap11(bytes, offset, mapCursor);
    }

    switch (command) {
      case SV_TEXT:
        return this.#processText(bytes, offset, metadata);
      case SV_SETORIGIN:
        return this.#processSetOrigin(bytes, offset);
      case SV_SETTICK:
        return this.#processSetTick(bytes, offset);
      case SV_SETCITEM:
        return this.#processSetCarriedItem(bytes, offset);
      case SV_NAME:
        return this.#processName(bytes, offset);
      case SV_LOGINDONE:
        this.#countModeled(commandName(command));
        this.#loginDone = true;
        this.#loginDoneCount += 1;
        this.#mapCells.clear();
        return 1;
      case SV_PROTOCOL:
        return this.#processProtocol(bytes, offset);
      default:
        return this.#skipUnsupported(bytes, offset);
    }
  }

  #processText(bytes, offset, metadata) {
    ensureAvailable(bytes, offset, 3);
    const length = readUInt16LE(bytes, offset + 1);
    ensureAvailable(bytes, offset + 3, length);
    this.#countModeled('SV_TEXT');
    this.#textMessages.push({
      tickIndex: metadata.tickIndex,
      text: textDecoder.decode(bytes.subarray(offset + 3, offset + 3 + length))
    });
    return length + 3;
  }

  #processSetOrigin(bytes, offset) {
    ensureAvailable(bytes, offset, 5);
    this.#countModeled('SV_SETORIGIN');
    this.#origin = {
      x: readUInt16LE(bytes, offset + 1),
      y: readUInt16LE(bytes, offset + 3)
    };
    return 5;
  }

  #processSetTick(bytes, offset) {
    ensureAvailable(bytes, offset, 5);
    this.#countModeled('SV_SETTICK');
    this.#currentTick = readUInt32LE(bytes, offset + 1);
    return 5;
  }

  #processSetCarriedItem(bytes, offset) {
    ensureAvailable(bytes, offset, 9);
    this.#countModeled('SV_SETCITEM');
    this.#carriedItem = {
      spriteId: readUInt32LE(bytes, offset + 1),
      flags: readUInt32LE(bytes, offset + 5)
    };
    return 9;
  }

  #processName(bytes, offset) {
    ensureAvailable(bytes, offset, 13);
    const length = bytes[offset + 12];
    ensureAvailable(bytes, offset + 13, length);
    this.#countModeled('SV_NAME');

    const id = readUInt16LE(bytes, offset + 1);
    this.#playersById.set(id, {
      id,
      name: textDecoder.decode(bytes.subarray(offset + 13, offset + 13 + length)),
      level: bytes[offset + 3],
      colors: [
        readUInt16LE(bytes, offset + 4),
        readUInt16LE(bytes, offset + 6),
        readUInt16LE(bytes, offset + 8)
      ],
      clan: bytes[offset + 10],
      pkStatus: bytes[offset + 11]
    });

    return length + 13;
  }

  #processProtocol(bytes, offset) {
    ensureAvailable(bytes, offset, 2);
    this.#countModeled('SV_PROTOCOL');
    const protocolVersion = bytes[offset + 1];
    const nextDistance = protocolVersion >= 3 ? 40 : 25;

    this.#protocolVersion = protocolVersion;
    if (nextDistance !== this.#distance) {
      this.#mapCells.clear();
    }
    this.#distance = nextDistance;
    this.#width = nextDistance * 2 + 1;
    this.#height = nextDistance * 2 + 1;

    return 2;
  }

  #processMap01(bytes, offset, mapCursor) {
    const command = bytes[offset];
    const position = this.#readMapPosition(bytes, offset, mapCursor);
    const cell = this.#mapCell(position.cellIndex);
    let cursor = position.payloadOffset;

    if (!cell.effects) {
      cell.effects = [0, 0, 0, 0];
    }

    for (let index = 0; index < 4; index += 1) {
      const flag = 1 << index;
      if ((command & flag) !== 0) {
        ensureAvailable(bytes, offset + cursor, 4);
        cell.effects[index] = readUInt32LE(bytes, offset + cursor);
        cursor += 4;
      }
    }

    mapCursor.lastCellIndex = position.cellIndex;
    return cursor;
  }

  #processMap10(bytes, offset, mapCursor) {
    const command = bytes[offset];
    const position = this.#readMapPosition(bytes, offset, mapCursor);
    const cell = this.#mapCell(position.cellIndex);
    let cursor = position.payloadOffset;

    if ((command & 1) !== 0) {
      ensureAvailable(bytes, offset + cursor, 6);
      cell.character = {
        ...(cell.character ?? {}),
        spriteId: readUInt32LE(bytes, offset + cursor),
        id: readUInt16LE(bytes, offset + cursor + 4)
      };
      cursor += 6;
    }
    if ((command & 2) !== 0) {
      ensureAvailable(bytes, offset + cursor, 3);
      cell.character = {
        ...(cell.character ?? {}),
        action: bytes[offset + cursor],
        duration: bytes[offset + cursor + 1],
        step: bytes[offset + cursor + 2]
      };
      cursor += 3;
    }
    if ((command & 4) !== 0) {
      ensureAvailable(bytes, offset + cursor, 4);
      cell.character = {
        ...(cell.character ?? {}),
        direction: bytes[offset + cursor],
        health: bytes[offset + cursor + 1],
        mana: bytes[offset + cursor + 2],
        shield: bytes[offset + cursor + 3]
      };
      cursor += 4;
    }
    if ((command & 8) !== 0) {
      delete cell.character;
    }

    mapCursor.lastCellIndex = position.cellIndex;
    return cursor;
  }

  #processMap11(bytes, offset, mapCursor) {
    const command = bytes[offset];
    const position = this.#readMapPosition(bytes, offset, mapCursor);
    const cell = this.#mapCell(position.cellIndex);
    let cursor = position.payloadOffset;

    if ((command & 1) !== 0) {
      ensureAvailable(bytes, offset + cursor, 4);
      const groundSprites = readUInt32LE(bytes, offset + cursor);
      cell.groundSpriteId = groundSprites & 0xffff;
      cell.groundOverlaySpriteId = groundSprites >>> 16;
      cursor += 4;
    }
    if ((command & 2) !== 0) {
      ensureAvailable(bytes, offset + cursor, 4);
      const floorSprites = readUInt32LE(bytes, offset + cursor);
      cell.floorSpriteId = floorSprites & 0xffff;
      cell.floorOverlaySpriteId = floorSprites >>> 16;
      cursor += 4;
    }
    if ((command & 4) !== 0) {
      ensureAvailable(bytes, offset + cursor, 4);
      let itemSpriteId = readUInt32LE(bytes, offset + cursor);
      cursor += 4;
      if ((itemSpriteId & 0x80000000) !== 0) {
        itemSpriteId &= ~0x80000000;
        ensureAvailable(bytes, offset + cursor, 6);
        cell.itemSpriteId = itemSpriteId;
        cell.itemColors = [
          readUInt16LE(bytes, offset + cursor),
          readUInt16LE(bytes, offset + cursor + 2),
          readUInt16LE(bytes, offset + cursor + 4)
        ];
        cursor += 6;
      } else {
        cell.itemSpriteId = itemSpriteId;
        cell.itemColors = [0, 0, 0];
      }
    }
    if ((command & 8) !== 0) {
      ensureAvailable(bytes, offset + cursor, 1);
      if (bytes[offset + cursor] !== 0) {
        ensureAvailable(bytes, offset + cursor, 2);
        cell.flags = readUInt16LE(bytes, offset + cursor);
        cursor += 2;
      } else {
        cell.flags = 0;
        cursor += 1;
      }
    }

    mapCursor.lastCellIndex = position.cellIndex;
    return cursor;
  }

  #readMapPosition(bytes, offset, mapCursor) {
    const command = bytes[offset];
    const mode = command & 0x30;

    if (mode === SV_MAPTHIS) {
      if (mapCursor.lastCellIndex < 0) {
        throw new Error(`SV_MAPTHIS at payload offset ${offset} has no previous map cell`);
      }
      return { payloadOffset: 1, cellIndex: mapCursor.lastCellIndex };
    }
    if (mode === SV_MAPNEXT) {
      return { payloadOffset: 1, cellIndex: this.#checkedMapCellIndex(mapCursor.lastCellIndex + 1, offset) };
    }
    if (mode === SV_MAPOFF) {
      ensureAvailable(bytes, offset, 2);
      return {
        payloadOffset: 2,
        cellIndex: this.#checkedMapCellIndex(mapCursor.lastCellIndex + bytes[offset + 1], offset)
      };
    }
    if (mode === SV_MAPPOS) {
      ensureAvailable(bytes, offset, 3);
      return {
        payloadOffset: 3,
        cellIndex: this.#checkedMapCellIndex(readUInt16LE(bytes, offset + 1), offset)
      };
    }

    throw new Error(`Unsupported map position mode ${mode} at payload offset ${offset}`);
  }

  #checkedMapCellIndex(cellIndex, offset) {
    if (cellIndex < 0 || cellIndex >= this.#width * this.#height) {
      throw new Error(`Map update at payload offset ${offset} targets invalid cell ${cellIndex}`);
    }
    return cellIndex;
  }

  #mapCell(cellIndex) {
    let cell = this.#mapCells.get(cellIndex);
    if (!cell) {
      cell = { index: cellIndex };
      this.#mapCells.set(cellIndex, cell);
    }
    return cell;
  }

  #skipUnsupported(bytes, offset) {
    const command = bytes[offset];
    const name = commandName(command);
    let length = null;

    switch (command) {
      case SV_SCROLL_UP:
      case SV_SCROLL_DOWN:
      case SV_SCROLL_LEFT:
      case SV_SCROLL_RIGHT:
      case SV_SCROLL_LEFTUP:
      case SV_SCROLL_RIGHTUP:
      case SV_SCROLL_LEFTDOWN:
      case SV_SCROLL_RIGHTDOWN:
        length = 1;
        break;
      case SV_SETVAL0:
      case SV_SETVAL1:
        length = 4;
        break;
      case SV_SETHP:
      case SV_SETMANA:
      case SV_ENDURANCE:
      case SV_LIFESHIELD:
      case SV_SETRAGE:
        length = 3;
        break;
      case SV_SETITEM:
        length = 10;
        break;
      case SV_ACT:
      case SV_SERVER:
      case SV_AREAINFO:
        length = 7;
        break;
      case SV_EXIT:
      case SV_CONNAME:
        ensureAvailable(bytes, offset, 2);
        length = bytes[offset + 1] + 2;
        break;
      case SV_CONTAINER:
      case SV_PRICE:
      case SV_ITEMPRICE:
        length = 6;
        break;
      case SV_CONCNT:
      case SV_SPEEDMODE:
      case SV_CONTYPE:
        length = 2;
        break;
      case SV_EXP:
      case SV_EXP_USED:
      case SV_CPRICE:
      case SV_GOLD:
      case SV_REALTIME:
      case SV_MIRROR:
      case SV_PING:
      case SV_UNIQUE:
      case SV_MIL_EXP:
        length = 5;
        break;
      case SV_LOOKINV:
        length = 65;
        break;
      case SV_UEFFECT:
        length = 9;
        break;
      case SV_SPECIAL:
        length = 13;
        break;
      case SV_TELEPORT:
        length = this.#protocolVersion === 35 ? 9 : 13;
        break;
      case SV_PROF:
        length = (this.#protocolVersion === 35 ? P35_MAX : P3_MAX) + 1;
        break;
      default:
        throw new Error(`Unsupported Astonia server command ${command} at payload offset ${offset}; cannot safely advance`);
    }

    ensureAvailable(bytes, offset, length);
    this.#countSkipped(name);
    return length;
  }

  #visibleWorldSnapshot(playersById) {
    const nonEmptyCells = [...this.#mapCells.values()].filter(isNonEmptyCell);
    const bounds = calculateBounds(nonEmptyCells, this.#width);

    return {
      width: this.#width,
      height: this.#height,
      distance: this.#distance,
      updatedCells: this.#mapCells.size,
      nonEmptyCells: nonEmptyCells.length,
      bounds,
      layers: {
        ground: nonEmptyCells.filter(hasGround).length,
        floor: nonEmptyCells.filter(hasFloor).length,
        item: nonEmptyCells.filter(hasItem).length,
        flags: nonEmptyCells.filter(hasFlags).length,
        character: nonEmptyCells.filter((cell) => cell.character).length,
        effects: nonEmptyCells.filter(hasEffects).length
      },
      characters: nonEmptyCells
        .filter((cell) => cell.character)
        .sort((left, right) => left.index - right.index)
        .map((cell) => this.#characterSnapshot(cell, playersById))
    };
  }

  #characterSnapshot(cell, playersById) {
    const local = localPoint(cell.index, this.#width);
    const character = cell.character;
    const knownPlayer = playersById[character.id] ?? null;

    return {
      id: character.id,
      name: knownPlayer?.name ?? null,
      local,
      world: this.#worldPoint(local),
      spriteId: character.spriteId,
      action: character.action ?? null,
      duration: character.duration ?? null,
      step: character.step ?? null,
      direction: character.direction ?? null,
      health: character.health ?? null,
      mana: character.mana ?? null,
      shield: character.shield ?? null
    };
  }

  #worldPoint(local) {
    if (!this.#origin) {
      return null;
    }

    return {
      x: this.#origin.x - this.#distance + local.x,
      y: this.#origin.y - this.#distance + local.y
    };
  }

  #currentPlayerSnapshot(characters, playersById) {
    const center = characters.find(
      (character) => character.local.x === this.#distance && character.local.y === this.#distance
    );
    if (!center) {
      return null;
    }

    const knownPlayer = playersById[center.id] ?? null;
    return {
      ...center,
      name: knownPlayer?.name ?? center.name,
      position: clonePoint(center.world)
    };
  }

  #countModeled(name) {
    incrementCount(this.#modeledCounts, name);
  }

  #countSkipped(name) {
    incrementCount(this.#skippedCounts, name);
  }
}

function commandName(command) {
  return COMMAND_NAMES.get(command) ?? `SV_UNKNOWN_${command}`;
}

function toUint8Array(payload) {
  if (payload instanceof Uint8Array) {
    return payload;
  }

  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }

  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  }

  throw new TypeError('Astonia protocol replay payloads must be Uint8Array or ArrayBuffer values');
}

function ensureAvailable(bytes, offset, length) {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error(
      `Astonia protocol command overruns payload: offset ${offset}, length ${length}, payload ${bytes.length}`
    );
  }
}

function readUInt16LE(bytes, offset) {
  ensureAvailable(bytes, offset, 2);
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32LE(bytes, offset) {
  ensureAvailable(bytes, offset, 4);
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function incrementCount(counts, name) {
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

function countSnapshot(counts) {
  const byCommand = Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return { total, byCommand };
}

function clonePoint(point) {
  return point ? { ...point } : null;
}

function clonePlayer(player) {
  return {
    ...player,
    colors: [...player.colors]
  };
}

function localPoint(index, width) {
  return {
    x: index % width,
    y: Math.floor(index / width)
  };
}

function calculateBounds(cells, width) {
  if (cells.length === 0) {
    return null;
  }

  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity
  };

  for (const cell of cells) {
    const point = localPoint(cell.index, width);
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }

  return bounds;
}

function isNonEmptyCell(cell) {
  return hasGround(cell) || hasFloor(cell) || hasItem(cell) || hasFlags(cell) || hasEffects(cell) || Boolean(cell.character);
}

function hasGround(cell) {
  return Boolean(cell.groundSpriteId || cell.groundOverlaySpriteId);
}

function hasFloor(cell) {
  return Boolean(cell.floorSpriteId || cell.floorOverlaySpriteId);
}

function hasItem(cell) {
  return Boolean(cell.itemSpriteId);
}

function hasFlags(cell) {
  return Boolean(cell.flags);
}

function hasEffects(cell) {
  return Boolean(cell.effects?.some((effect) => effect !== 0));
}
