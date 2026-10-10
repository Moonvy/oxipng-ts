/** Adler-32 checksum (RFC 1950), as used by the zlib wrapper. */
const BASE = 65521;

export function adler32(data: Uint8Array, seed = 1): number {
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
  return (((b << 16) | a) >>> 0);
}
