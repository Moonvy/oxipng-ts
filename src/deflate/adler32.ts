/** Adler-32 checksum (RFC 1950), as used by the zlib wrapper. */
const BASE = 65521;

export function adler32(data: Uint8Array, seed: number = 1): number {
  const bytes = new Uint8Array(4);
  adler32Bytes(data, bytes, seed);
  return (((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0);
}

/** Write Adler-32 as big-endian bytes without forming an unsigned 32-bit value. */
export function adler32Bytes(data: Uint8Array, output: Uint8Array, seed: number): void {
  let a = seed & 0xffff;
  let b = (seed >>> 16) & 0xffff;
  let i = 0;
  const n = data.length;
  while (i < n) {
    // Process in blocks small enough that the sums cannot overflow 32 bits.
    const end = Math.min(i + 5552, n);
    while (i + 8 <= end) {
      a += data[i]; b += a;
      a += data[i + 1]; b += a;
      a += data[i + 2]; b += a;
      a += data[i + 3]; b += a;
      a += data[i + 4]; b += a;
      a += data[i + 5]; b += a;
      a += data[i + 6]; b += a;
      a += data[i + 7]; b += a;
      i += 8;
    }
    while (i < end) {
      a += data[i++];
      b += a;
    }
    a %= BASE;
    b %= BASE;
  }
  output[0] = (b >>> 8) & 0xff;
  output[1] = b & 0xff;
  output[2] = (a >>> 8) & 0xff;
  output[3] = a & 0xff;
}
