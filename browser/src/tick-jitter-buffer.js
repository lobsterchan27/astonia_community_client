const DEFAULT_OPTIONS = {
  initialTargetDepth: 1,
  minTargetDepth: 1,
  maxTargetDepth: 5,
  fallbackTickIntervalMs: 50,
  minTickIntervalMs: 16,
  maxTickIntervalMs: 250,
  maxInitialHoldMs: 90,
  stableSampleThreshold: 6
};

export class AdaptiveTickJitterBuffer {
  #options;
  #queue;
  #targetDepth;
  #targetChanges;
  #arrivalEwmaMs;
  #arrivalJitterEwmaMs;
  #arrivalSamples;
  #stableSamples;
  #lastArrivalAtMs;
  #firstQueuedAtMs;
  #lastPlaybackAtMs;
  #playing;
  #waitingForArrival;
  #recoveringSinceMs;
  #metrics;

  constructor(options = {}) {
    this.#options = { ...DEFAULT_OPTIONS, ...options };
    this.#targetDepth = clampInteger(
      this.#options.initialTargetDepth,
      this.#options.minTargetDepth,
      this.#options.maxTargetDepth
    );
    this.#queue = [];
    this.#targetChanges = [];
    this.#arrivalEwmaMs = null;
    this.#arrivalJitterEwmaMs = 0;
    this.#arrivalSamples = 0;
    this.#stableSamples = 0;
    this.#lastArrivalAtMs = null;
    this.#firstQueuedAtMs = null;
    this.#lastPlaybackAtMs = null;
    this.#playing = false;
    this.#waitingForArrival = false;
    this.#recoveringSinceMs = null;
    this.#metrics = initialMetrics(this.#targetDepth, this.#estimatedTickIntervalMs());
  }

  enqueueTicks(ticks, nowMs) {
    if (!Array.isArray(ticks) || ticks.length === 0) {
      return this.metrics();
    }

    this.#recordArrival(nowMs);
    for (const tick of ticks) {
      this.#queue.push({ tick, queuedAtMs: nowMs });
    }
    if (this.#firstQueuedAtMs === null) {
      this.#firstQueuedAtMs = nowMs;
    }
    if (this.#waitingForArrival && this.#targetDepth > this.#options.minTargetDepth) {
      this.#recoveringSinceMs ??= this.#firstQueuedAtMs;
    }
    this.#waitingForArrival = false;
    this.#metrics.ticksQueued += ticks.length;
    this.#metrics.queueDepth = this.#queue.length;
    this.#metrics.maxQueueDepth = Math.max(this.#metrics.maxQueueDepth, this.#queue.length);
    return this.metrics();
  }

  recordDecodeTiming(durationMs) {
    this.#recordDuration('decodeMs', 'averageDecodeMs', durationMs);
  }

  recordUpdateTiming(durationMs) {
    this.#recordDuration('updateMs', 'averageUpdateMs', durationMs);
  }

  recordRenderTiming(durationMs) {
    this.#recordDuration('renderMs', 'averageRenderMs', durationMs);
  }

  takeTick(nowMs) {
    if (this.#queue.length === 0) {
      if (this.#playing && !this.#waitingForArrival) {
        this.#recordUnderflow(nowMs);
      }
      return null;
    }

    const entry = this.#queue.shift();
    this.#playing = true;
    this.#waitingForArrival = false;
    this.#recoveringSinceMs = null;
    this.#lastPlaybackAtMs = nowMs;
    this.#firstQueuedAtMs = this.#queue.length > 0 ? this.#queue[0].queuedAtMs : null;
    this.#metrics.ticksReplayed += 1;
    this.#metrics.queueDepth = this.#queue.length;
    this.#metrics.lastReplayDelayMs = roundMs(nowMs - entry.queuedAtMs);
    return entry.tick;
  }

  nextDelayMs(nowMs) {
    const intervalMs = this.#estimatedTickIntervalMs();
    if (this.#queue.length === 0) {
      if (!this.#playing || this.#waitingForArrival || this.#lastPlaybackAtMs === null) {
        return null;
      }
      return Math.max(0, intervalMs - (nowMs - this.#lastPlaybackAtMs));
    }

    if (this.#queue.length > this.#targetDepth) {
      return 0;
    }

    if (this.#recoveringSinceMs !== null) {
      if (this.#queue.length >= this.#targetDepth) {
        return 0;
      }

      const holdMs = Math.min(this.#options.maxInitialHoldMs, intervalMs * this.#targetDepth);
      return Math.max(0, holdMs - (nowMs - this.#recoveringSinceMs));
    }

    if (!this.#playing || this.#waitingForArrival) {
      const holdMs = Math.min(this.#options.maxInitialHoldMs, intervalMs * this.#targetDepth);
      return Math.max(0, holdMs - (nowMs - this.#firstQueuedAtMs));
    }

    if (this.#lastPlaybackAtMs === null) {
      return 0;
    }

    return Math.max(0, intervalMs - (nowMs - this.#lastPlaybackAtMs));
  }

  metrics() {
    return {
      ...this.#metrics,
      targetQueueDepth: this.#targetDepth,
      queueDepth: this.#queue.length,
      estimatedTickIntervalMs: roundMs(this.#estimatedTickIntervalMs()),
      tickArrivalIntervalMs: nullableRoundMs(this.#metrics.tickArrivalIntervalMs),
      averageTickArrivalIntervalMs: nullableRoundMs(this.#arrivalEwmaMs),
      tickArrivalJitterMs: roundMs(this.#arrivalJitterEwmaMs),
      decodeMs: nullableRoundMs(this.#metrics.decodeMs),
      averageDecodeMs: nullableRoundMs(this.#metrics.averageDecodeMs),
      updateMs: nullableRoundMs(this.#metrics.updateMs),
      averageUpdateMs: nullableRoundMs(this.#metrics.averageUpdateMs),
      renderMs: nullableRoundMs(this.#metrics.renderMs),
      averageRenderMs: nullableRoundMs(this.#metrics.averageRenderMs),
      lastReplayDelayMs: nullableRoundMs(this.#metrics.lastReplayDelayMs),
      lastBufferTargetChange: this.#metrics.lastBufferTargetChange
        ? { ...this.#metrics.lastBufferTargetChange }
        : null,
      bufferTargetChanges: this.#targetChanges.map((change) => ({ ...change }))
    };
  }

  #recordArrival(nowMs) {
    if (this.#lastArrivalAtMs !== null) {
      const intervalMs = Math.max(0, nowMs - this.#lastArrivalAtMs);
      this.#metrics.tickArrivalIntervalMs = intervalMs;
      this.#arrivalSamples += 1;

      if (this.#arrivalEwmaMs === null) {
        this.#arrivalEwmaMs = intervalMs;
      } else {
        const previousAverage = this.#arrivalEwmaMs;
        this.#arrivalEwmaMs += (intervalMs - this.#arrivalEwmaMs) * 0.2;
        this.#arrivalJitterEwmaMs += (Math.abs(intervalMs - previousAverage) - this.#arrivalJitterEwmaMs) * 0.25;
      }

      this.#adaptForArrival(nowMs, intervalMs);
    }

    this.#lastArrivalAtMs = nowMs;
  }

  #adaptForArrival(nowMs, intervalMs) {
    const averageMs = this.#estimatedTickIntervalMs();
    const stableJitterMs = Math.max(4, averageMs * 0.18);
    const burstyJitterMs = Math.max(12, averageMs * 0.45);
    const recentUnderflow = this.#metrics.lastUnderflowAtMs !== null && nowMs - this.#metrics.lastUnderflowAtMs < averageMs * 8;
    const bursty = this.#arrivalSamples >= 2 && (intervalMs > averageMs * 2.2 || this.#arrivalJitterEwmaMs > burstyJitterMs);

    if (bursty) {
      this.#stableSamples = 0;
      if (this.#targetDepth < 2) {
        this.#changeTargetDepth(2, 'bursty delivery', nowMs);
      } else if (this.#arrivalJitterEwmaMs > averageMs * 0.9) {
        this.#changeTargetDepth(this.#targetDepth + 1, 'bursty delivery', nowMs);
      }
      return;
    }

    if (this.#arrivalJitterEwmaMs <= stableJitterMs && intervalMs <= averageMs * 1.35 && !recentUnderflow) {
      this.#stableSamples += 1;
      if (this.#stableSamples >= this.#options.stableSampleThreshold && this.#targetDepth > this.#options.minTargetDepth) {
        this.#changeTargetDepth(this.#targetDepth - 1, 'stable arrivals', nowMs);
        this.#stableSamples = 0;
      }
      return;
    }

    this.#stableSamples = 0;
  }

  #recordUnderflow(nowMs) {
    this.#metrics.underflows += 1;
    this.#metrics.lastUnderflowAtMs = roundMs(nowMs);
    this.#waitingForArrival = true;
    this.#stableSamples = 0;
    this.#changeTargetDepth(this.#targetDepth + 1, 'underflow', nowMs);
  }

  #changeTargetDepth(nextDepth, reason, nowMs) {
    const clampedDepth = clampInteger(nextDepth, this.#options.minTargetDepth, this.#options.maxTargetDepth);
    if (clampedDepth === this.#targetDepth) {
      return;
    }

    const change = {
      atMs: roundMs(nowMs),
      from: this.#targetDepth,
      to: clampedDepth,
      reason,
      queueDepth: this.#queue.length,
      underflows: this.#metrics.underflows,
      tickArrivalJitterMs: roundMs(this.#arrivalJitterEwmaMs)
    };
    this.#targetDepth = clampedDepth;
    this.#targetChanges.push(change);
    this.#targetChanges = this.#targetChanges.slice(-8);
    this.#metrics.lastBufferTargetChange = change;
  }

  #recordDuration(lastKey, averageKey, durationMs) {
    const roundedDuration = Math.max(0, durationMs);
    this.#metrics[lastKey] = roundedDuration;
    this.#metrics[averageKey] =
      this.#metrics[averageKey] === null
        ? roundedDuration
        : this.#metrics[averageKey] + (roundedDuration - this.#metrics[averageKey]) * 0.2;
  }

  #estimatedTickIntervalMs() {
    return clampNumber(
      this.#arrivalEwmaMs ?? this.#options.fallbackTickIntervalMs,
      this.#options.minTickIntervalMs,
      this.#options.maxTickIntervalMs
    );
  }
}

function initialMetrics(targetDepth, estimatedTickIntervalMs) {
  return {
    targetQueueDepth: targetDepth,
    queueDepth: 0,
    maxQueueDepth: 0,
    ticksQueued: 0,
    ticksReplayed: 0,
    underflows: 0,
    lastUnderflowAtMs: null,
    tickArrivalIntervalMs: null,
    averageTickArrivalIntervalMs: null,
    tickArrivalJitterMs: 0,
    estimatedTickIntervalMs,
    decodeMs: null,
    averageDecodeMs: null,
    updateMs: null,
    averageUpdateMs: null,
    renderMs: null,
    averageRenderMs: null,
    lastReplayDelayMs: null,
    lastBufferTargetChange: null,
    bufferTargetChanges: []
  };
}

function clampInteger(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function clampNumber(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function nullableRoundMs(value) {
  return value === null || value === undefined ? null : roundMs(value);
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}
