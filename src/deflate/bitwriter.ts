/** LSB-first bit writer for DEFLATE streams. */

/** Thrown when the output would exceed the writer's size limit. */
export class SizeLimitExceeded extends Error {
  constructor() {
    super('Compressed size limit exceeded');
    this.name = 'SizeLimitExceeded';
  }
}

// Exact powers of two for the wide (f64) bit accumulator.
const POW2 = new Float64Array(56);
for (let i = 0; i < POW2.length; i++) POW2[i] = 2 ** i;

export class BitWriter {
  private buf: Uint8Array;
  private capacity: number;
  len = 0;
  // Number accumulator holding `bitCnt` valid bits. Callers write at most 28
  // bits at a time and `bitCnt` < 8 on entry, so it stays below 2^36 — exact
  // in an f64.
  private bitBuf = 0;
  private bitCnt = 0;
  private readonly limit: number;

  constructor(capacity = 4096, limit: number = Infinity) {
    this.capacity = Math.max(1, Math.min(capacity, Math.max(0, Math.floor(limit))));
    this.buf = new Uint8Array(this.capacity);
    this.limit = limit;
  }

  private ensure(extra: number): void {
    if (this.len + extra > this.limit) throw new SizeLimitExceeded();
    if (this.len + extra <= this.capacity) return;
    let c = this.capacity;
    while (this.len + extra > c) c *= 2;
    const next = new Uint8Array(c);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.capacity = c;
  }

  /** Reserve `n` bytes at the current position (filled in by the caller later). */
  skip(n: number): void {
    this.alignToByte();
    this.ensure(n);
    this.len += n;
  }

  /** Write the low `count` bits of `value`, least-significant bit first. `count` must be ≤ 28. */
  writeBits(value: number, count: number): void {
    let bits = this.bitBuf + value * POW2[this.bitCnt];
    let cnt = this.bitCnt + count;
    if (cnt >= 8) {
      this.ensure(cnt >> 3);
      const buf = this.buf;
      let len = this.len;
      do {
        buf[len++] = bits & 0xff;
        bits = Math.floor(bits / 256);
        cnt -= 8;
      } while (cnt >= 8);
      this.len = len;
    }
    this.bitBuf = bits;
    this.bitCnt = cnt;
  }

  alignToByte(): void {
    if (this.bitCnt > 0) {
      this.ensure(1);
      // bitCnt < 8 here, so bitBuf fits in one byte.
      this.buf[this.len++] = this.bitBuf;
      this.bitBuf = 0;
      this.bitCnt = 0;
    }
  }

  pushBytes(bytes: Uint8Array): void {
    this.alignToByte();
    this.ensure(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }

  finish(): Uint8Array {
    this.alignToByte();
    return this.buf.subarray(0, this.len);
  }
}
