export const DEFAULT_MOVEMENT_PREDICTION_CONFIRMATION_TICKS = 3;

export function normalizeMovementPredictionOptions(options = {}) {
  if (options === false) {
    return {
      enabled: false,
      confirmationTickWindow: DEFAULT_MOVEMENT_PREDICTION_CONFIRMATION_TICKS
    };
  }

  const config = options ?? {};
  return {
    enabled: config.enabled !== false,
    confirmationTickWindow: positiveInteger(
      config.confirmationTickWindow,
      DEFAULT_MOVEMENT_PREDICTION_CONFIRMATION_TICKS
    )
  };
}

export function initialMovementPredictionState(config) {
  return {
    enabled: config.enabled,
    confirmationTickWindow: config.confirmationTickWindow,
    status: config.enabled ? 'idle' : 'disabled',
    pending: null,
    lastPredictedUpdate: null,
    lastAuthoritativeReconciliation: null,
    reason: config.enabled ? null : 'disabled'
  };
}

export function createFirstStepMovementPrediction(snapshot, target, options = {}) {
  const sentAfterDecodedTicks = nonNegativeInteger(options.sentAfterDecodedTicks, 0);
  const confirmationTickWindow = positiveInteger(
    options.confirmationTickWindow,
    DEFAULT_MOVEMENT_PREDICTION_CONFIRMATION_TICKS
  );
  const originalPosition = clonePoint(snapshot?.player?.position);
  const normalizedTarget = clonePoint(target);

  if (!isPoint(originalPosition)) {
    return skippedPrediction('missing-authoritative-player', normalizedTarget, options);
  }
  if (!isPoint(normalizedTarget)) {
    return skippedPrediction('invalid-target', normalizedTarget, options, originalPosition);
  }

  const predictedPosition = firstStepToward(originalPosition, normalizedTarget);
  if (!predictedPosition) {
    return skippedPrediction('target-is-current-position', normalizedTarget, options, originalPosition);
  }

  const sentAtMs = nullableNumber(options.sentAtMs);
  const visualAtMs = nullableNumber(options.visualAtMs) ?? sentAtMs;

  return {
    status: 'pending',
    id: options.id ?? null,
    target: normalizedTarget,
    originalPosition,
    predictedPosition,
    step: {
      x: predictedPosition.x - originalPosition.x,
      y: predictedPosition.y - originalPosition.y
    },
    sentAfterDecodedTicks,
    expiresAfterDecodedTicks: sentAfterDecodedTicks + confirmationTickWindow,
    confirmationTickWindow,
    sentAtMs,
    visualAtMs,
    visualMs: sentAtMs !== null && visualAtMs !== null ? roundMs(visualAtMs - sentAtMs) : null,
    outboundFrame: options.outboundFrame ?? null,
    currentTick: snapshot?.currentTick ?? null
  };
}

export function reconcileMovementPrediction(prediction, snapshot, options = {}) {
  if (!prediction || prediction.status !== 'pending') {
    return null;
  }

  const decodedTicks = nonNegativeInteger(options.decodedTicks, prediction.sentAfterDecodedTicks);
  const nowMs = nullableNumber(options.nowMs);
  const authoritativePosition = clonePoint(snapshot?.player?.position);
  const confirmationTicks = Math.max(0, decodedTicks - prediction.sentAfterDecodedTicks);
  const base = {
    predictionId: prediction.id,
    target: clonePoint(prediction.target),
    originalPosition: clonePoint(prediction.originalPosition),
    predictedPosition: clonePoint(prediction.predictedPosition),
    authoritativePosition,
    decodedTicks,
    currentTick: snapshot?.currentTick ?? null,
    confirmationTicks,
    confirmationMs: prediction.sentAtMs !== null && nowMs !== null ? roundMs(nowMs - prediction.sentAtMs) : null
  };

  if (!isPoint(authoritativePosition)) {
    return {
      ...base,
      status: 'rejected',
      reason: 'missing-authoritative-player'
    };
  }

  if (samePoint(authoritativePosition, prediction.predictedPosition)) {
    return {
      ...base,
      status: 'accepted',
      reason: 'authoritative-position-matched'
    };
  }

  if (!samePoint(authoritativePosition, prediction.originalPosition)) {
    return {
      ...base,
      status: 'rejected',
      reason: 'authoritative-position-diverged'
    };
  }

  if (decodedTicks >= prediction.expiresAfterDecodedTicks) {
    return {
      ...base,
      status: 'rejected',
      reason: 'confirmation-window-expired'
    };
  }

  return {
    ...base,
    status: 'pending',
    reason: 'awaiting-authoritative-confirmation'
  };
}

export function createPredictedMovementSnapshot(snapshot, prediction) {
  if (!snapshot || !prediction || prediction.status !== 'pending') {
    return snapshot;
  }

  const player = snapshot.player;
  if (!player || !isPoint(player.position)) {
    return snapshot;
  }

  const delta = {
    x: prediction.predictedPosition.x - prediction.originalPosition.x,
    y: prediction.predictedPosition.y - prediction.originalPosition.y
  };
  const predictedPlayer = moveCharacterSnapshot(player, delta, prediction.predictedPosition, true);
  const visibleWorld = snapshot.visibleWorld ?? {};
  const sourceCharacters = Array.isArray(visibleWorld.characters) ? visibleWorld.characters : [];
  let movedPlayerCharacter = false;
  const characters = sourceCharacters.map((character) => {
    if (!isPlayerCharacter(character, player, prediction.originalPosition)) {
      return character;
    }

    movedPlayerCharacter = true;
    return moveCharacterSnapshot(character, delta, prediction.predictedPosition, true);
  });

  if (!movedPlayerCharacter) {
    characters.push(predictedPlayer);
  }

  return {
    ...snapshot,
    position: clonePoint(prediction.predictedPosition),
    player: predictedPlayer,
    visibleWorld: {
      ...visibleWorld,
      characters
    }
  };
}

function firstStepToward(origin, target) {
  const dx = Math.sign(target.x - origin.x);
  const dy = Math.sign(target.y - origin.y);
  if (dx === 0 && dy === 0) {
    return null;
  }

  return {
    x: origin.x + dx,
    y: origin.y + dy
  };
}

function skippedPrediction(reason, target, options, originalPosition = null) {
  return {
    status: 'skipped',
    reason,
    target: clonePoint(target),
    originalPosition: clonePoint(originalPosition),
    sentAfterDecodedTicks: nonNegativeInteger(options.sentAfterDecodedTicks, 0),
    outboundFrame: options.outboundFrame ?? null,
    currentTick: options.currentTick ?? null
  };
}

function isPlayerCharacter(character, player, originalPosition) {
  if (!character || !player) {
    return false;
  }

  if (player.id !== undefined && player.id !== null && String(character.id) === String(player.id)) {
    return samePoint(character.world, originalPosition);
  }

  return samePoint(character.local, player.local) && samePoint(character.world, originalPosition);
}

function moveCharacterSnapshot(character, delta, position, predicted) {
  return {
    ...character,
    local: shiftPoint(character.local, delta),
    world: clonePoint(position),
    position: clonePoint(position),
    predicted
  };
}

function shiftPoint(point, delta) {
  if (!isPoint(point)) {
    return clonePoint(point);
  }

  return {
    x: point.x + delta.x,
    y: point.y + delta.y
  };
}

function samePoint(left, right) {
  return isPoint(left) && isPoint(right) && left.x === right.x && left.y === right.y;
}

function isPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function clonePoint(point) {
  return point ? { ...point } : null;
}

function nullableNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}
