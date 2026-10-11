/** Monotonic clock in milliseconds, available in browsers and Node. */
export function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Tracks a processing timeout, warning once when it is exceeded. */
export class Deadline {
  private readonly start: number;
  private readonly timeoutMs: number | null;
  private printMessage = true;

  private readonly warn: (msg: string) => void;
  constructor(
    timeoutSeconds: number | null,
    warn: (msg: string) => void = () => {},
  ) {
    this.warn = warn;
    this.start = now();
    this.timeoutMs = timeoutSeconds === null ? null : timeoutSeconds * 1000;
  }

  /** True once the timeout has passed and no new work should be done. */
  passed(): boolean {
    if (this.timeoutMs === null) return false;
    const elapsed = now() - this.start;
    if (elapsed > this.timeoutMs) {
      if (this.printMessage) {
        this.printMessage = false;
        this.warn(`Timed out after ${Math.floor(elapsed / 1000)} second(s)`);
      }
      return true;
    }
    return false;
  }
}

/** An atomic-like minimum tracker. */
export class AtomicMin {
  private value: number;

  constructor(init: number | null) {
    this.value = init ?? Number.MAX_SAFE_INTEGER;
  }

  get(): number | null {
    return this.value === Number.MAX_SAFE_INTEGER ? null : this.value;
  }

  /** Try a new value, returning true if it is the new minimum. */
  setMin(newValue: number): boolean {
    if (newValue < this.value) {
      this.value = newValue;
      return true;
    }
    return false;
  }
}
