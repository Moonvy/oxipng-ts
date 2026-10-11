/**
 * A minimal growable byte buffer backed by a `Uint8Array`.
 *
 * This mirrors the parts of Rust's `Vec<u8>` that the port relies on — in
 * particular the ability to `truncate` and `reserve`, which the filtering code
 * uses to trial each filter in place.
 */
export class ByteBuffer {
  buf: Uint8Array;
  len: number;

  constructor(capacity: number = 0) {
    this.buf = new Uint8Array(capacity);
    this.len = 0;
  }

  static from(bytes: Uint8Array): ByteBuffer {
    const b = new ByteBuffer(bytes.length);
    b.buf.set(bytes, 0);
    b.len = bytes.length;
    return b;
  }

  reserve(additional: number): void {
    const required = this.len + additional;
    if (required <= this.buf.length) return;
    let capacity = this.buf.length === 0 ? 32 : this.buf.length;
    while (capacity < required) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.buf.subarray(0, this.len), 0);
    this.buf = next;
  }

  push(byte: number): void {
    if (this.len >= this.buf.length) this.reserve(1);
    this.buf[this.len++] = byte & 0xff;
  }

  extend(bytes: ArrayLike<number>): void {
    const n = bytes.length;
    if (n === 0) return;
    this.reserve(n);
    if (bytes instanceof Uint8Array) {
      this.buf.set(bytes, this.len);
    } else {
      for (let i = 0; i < n; i++) this.buf[this.len + i] = bytes[i] & 0xff;
    }
    this.len += n;
  }

  truncate(newLen: number): void {
    if (newLen < this.len) this.len = newLen;
  }

  /** Zero-fill and extend by `count` bytes (used by alpha cleaning). */
  extendZeros(count: number): void {
    this.reserve(count);
    this.buf.fill(0, this.len, this.len + count);
    this.len += count;
  }

  /** Fill and extend by `count` copies of `value`. */
  extendFill(value: number, count: number): void {
    this.reserve(count);
    this.buf.fill(value & 0xff, this.len, this.len + count);
    this.len += count;
  }

  /** A copy of the live portion of the buffer. */
  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}
