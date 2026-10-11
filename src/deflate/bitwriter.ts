/** LSB-first bit writer for DEFLATE streams. */

/** Thrown when the output would exceed the writer's size limit. */
export class SizeLimitExceeded extends Error {
  constructor() {
    super('Compressed size limit exceeded');
    this.name = 'SizeLimitExceeded';
  }
}

export class BitWriter {
  private buf: Uint8Array;
  private capacity: number;
  len: number = 0;
  // Fewer than eight pending bits between writes. A write can span 35 bits;
  // retain its overflow separately while flushing the low 32-bit word.
  private bitBuf: number = 0;
  private bitCnt: number = 0;
  private readonly limit: number;

  constructor(capacity: number = 4096, limit: number = Infinity) {
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
    const pending = this.bitCnt;
    let bits = (this.bitBuf | (value << pending)) >>> 0;
    let cnt = pending + count;
    const overflow = cnt > 32 ? value >>> (32 - pending) : 0;
    if (cnt >= 8) {
      this.ensure(cnt >> 3);
      const buf = this.buf;
      let len = this.len;
      do {
        buf[len++] = bits & 0xff;
        bits >>>= 8;
        cnt -= 8;
      } while (cnt >= 8);
      this.len = len;
    }
    this.bitBuf = bits | overflow;
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
