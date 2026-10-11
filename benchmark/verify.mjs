// Independent pngjs decoding, including full-depth samples and every APNG frame.
import { PNG } from 'pngjs';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  crcTable[i] = c >>> 0;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ b) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length);
  out.write(type, 4, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
  return out;
}
function pixels(bytes) {
  const depth = bytes[24];
  const decoded = PNG.sync.read(bytes, { skipRescale: depth === 16 });
  // An 8-bit sample that can replace a 16-bit sample is replicated, not rounded.
  const rgba = new Uint16Array(decoded.data.length);
  for (let i = 0; i < rgba.length; i++) rgba[i] = decoded.data[i] * (depth === 16 ? 1 : 257);
  return { width: decoded.width, height: decoded.height, rgba };
}
export function decodePng(bytes) {
  const input = Buffer.from(bytes);
  const result = { image: pixels(input), animation: null, frames: [] };
  let header;
  const palette = [];
  let frame = null;
  const finishFrame = () => {
    if (!frame) return;
    if (frame.data.length === 0) throw new Error('APNG frame has no image data');
    const ihdr = Buffer.from(header);
    frame.control.copy(ihdr, 0, 0, 8);
    const png = Buffer.concat([signature, chunk('IHDR', ihdr), ...palette,
      chunk('IDAT', Buffer.concat(frame.data)), chunk('IEND', Buffer.alloc(0))]);
    result.frames.push({ control: frame.control, image: pixels(png) });
    frame = null;
  };
  let ended = false;
  for (let pos = 8; pos < input.length;) {
    if (pos + 12 > input.length) throw new Error('Truncated PNG chunk');
    const size = input.readUInt32BE(pos);
    const end = pos + 12 + size;
    if (end > input.length) throw new Error('Truncated PNG chunk data');
    if (crc32(input.subarray(pos + 4, end - 4)) !== input.readUInt32BE(end - 4)) throw new Error('Invalid PNG CRC');
    const type = input.toString('ascii', pos + 4, pos + 8);
    const data = input.subarray(pos + 8, end - 4);
    if (type === 'IHDR') header = data;
    else if (type === 'PLTE' || type === 'tRNS') palette.push(chunk(type, data));
    else if (type === 'acTL') result.animation = data;
    else if (type === 'fcTL') {
      finishFrame();
      frame = { control: data.subarray(4), data: [] };
    } else if (type === 'fdAT') {
      if (!frame) throw new Error('APNG data without frame control');
      frame.data.push(data.subarray(4));
    } else if (type === 'IDAT' && frame) frame.data.push(data);
    else if (type === 'IEND') { finishFrame(); ended = true; break; }
    pos = end;
  }
  if (!ended) throw new Error('Missing PNG end');
  if (result.animation && result.frames.length !== result.animation.readUInt32BE(0)) throw new Error('APNG frame count mismatch');
  return result;
}
export function assertPngEqual(original, output) {
  const equalImage = (a, b) => a.width === b.width && a.height === b.height &&
    Buffer.from(a.rgba.buffer).equals(Buffer.from(b.rgba.buffer));
  if (!equalImage(original.image, output.image)) throw new Error('PNG pixels changed');
  if (!Buffer.from(original.animation ?? []).equals(Buffer.from(output.animation ?? [])) ||
      original.frames.length !== output.frames.length) throw new Error('APNG animation changed');
  for (let i = 0; i < original.frames.length; i++) {
    const a = original.frames[i], b = output.frames[i];
    if (!a.control.equals(b.control) || !equalImage(a.image, b.image)) throw new Error(`APNG frame ${i} changed`);
  }
}
