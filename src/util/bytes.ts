export function readBeU16(bytes: Uint8Array, offset = 0): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

export function readBeU32(bytes: Uint8Array, offset = 0): number {
  return (
    (bytes[offset] * 0x1000000 + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])) >>>
    0
  );
}

export function writeBeU16(value: number, out: Uint8Array, offset = 0): void {
  out[offset] = (value >>> 8) & 0xff;
  out[offset + 1] = value & 0xff;
}

export function writeBeU32(value: number, out: Uint8Array, offset = 0): void {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

/** CRC-32 (IEEE 802.3) as used by PNG chunks. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  const table = CRC_TABLE;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
