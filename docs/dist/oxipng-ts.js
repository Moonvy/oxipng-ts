function rgba8(r, g, b, a) {
    return (r << 24 | g << 16 | b << 8 | a) >>> 0;
}
function rgba8R(c) {
    return c >>> 24 & 0xff;
}
function rgba8G(c) {
    return c >>> 16 & 0xff;
}
function rgba8B(c) {
    return c >>> 8 & 0xff;
}
function rgba8A(c) {
    return 0xff & c;
}
function grayscale(transparentShade = null) {
    return {
        kind: 'grayscale',
        transparentShade
    };
}
function rgb(transparentColor = null) {
    return {
        kind: 'rgb',
        transparentColor
    };
}
function colors_indexed(palette) {
    return {
        kind: 'indexed',
        palette
    };
}
const GRAYSCALE_ALPHA = {
    kind: 'grayscaleAlpha'
};
const RGBA = {
    kind: 'rgba'
};
function pngHeaderCode(ct) {
    switch(ct.kind){
        case 'grayscale':
            return 0;
        case 'rgb':
            return 2;
        case 'indexed':
            return 3;
        case 'grayscaleAlpha':
            return 4;
        case 'rgba':
            return 6;
    }
}
function channelsPerPixel(ct) {
    switch(ct.kind){
        case 'grayscale':
        case 'indexed':
            return 1;
        case 'grayscaleAlpha':
            return 2;
        case 'rgb':
            return 3;
        case 'rgba':
            return 4;
    }
}
function isRgb(ct) {
    return 'rgb' === ct.kind || 'rgba' === ct.kind;
}
function colors_isGray(ct) {
    return 'grayscale' === ct.kind || 'grayscaleAlpha' === ct.kind;
}
function hasAlpha(ct) {
    return 'grayscaleAlpha' === ct.kind || 'rgba' === ct.kind;
}
function hasTrns(ct) {
    if ('grayscale' === ct.kind) return null !== ct.transparentShade;
    if ('rgb' === ct.kind) return null !== ct.transparentColor;
    return false;
}
function colorTypeEquals(a, b) {
    if (a.kind !== b.kind) return false;
    switch(a.kind){
        case 'grayscale':
            return a.transparentShade === b.transparentShade;
        case 'rgb':
            {
                const bc = b.transparentColor;
                const ac = a.transparentColor;
                if (null === ac || null === bc) return ac === bc;
                return ac.r === bc.r && ac.g === bc.g && ac.b === bc.b;
            }
        case 'indexed':
            {
                const bp = b.palette;
                if (a.palette.length !== bp.length) return false;
                for(let i = 0; i < a.palette.length; i++)if (a.palette[i] !== bp[i]) return false;
                return true;
            }
        default:
            return true;
    }
}
function colorTypeToString(ct) {
    switch(ct.kind){
        case 'grayscale':
            return 'Grayscale';
        case 'rgb':
            return 'RGB';
        case 'indexed':
            return `Indexed (${ct.palette.length} colors)`;
        case 'grayscaleAlpha':
            return 'Grayscale + Alpha';
        case 'rgba':
            return 'RGB + Alpha';
    }
}
const BitDepth = {
    One: 1,
    Two: 2,
    Four: 4,
    Eight: 8,
    Sixteen: 16
};
function bitDepthFromNumber(value) {
    switch(value){
        case 1:
        case 2:
        case 4:
        case 8:
        case 16:
            return value;
        default:
            throw new Error('invalid bit depth');
    }
}
function chunkNameToString(name) {
    return String.fromCharCode(...name);
}
class PngError extends Error {
    kind;
    size;
    chunk;
    constructor(kind, message, extra){
        super(message);
        this.name = 'PngError';
        this.kind = kind;
        if (extra?.size !== void 0) this.size = extra.size;
        if (extra?.chunk !== void 0) this.chunk = extra.chunk;
    }
    static apngOutOfOrder() {
        return new PngError('APNGOutOfOrder', 'APNG chunks are out of order');
    }
    static c2paMetadataPreventsChanges() {
        return new PngError('C2PAMetadataPreventsChanges', 'The image contains C2PA manifest that would be invalidated by any file changes');
    }
    static chunkMissing(name) {
        return new PngError('ChunkMissing', `Chunk ${name} missing or empty`);
    }
    static chunkPreventsChanges(name) {
        return new PngError('ChunkPreventsChanges', `The image contains a ${chunkNameToString(name)} chunk that would be invalidated by any file changes`, {
            chunk: name
        });
    }
    static crcMismatch(name) {
        return new PngError('CRCMismatch', `CRC mismatch in ${chunkNameToString(name)} chunk; May be recoverable by using --fix`, {
            chunk: name
        });
    }
    static deflatedDataTooLong(size) {
        return new PngError('DeflatedDataTooLong', 'Deflated data too long', {
            size
        });
    }
    static incorrectDataLength(actual, expected) {
        return new PngError('IncorrectDataLength', `Data length ${actual} does not match the expected length ${expected}`, {
            size: expected
        });
    }
    static inflatedDataTooLong(max) {
        return new PngError('InflatedDataTooLong', `Inflated data would exceed the maximum size (${max} bytes)`, {
            size: max
        });
    }
    static invalidData() {
        return new PngError('InvalidData', 'Invalid data found; unable to read PNG file');
    }
    static invalidDepthForType(depth, colorType) {
        return new PngError('InvalidDepthForType', `Invalid bit depth ${depth} for color type ${colorType}`);
    }
    static notPNG() {
        return new PngError('NotPNG', 'Invalid header detected; Not a PNG file');
    }
    static readFailed(source, cause) {
        return new PngError('ReadFailed', `Failed to read from ${source}: ${cause}`);
    }
    static truncatedData() {
        return new PngError('TruncatedData', 'Missing data in the file; the file is truncated');
    }
    static writeFailed(target, cause) {
        return new PngError('WriteFailed', `Failed to write to ${target}: ${cause}`);
    }
    static other(message) {
        return new PngError('Other', message);
    }
}
class SizeLimitExceeded extends Error {
    constructor(){
        super('Compressed size limit exceeded');
        this.name = 'SizeLimitExceeded';
    }
}
class BitWriter {
    buf;
    capacity;
    len = 0;
    bitBuf = 0;
    bitCnt = 0;
    limit;
    constructor(capacity = 4096, limit = 1 / 0){
        this.capacity = Math.max(1, Math.min(capacity, Math.max(0, Math.floor(limit))));
        this.buf = new Uint8Array(this.capacity);
        this.limit = limit;
    }
    ensure(extra) {
        if (this.len + extra > this.limit) throw new SizeLimitExceeded();
        if (this.len + extra <= this.capacity) return;
        let c = this.capacity;
        while(this.len + extra > c)c *= 2;
        const next = new Uint8Array(c);
        next.set(this.buf.subarray(0, this.len));
        this.buf = next;
        this.capacity = c;
    }
    skip(n) {
        this.alignToByte();
        this.ensure(n);
        this.len += n;
    }
    writeBits(value, count) {
        const pending = this.bitCnt;
        let bits = (this.bitBuf | value << pending) >>> 0;
        let cnt = pending + count;
        const overflow = cnt > 32 ? value >>> 32 - pending : 0;
        if (cnt >= 8) {
            this.ensure(cnt >> 3);
            const buf = this.buf;
            let len = this.len;
            do {
                buf[len++] = 0xff & bits;
                bits >>>= 8;
                cnt -= 8;
            }while (cnt >= 8)
            this.len = len;
        }
        this.bitBuf = bits | overflow;
        this.bitCnt = cnt;
    }
    alignToByte() {
        if (this.bitCnt > 0) {
            this.ensure(1);
            this.buf[this.len++] = this.bitBuf;
            this.bitBuf = 0;
            this.bitCnt = 0;
        }
    }
    pushBytes(bytes) {
        this.alignToByte();
        this.ensure(bytes.length);
        this.buf.set(bytes, this.len);
        this.len += bytes.length;
    }
    finish() {
        this.alignToByte();
        return this.buf.subarray(0, this.len);
    }
}
const BASE = 65521;
function adler32Bytes(data, output, seed) {
    let a = 0xffff & seed;
    let b = seed >>> 16 & 0xffff;
    let i = 0;
    const n = data.length;
    while(i < n){
        const end = Math.min(i + 5552, n);
        while(i + 8 <= end){
            a += data[i];
            b += a;
            a += data[i + 1];
            b += a;
            a += data[i + 2];
            b += a;
            a += data[i + 3];
            b += a;
            a += data[i + 4];
            b += a;
            a += data[i + 5];
            b += a;
            a += data[i + 6];
            b += a;
            a += data[i + 7];
            b += a;
            i += 8;
        }
        while(i < end){
            a += data[i++];
            b += a;
        }
        a %= BASE;
        b %= BASE;
    }
    output[0] = b >>> 8 & 0xff;
    output[1] = 0xff & b;
    output[2] = a >>> 8 & 0xff;
    output[3] = 0xff & a;
}
const MAX_SYMBOLS = 286;
const hWeight = new Float64Array(2 * MAX_SYMBOLS);
const hParent = new Int32Array(2 * MAX_SYMBOLS);
const hDepth = new Uint16Array(2 * MAX_SYMBOLS);
const hHeap = new Int32Array(2 * MAX_SYMBOLS);
const hSyms = new Int32Array(MAX_SYMBOLS);
let hHeapSize = 0;
function hLess(a, b) {
    return hWeight[a] < hWeight[b] || hWeight[a] === hWeight[b] && a < b;
}
function hPush(x) {
    let i = hHeapSize++;
    while(i > 0){
        const p = i - 1 >> 1;
        if (!hLess(x, hHeap[p])) break;
        hHeap[i] = hHeap[p];
        i = p;
    }
    hHeap[i] = x;
}
function hPop() {
    const top = hHeap[0];
    hHeapSize--;
    hReplaceRoot(hHeap[hHeapSize]);
    return top;
}
function hReplaceRoot(node) {
    let i = 0;
    for(;;){
        const l = 2 * i + 1;
        if (l >= hHeapSize) break;
        const r = l + 1;
        const child = r < hHeapSize && hLess(hHeap[r], hHeap[l]) ? r : l;
        if (!hLess(hHeap[child], node)) break;
        hHeap[i] = hHeap[child];
        i = child;
    }
    hHeap[i] = node;
}
function optimalLengths(freq, add) {
    const n = freq.length;
    const lens = new Uint8Array(n);
    let k = 0;
    for(let i = 0; i < n; i++)if (freq[i] > 0) hSyms[k++] = i;
    if (0 === k) return lens;
    if (1 === k) {
        lens[hSyms[0]] = 1;
        return lens;
    }
    const N = 2 * k;
    hParent.fill(-1, 0, N);
    for(let i = 0; i < k; i++)hWeight[i] = freq[hSyms[i]] + add;
    hHeapSize = 0;
    for(let i = 0; i < k; i++)hPush(i);
    let next = k;
    while(hHeapSize > 1){
        const a = hPop();
        const b = hHeap[0];
        const node = next++;
        hWeight[node] = hWeight[a] + hWeight[b];
        hParent[a] = node;
        hParent[b] = node;
        hReplaceRoot(node);
    }
    hDepth[next - 1] = 0;
    for(let i = next - 2; i >= 0; i--)hDepth[i] = hDepth[hParent[i]] + 1;
    for(let i = 0; i < k; i++)lens[hSyms[i]] = hDepth[i];
    return lens;
}
function limitedLengths(freq, maxBits) {
    const direct = optimalLengths(freq, 0);
    let max = 0;
    for(let i = 0; i < direct.length; i++)if (direct[i] > max) max = direct[i];
    if (max <= maxBits) return direct;
    let total = 0;
    for(let i = 0; i < freq.length; i++)total += freq[i];
    let lo = 0;
    let hi = total;
    while(lo < hi){
        const mid = lo + hi >> 1;
        const lens = optimalLengths(freq, mid);
        let m = 0;
        for(let i = 0; i < lens.length; i++)if (lens[i] > m) m = lens[i];
        if (m <= maxBits) hi = mid;
        else lo = mid + 1;
    }
    return optimalLengths(freq, lo);
}
function makeComplete(lens) {
    let count = 0;
    let first = -1;
    for(let i = 0; i < lens.length; i++)if (0 !== lens[i]) {
        count++;
        if (first < 0) first = i;
    }
    if (0 === count) {
        lens[0] = 1;
        lens[1] = 1;
    } else if (1 === count) {
        for(let i = 0; i < lens.length; i++)if (i !== first) {
            lens[i] = 1;
            break;
        }
    }
}
const REV8 = new Uint8Array(256);
for(let i = 1; i < 256; i++)REV8[i] = REV8[i >> 1] >> 1 | (1 & i) << 7;
function reverseBits(code, len) {
    return (REV8[0xff & code] << 8 | REV8[code >> 8 & 0xff]) >>> 16 - len;
}
const blCountS = new Uint16Array(16);
const nextCodeS = new Uint16Array(16);
function buildCodes(lengths) {
    let maxLen = 0;
    for(let i = 0; i < lengths.length; i++)if (lengths[i] > maxLen) maxLen = lengths[i];
    const blCount = blCountS.fill(0, 0, maxLen + 1);
    for(let i = 0; i < lengths.length; i++)blCount[lengths[i]]++;
    blCount[0] = 0;
    const nextCode = nextCodeS;
    let code = 0;
    for(let b = 1; b <= maxLen; b++){
        code = code + blCount[b - 1] << 1;
        nextCode[b] = code;
    }
    const codes = new Uint16Array(lengths.length);
    const rev = new Uint16Array(lengths.length);
    for(let s = 0; s < lengths.length; s++){
        const l = lengths[s];
        if (0 === l) continue;
        const c = nextCode[l]++;
        codes[s] = c;
        rev[s] = reverseBits(c, l);
    }
    return {
        lengths,
        codes,
        rev,
        maxLen
    };
}
const LENGTH_BASE = [
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    13,
    15,
    17,
    19,
    23,
    27,
    31,
    35,
    43,
    51,
    59,
    67,
    83,
    99,
    115,
    131,
    163,
    195,
    227,
    258
];
const LENGTH_EXTRA = [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    2,
    2,
    2,
    2,
    3,
    3,
    3,
    3,
    4,
    4,
    4,
    4,
    5,
    5,
    5,
    5,
    0
];
const DIST_BASE = [
    1,
    2,
    3,
    4,
    5,
    7,
    9,
    13,
    17,
    25,
    33,
    49,
    65,
    97,
    129,
    193,
    257,
    385,
    513,
    769,
    1025,
    1537,
    2049,
    3073,
    4097,
    6145,
    8193,
    12289,
    16385,
    24577
];
const DIST_EXTRA = [
    0,
    0,
    0,
    0,
    1,
    1,
    2,
    2,
    3,
    3,
    4,
    4,
    5,
    5,
    6,
    6,
    7,
    7,
    8,
    8,
    9,
    9,
    10,
    10,
    11,
    11,
    12,
    12,
    13,
    13
];
class BitReader {
    pos = 0;
    bitBuf = 0;
    bitCnt = 0;
    src;
    constructor(src){
        this.src = src;
    }
    bit() {
        if (0 === this.bitCnt) {
            if (this.pos >= this.src.length) throw PngError.invalidData();
            this.bitBuf = this.src[this.pos++];
            this.bitCnt = 8;
        }
        const b = 1 & this.bitBuf;
        this.bitBuf >>= 1;
        this.bitCnt--;
        return b;
    }
    bits(count) {
        let v = 0;
        for(let i = 0; i < count; i++)v |= this.bit() << i;
        return v;
    }
    alignToByte() {
        this.bitCnt = 0;
    }
    byte() {
        if (0 !== this.bitCnt) throw PngError.invalidData();
        if (this.pos >= this.src.length) throw PngError.invalidData();
        return this.src[this.pos++];
    }
}
function buildHuffman(lengths, n) {
    const counts = new Uint16Array(16);
    for(let i = 0; i < n; i++)counts[lengths[i]]++;
    counts[0] = 0;
    const offs = new Uint16Array(16);
    let total = 0;
    for(let i = 1; i < 16; i++){
        offs[i] = total;
        total += counts[i];
    }
    const symbols = new Uint16Array(total);
    const cursor = offs.slice();
    for(let s = 0; s < n; s++){
        const l = lengths[s];
        if (0 !== l) symbols[cursor[l]++] = s;
    }
    return {
        counts,
        symbols
    };
}
function decodeSymbol(r, h) {
    let code = 0;
    let first = 0;
    let index = 0;
    for(let len = 1; len <= 15; len++){
        code |= r.bit();
        const count = h.counts[len];
        if (code - first < count) return h.symbols[index + (code - first)];
        index += count;
        first = first + count << 1;
        code <<= 1;
    }
    throw PngError.invalidData();
}
const CL_ORDER = [
    16,
    17,
    18,
    0,
    8,
    7,
    9,
    6,
    10,
    5,
    11,
    4,
    12,
    3,
    13,
    2,
    14,
    1,
    15
];
let fixedLit = null;
let fixedDist = null;
function fixedTables() {
    if (!fixedLit || !fixedDist) {
        const lit = new Uint8Array(288);
        for(let i = 0; i < 144; i++)lit[i] = 8;
        for(let i = 144; i < 256; i++)lit[i] = 9;
        for(let i = 256; i < 280; i++)lit[i] = 7;
        for(let i = 280; i < 288; i++)lit[i] = 8;
        const dist = new Uint8Array(30).fill(5);
        fixedLit = buildHuffman(lit, 288);
        fixedDist = buildHuffman(dist, 30);
    }
    return [
        fixedLit,
        fixedDist
    ];
}
function inflateInto(r, out) {
    let op = 0;
    const cap = out.length;
    for(;;){
        const final = r.bit();
        const type = r.bits(2);
        if (0 === type) {
            r.alignToByte();
            const len = r.byte() | r.byte() << 8;
            const nlen = r.byte() | r.byte() << 8;
            if ((0xffff ^ len) !== nlen) throw PngError.invalidData();
            if (op + len > cap) throw PngError.inflatedDataTooLong(cap);
            for(let i = 0; i < len; i++)out[op++] = r.byte();
        } else if (1 === type || 2 === type) {
            let litHuff;
            let distHuff;
            if (1 === type) [litHuff, distHuff] = fixedTables();
            else {
                const hlit = r.bits(5) + 257;
                const hdist = r.bits(5) + 1;
                const hclen = r.bits(4) + 4;
                const clLengths = new Uint8Array(19);
                for(let i = 0; i < hclen; i++)clLengths[CL_ORDER[i]] = r.bits(3);
                const clHuff = buildHuffman(clLengths, 19);
                const lengths = new Uint8Array(hlit + hdist);
                let i = 0;
                while(i < hlit + hdist){
                    const sym = decodeSymbol(r, clHuff);
                    if (sym < 16) lengths[i++] = sym;
                    else if (16 === sym) {
                        if (0 === i) throw PngError.invalidData();
                        const prev = lengths[i - 1];
                        let rep = r.bits(2) + 3;
                        if (i + rep > hlit + hdist) throw PngError.invalidData();
                        while(rep--)lengths[i++] = prev;
                    } else if (17 === sym) {
                        let rep = r.bits(3) + 3;
                        if (i + rep > hlit + hdist) throw PngError.invalidData();
                        while(rep--)lengths[i++] = 0;
                    } else {
                        let rep = r.bits(7) + 11;
                        if (i + rep > hlit + hdist) throw PngError.invalidData();
                        while(rep--)lengths[i++] = 0;
                    }
                }
                litHuff = buildHuffman(lengths.subarray(0, hlit), hlit);
                distHuff = buildHuffman(lengths.subarray(hlit), hdist);
            }
            for(;;){
                const sym = decodeSymbol(r, litHuff);
                if (256 === sym) break;
                if (sym < 256) {
                    if (op >= cap) throw PngError.inflatedDataTooLong(cap);
                    out[op++] = sym;
                } else {
                    const li = sym - 257;
                    if (li >= LENGTH_BASE.length) throw PngError.invalidData();
                    const length = LENGTH_BASE[li] + (LENGTH_EXTRA[li] ? r.bits(LENGTH_EXTRA[li]) : 0);
                    const dsym = decodeSymbol(r, distHuff);
                    if (dsym >= DIST_BASE.length) throw PngError.invalidData();
                    const dist = DIST_BASE[dsym] + (DIST_EXTRA[dsym] ? r.bits(DIST_EXTRA[dsym]) : 0);
                    if (dist > op) throw PngError.invalidData();
                    if (op + length > cap) throw PngError.inflatedDataTooLong(cap);
                    const from = op - dist;
                    for(let k = 0; k < length; k++)out[op++] = out[from + k];
                }
            }
        } else throw PngError.invalidData();
        if (final) break;
    }
    return op;
}
function inflateRawInto(src, out) {
    return inflateInto(new BitReader(src), out);
}
function inflateZlib(src, outSize) {
    if (src.length < 2) throw PngError.invalidData();
    const cmf = src[0];
    const flg = src[1];
    if ((0x0f & cmf) !== 8) throw PngError.invalidData();
    if ((cmf << 8 | flg) % 31 !== 0) throw PngError.invalidData();
    const out = new Uint8Array(outSize);
    const n = inflateRawInto(src.subarray(2), out);
    return out.subarray(0, n);
}
const WINDOW = 32768;
const WINDOW_MASK = WINDOW - 1;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;
const HASH_MASK = HASH_SIZE - 1;
const BLOCK_SIZE = 262144;
const OPT_BLOCK_SIZE = 0xffff;
const BLOCK_OBSERVATION = 8192;
const MIN_OPT_BLOCK_SIZE = 16384;
const LEVELS = [
    {
        chain: 0,
        lazy: false,
        nice: 0
    },
    {
        chain: 4,
        lazy: false,
        nice: 16
    },
    {
        chain: 8,
        lazy: false,
        nice: 24
    },
    {
        chain: 16,
        lazy: false,
        nice: 32
    },
    {
        chain: 24,
        lazy: true,
        nice: 32
    },
    {
        chain: 32,
        lazy: true,
        nice: 48
    },
    {
        chain: 48,
        lazy: true,
        nice: 64
    },
    {
        chain: 32,
        lazy: true,
        nice: 96
    },
    {
        chain: 64,
        lazy: true,
        nice: 128
    },
    {
        chain: 128,
        lazy: true,
        nice: 160
    }
];
const lenSym = new Uint16Array(MAX_MATCH + 1);
const lenExtraCnt = new Uint8Array(MAX_MATCH + 1);
const lenBase = new Uint16Array(MAX_MATCH + 1);
for(let s = 0; s < LENGTH_BASE.length; s++){
    const base = LENGTH_BASE[s];
    const next = s + 1 < LENGTH_BASE.length ? LENGTH_BASE[s + 1] : MAX_MATCH + 1;
    for(let l = base; l < next && l <= MAX_MATCH; l++){
        lenSym[l] = 257 + s;
        lenExtraCnt[l] = LENGTH_EXTRA[s];
        lenBase[l] = base;
    }
}
const distSym = new Uint8Array(WINDOW + 1);
const distExtraCnt = new Uint8Array(WINDOW + 1);
for(let s = 0; s < DIST_BASE.length; s++){
    const base = DIST_BASE[s];
    const next = s + 1 < DIST_BASE.length ? DIST_BASE[s + 1] : WINDOW + 1;
    for(let d = base; d < next && d <= WINDOW; d++){
        distSym[d] = s;
        distExtraCnt[d] = DIST_EXTRA[s];
    }
}
const deflate_CL_ORDER = [
    16,
    17,
    18,
    0,
    8,
    7,
    9,
    6,
    10,
    5,
    11,
    4,
    12,
    3,
    13,
    2,
    14,
    1,
    15
];
const SIZE_REJECTED = new SizeLimitExceeded();
class SizeCounter {
    bits = 0;
    limit;
    constructor(limit){
        this.limit = limit;
    }
    addBits(bits) {
        this.bits += bits;
        if (this.finish() > this.limit) throw SIZE_REJECTED;
    }
    addStored(bytes) {
        this.bits = 8 * Math.ceil((this.bits + 3) / 8);
        this.addBits(32 + 8 * bytes);
    }
    finish() {
        return Math.ceil(this.bits / 8);
    }
    bitLength() {
        return this.bits;
    }
}
const deflate_head = new Int32Array(HASH_SIZE);
const headEpoch = new Uint32Array(HASH_SIZE);
const head4 = new Int32Array(HASH_SIZE);
const head4Epoch = new Uint32Array(HASH_SIZE);
const head3 = new Int32Array(HASH_SIZE);
const head3Epoch = new Uint32Array(HASH_SIZE);
let wideMatches = false;
let epoch = 0;
const deflate_prev = new Int32Array(WINDOW);
const tLen = new Uint16Array(BLOCK_SIZE + MAX_MATCH);
const tDist = new Uint16Array(BLOCK_SIZE + MAX_MATCH);
const litFreq = new Uint32Array(286);
const distFreq = new Uint32Array(30);
const clFreq = new Uint32Array(19);
const seqSym = new Int32Array(512);
const seqVal = new Int32Array(512);
const seqCnt = new Int32Array(512);
const treeChildren = new Int32Array(2 * WINDOW);
const matchStarts = new Uint32Array(OPT_BLOCK_SIZE + 1);
const matchCache = new Uint32Array(8 * OPT_BLOCK_SIZE);
let cacheCount = 0;
const matchDist = new Uint16Array(OPT_BLOCK_SIZE);
const pathCost = new Uint32Array(OPT_BLOCK_SIZE + 1);
const pathLen = new Uint16Array(OPT_BLOCK_SIZE);
const bestLenTokens = new Uint16Array(OPT_BLOCK_SIZE);
const bestDistTokens = new Uint16Array(OPT_BLOCK_SIZE);
const lengthCosts = new Uint8Array(MAX_MATCH + 1);
const lengthCostEnd = new Uint16Array(MAX_MATCH + 1);
const previousLiteralCosts = new Uint8Array(286);
const previousDistanceCosts = new Uint8Array(30);
const trialLiteralCosts = new Uint8Array(286);
const trialDistanceCosts = new Uint8Array(30);
const blockHistogram = new Uint32Array(256);
const observationHistogram = new Uint32Array(256);
function hashAt(view, p) {
    const h = view.getUint32(p, true);
    if (wideMatches) {
        const h3 = Math.imul(0xffffff & h, 0x9e3779b1) >>> 32 - HASH_BITS;
        head3[h3] = p;
        head3Epoch[h3] = epoch;
        const h4 = Math.imul(h, 0x9e3779b1) >>> 32 - HASH_BITS;
        head4[h4] = p;
        head4Epoch[h4] = epoch;
        if (p + 8 <= view.byteLength) return (Math.imul(h, 0x9e3779b1) ^ Math.imul(view.getUint32(p + 4, true), 0x85ebca6b)) >>> 32 - HASH_BITS;
    }
    return Math.imul(h, 0x9e3779b1) >>> 32 - HASH_BITS & HASH_MASK;
}
function findMatch(data, view, n, pos, chain, nice, insert) {
    let bestLen = 0;
    let bestDist = 0;
    const remaining = n - pos;
    if (remaining < 4) return 0;
    const maxLen = remaining < MAX_MATCH ? remaining : MAX_MATCH;
    {
        const firstWord = view.getUint32(pos, true);
        const h = Math.imul(firstWord, 0x9e3779b1) >>> 32 - HASH_BITS & HASH_MASK;
        let cand = headEpoch[h] === epoch ? deflate_head[h] : -1;
        let depth = chain;
        let bestWord = 0;
        let bestByte = data[pos];
        while(cand >= 0 && depth-- > 0 && pos - cand <= WINDOW){
            if (data[cand + bestLen] === bestByte) {
                let l = 0;
                if (view.getUint32(cand, true) === firstWord) {
                    if (bestLen > 3 && view.getUint32(cand + bestLen - 3, true) !== bestWord) {
                        cand = deflate_prev[cand & WINDOW_MASK];
                        continue;
                    }
                    l = 4;
                    while(l + 4 <= maxLen){
                        const diff = view.getUint32(pos + l, true) ^ view.getUint32(cand + l, true);
                        if (0 !== diff) {
                            l += 31 - Math.clz32(diff & -diff) >>> 3;
                            break;
                        }
                        l += 4;
                    }
                } else if (bestLen >= 3) {
                    cand = deflate_prev[cand & WINDOW_MASK];
                    continue;
                }
                while(l < maxLen && data[cand + l] === data[pos + l])l++;
                if (l > bestLen) {
                    bestLen = l;
                    bestDist = pos - cand;
                    if (l >= nice || l >= maxLen) break;
                    bestByte = data[pos + l];
                    if (l > 3) bestWord = view.getUint32(pos + l - 3, true);
                }
            }
            cand = deflate_prev[cand & WINDOW_MASK];
        }
        if (insert) {
            deflate_prev[pos & WINDOW_MASK] = headEpoch[h] === epoch ? deflate_head[h] : -1;
            headEpoch[h] = epoch;
            deflate_head[h] = pos;
        }
    }
    return 0 === bestLen ? 0 : bestLen << 16 | bestDist - 1;
}
function extendMatch(data, view, pos, cand, max) {
    let len = 4;
    while(len + 4 <= max){
        const diff = view.getUint32(pos + len, true) ^ view.getUint32(cand + len, true);
        if (0 !== diff) {
            len += 31 - Math.clz32(diff & -diff) >>> 3;
            return len;
        }
        len += 4;
    }
    while(len < max && data[pos + len] === data[cand + len])len++;
    return len;
}
function findWideMatch(data, view, end, pos, chain, nice) {
    const remaining = end - pos;
    if (remaining < 3) return 0;
    const first = remaining >= 4 ? view.getUint32(pos, true) : data[pos] | data[pos + 1] << 8 | data[pos + 2] << 16;
    const h3 = Math.imul(0xffffff & first, 0x9e3779b1) >>> 32 - HASH_BITS;
    const short = head3Epoch[h3] === epoch ? head3[h3] : -1;
    let bestLen = 0;
    let bestDist = 0;
    if (short >= 0 && pos - short <= WINDOW && data[short] === data[pos] && data[short + 1] === data[pos + 1] && data[short + 2] === data[pos + 2]) {
        bestLen = 3;
        bestDist = pos - short;
    }
    head3[h3] = pos;
    head3Epoch[h3] = epoch;
    if (remaining >= 4) {
        const max = Math.min(MAX_MATCH, remaining);
        const h4 = Math.imul(first, 0x9e3779b1) >>> 32 - HASH_BITS;
        const near = head4Epoch[h4] === epoch ? head4[h4] : -1;
        if (near >= 0 && pos - near <= WINDOW && view.getUint32(near, true) === first) {
            bestLen = extendMatch(data, view, pos, near, max);
            bestDist = pos - near;
        }
        head4[h4] = pos;
        head4Epoch[h4] = epoch;
        if (remaining >= 8) {
            const h8 = (Math.imul(first, 0x9e3779b1) ^ Math.imul(view.getUint32(pos + 4, true), 0x85ebca6b)) >>> 32 - HASH_BITS;
            let cand = headEpoch[h8] === epoch ? deflate_head[h8] : -1;
            let depth = chain;
            while(bestLen < nice && bestLen < max && cand >= 0 && pos - cand <= WINDOW && depth-- > 0){
                if (data[cand + bestLen] === data[pos + bestLen] && view.getUint32(cand, true) === first) {
                    const len = extendMatch(data, view, pos, cand, max);
                    if (len > bestLen) {
                        bestLen = len;
                        bestDist = pos - cand;
                    }
                }
                cand = deflate_prev[cand & WINDOW_MASK];
            }
            deflate_prev[pos & WINDOW_MASK] = headEpoch[h8] === epoch ? deflate_head[h8] : -1;
            headEpoch[h8] = epoch;
            deflate_head[h8] = pos;
        }
    }
    return 0 === bestLen ? 0 : bestLen << 16 | bestDist - 1;
}
function cacheMatches(data, view, pos, end, depth, nice) {
    const remaining = end - pos;
    if (remaining < 3) return 0;
    const first = remaining >= 4 ? view.getUint32(pos, true) : data[pos] | data[pos + 1] << 8 | data[pos + 2] << 16;
    const h3 = Math.imul(0xffffff & first, 0x9e3779b1) >>> 32 - HASH_BITS;
    const short = head3Epoch[h3] === epoch ? head3[h3] : -1;
    let best = 2;
    if (short >= 0 && pos - short <= WINDOW && data[short] === data[pos] && data[short + 1] === data[pos + 1] && data[short + 2] === data[pos + 2]) {
        best = 3;
        matchCache[cacheCount++] = 196608 | pos - short - 1;
    }
    head3[h3] = pos;
    head3Epoch[h3] = epoch;
    if (remaining < 4) return best;
    const hash = Math.imul(first, 0x9e3779b1) >>> 32 - HASH_BITS;
    let cand = headEpoch[hash] === epoch ? deflate_head[hash] : -1;
    headEpoch[hash] = epoch;
    deflate_head[hash] = pos;
    let left = (pos & WINDOW_MASK) * 2;
    let right = left + 1;
    let leftLength = 0;
    let rightLength = 0;
    const max = Math.min(MAX_MATCH, data.length - pos);
    while(cand >= 0 && pos - cand <= WINDOW && depth-- > 0){
        let len = Math.min(leftLength, rightLength);
        while(len + 4 <= max){
            const diff = (0 === len ? first : view.getUint32(pos + len, true)) ^ view.getUint32(cand + len, true);
            if (0 !== diff) {
                len += 31 - Math.clz32(diff & -diff) >>> 3;
                break;
            }
            len += 4;
        }
        if (len + 4 > max) while(len < max && data[pos + len] === data[cand + len])len++;
        const usable = Math.min(len, remaining);
        if (usable > best) {
            best = usable;
            matchCache[cacheCount++] = usable << 16 | pos - cand - 1;
        }
        const slot = (cand & WINDOW_MASK) * 2;
        if (pos - cand === WINDOW) break;
        if (len >= nice || len === max) {
            treeChildren[left] = treeChildren[slot];
            treeChildren[right] = treeChildren[slot + 1];
            return best;
        }
        if (data[cand + len] < data[pos + len]) {
            treeChildren[left] = cand;
            left = slot + 1;
            cand = treeChildren[left];
            leftLength = len;
        } else {
            treeChildren[right] = cand;
            right = slot;
            cand = treeChildren[right];
            rightLength = len;
        }
    }
    treeChildren[left] = -1;
    treeChildren[right] = -1;
    return best;
}
function insertTree(data, view, pos, end, depth, nice, knownDistance, knownLength) {
    const remaining = end - pos;
    if (remaining < 3) return;
    const first = remaining >= 4 ? view.getUint32(pos, true) : data[pos] | data[pos + 1] << 8 | data[pos + 2] << 16;
    const h3 = Math.imul(0xffffff & first, 0x9e3779b1) >>> 32 - HASH_BITS;
    head3[h3] = pos;
    head3Epoch[h3] = epoch;
    if (remaining < 4) return;
    const hash = Math.imul(first, 0x9e3779b1) >>> 32 - HASH_BITS;
    let cand = headEpoch[hash] === epoch ? deflate_head[hash] : -1;
    headEpoch[hash] = epoch;
    deflate_head[hash] = pos;
    let left = (pos & WINDOW_MASK) * 2;
    let right = left + 1;
    let leftLength = 0;
    let rightLength = 0;
    const max = Math.min(nice, data.length - pos);
    while(cand >= 0 && pos - cand <= WINDOW && depth-- > 0){
        let len = Math.min(leftLength, rightLength);
        if (pos - cand === knownDistance && knownLength > len) len = knownLength;
        while(len + 4 <= max){
            const diff = (0 === len ? first : view.getUint32(pos + len, true)) ^ view.getUint32(cand + len, true);
            if (0 !== diff) {
                len += 31 - Math.clz32(diff & -diff) >>> 3;
                break;
            }
            len += 4;
        }
        if (len + 4 > max) while(len < max && data[pos + len] === data[cand + len])len++;
        const slot = (cand & WINDOW_MASK) * 2;
        if (pos - cand === WINDOW) break;
        if (len >= max) {
            treeChildren[left] = treeChildren[slot];
            treeChildren[right] = treeChildren[slot + 1];
            return;
        }
        if (data[cand + len] < data[pos + len]) {
            treeChildren[left] = cand;
            left = slot + 1;
            cand = treeChildren[left];
            leftLength = len;
        } else {
            treeChildren[right] = cand;
            right = slot;
            cand = treeChildren[right];
            rightLength = len;
        }
    }
    treeChildren[left] = -1;
    treeChildren[right] = -1;
}
function monotoneMatch(i, first, last, best) {
    let length = 0;
    for(let len = first; len <= last;){
        const end = Math.min(lengthCostEnd[len], last);
        const trial = lengthCosts[len] + pathCost[i + end];
        if (trial < best) {
            best = trial;
            length = end;
        }
        len = end + 1;
    }
    return 512 * best + length;
}
function findOptimalPath(data, start, size, literalCosts, distanceCosts) {
    pathCost[size] = 0;
    for(let i = size - 1; i >= 0; i--){
        let cost = (literalCosts[data[start + i]] || 12) + pathCost[i + 1];
        let length = 1;
        let distance = 0;
        let minLength = MIN_MATCH;
        for(let m = matchStarts[i]; m < matchStarts[i + 1]; m++){
            const match = matchCache[m];
            const max = Math.min(match >>> 16, size - i);
            const dist = (0xffff & match) + 1;
            const distanceCost = (distanceCosts[distSym[dist]] || 12) + distExtraCnt[dist];
            let best = cost - distanceCost;
            for(let len = minLength; len <= max; len++){
                const trial = lengthCosts[len] + pathCost[i + len];
                if (trial < best) {
                    best = trial;
                    length = len;
                    distance = dist;
                }
            }
            cost = best + distanceCost;
            minLength = max + 1;
        }
        pathCost[i] = cost;
        pathLen[i] = length;
        matchDist[i] = distance;
    }
}
function findOptimalPathRanges(data, start, size, literalCosts, distanceCosts) {
    pathCost[size] = 0;
    for(let i = size - 1; i >= 0; i--){
        let cost = (literalCosts[data[start + i]] || 12) + pathCost[i + 1];
        let length = 1;
        let distance = 0;
        let minLength = MIN_MATCH;
        for(let m = matchStarts[i]; m < matchStarts[i + 1]; m++){
            const match = matchCache[m];
            const max = Math.min(match >>> 16, size - i);
            const dist = (0xffff & match) + 1;
            const distanceCost = (distanceCosts[distSym[dist]] || 12) + distExtraCnt[dist];
            let best = cost - distanceCost;
            if (max - minLength >= 16 && matchStarts[i + minLength] === matchStarts[i + max]) {
                const result = monotoneMatch(i, minLength, max, best);
                if ((511 & result) !== 0) {
                    best = Math.floor(result / 512);
                    length = 511 & result;
                    distance = dist;
                }
            } else for(let len = minLength; len <= max; len++){
                const trial = lengthCosts[len] + pathCost[i + len];
                if (trial < best) {
                    best = trial;
                    length = len;
                    distance = dist;
                }
            }
            cost = best + distanceCost;
            minLength = max + 1;
        }
        pathCost[i] = cost;
        pathLen[i] = length;
        matchDist[i] = distance;
    }
}
function optimalTokens(data, start, end, passes, minImprovement, fastOptimal = false) {
    const size = end - start;
    let initialCount = 0;
    for(let i = 0; i < size;){
        const first = matchStarts[i];
        const last = matchStarts[i + 1];
        const match = last > first ? matchCache[last - 1] : 0;
        const available = 0 === match ? 0 : Math.min(match >>> 16, size - i);
        const len = available >= MIN_MATCH ? available : 1;
        tLen[initialCount] = 1 === len ? data[start + i] : len;
        tDist[initialCount++] = 1 === len ? 0 : (0xffff & match) + 1;
        i += len;
    }
    const useRanges = 32 * initialCount < size;
    const initialCounter = new SizeCounter(1 / 0);
    emitBlock(initialCounter, false, data, start, end, initialCount, true);
    let literalCosts = trialLiteralCosts;
    let distanceCosts = trialDistanceCosts;
    let bestSize = initialCounter.bitLength();
    if (fastOptimal && bestSize >= size) passes = 1;
    let bestCount = initialCount;
    bestLenTokens.set(tLen.subarray(0, initialCount));
    bestDistTokens.set(tDist.subarray(0, initialCount));
    for(let pass = 0; pass < passes; pass++){
        previousLiteralCosts.set(literalCosts);
        previousDistanceCosts.set(distanceCosts);
        for(let len = MIN_MATCH; len <= MAX_MATCH; len++)lengthCosts[len] = (literalCosts[lenSym[len]] || 12) + lenExtraCnt[len];
        if (useRanges) {
            lengthCostEnd[MAX_MATCH] = MAX_MATCH;
            for(let len = MAX_MATCH - 1; len >= MIN_MATCH; len--)lengthCostEnd[len] = lengthCosts[len] === lengthCosts[len + 1] ? lengthCostEnd[len + 1] : len;
            findOptimalPathRanges(data, start, size, literalCosts, distanceCosts);
        } else findOptimalPath(data, start, size, literalCosts, distanceCosts);
        let count = 0;
        for(let i = 0; i < size;){
            const len = pathLen[i];
            tLen[count] = 1 === len ? data[start + i] : len;
            tDist[count] = matchDist[i];
            count++;
            i += len;
        }
        const counter = new SizeCounter(1 / 0);
        emitBlock(counter, false, data, start, end, count, true);
        const bits = counter.bitLength();
        const improvement = bestSize - bits;
        if (bits < bestSize) {
            bestSize = bits;
            bestCount = count;
            bestLenTokens.set(tLen.subarray(0, count));
            bestDistTokens.set(tDist.subarray(0, count));
        }
        if (pass > 0 && improvement < minImprovement) break;
        let converged = true;
        for(let s = 0; s < 286; s++)if (previousLiteralCosts[s] !== trialLiteralCosts[s]) {
            converged = false;
            break;
        }
        if (converged) {
            for(let s = 0; s < 30; s++)if (previousDistanceCosts[s] !== trialDistanceCosts[s]) {
                converged = false;
                break;
            }
        }
        if (converged) break;
        literalCosts = trialLiteralCosts;
        distanceCosts = trialDistanceCosts;
    }
    tLen.set(bestLenTokens.subarray(0, bestCount));
    tDist.set(bestDistTokens.subarray(0, bestCount));
    return bestCount;
}
function optimalBlockEnd(data, start) {
    const limit = Math.min(start + OPT_BLOCK_SIZE, data.length);
    blockHistogram.fill(0);
    let total = 0;
    for(let pos = start; pos < limit; pos += BLOCK_OBSERVATION){
        const end = Math.min(pos + BLOCK_OBSERVATION, limit);
        const observed = end - pos;
        observationHistogram.fill(0);
        for(let i = pos; i < end; i++)observationHistogram[data[i]]++;
        if (total >= MIN_OPT_BLOCK_SIZE && observed >= BLOCK_OBSERVATION / 2) {
            let difference = 0;
            for(let s = 0; s < 256; s++)difference += Math.abs(observationHistogram[s] * total - blockHistogram[s] * observed);
            if (5 * difference > total * observed * 2) return pos;
        }
        for(let s = 0; s < 256; s++)blockHistogram[s] += observationHistogram[s];
        total += observed;
    }
    return limit;
}
function deflateOptimal(bw, data, view, level, fastOptimal = false) {
    const depth = level >= 12 ? 128 : level >= 11 ? 64 : 32;
    const nice = level >= 12 ? MAX_MATCH : 128;
    const skipLength = level >= 12 ? 128 : 32;
    for(let start = 0; start < data.length;){
        let end = optimalBlockEnd(data, start);
        let insertionDepth = depth;
        if (fastOptimal && 11 === level) {
            let symbols = 0;
            let concentrated = false;
            const size = end - start;
            for(let s = 0; s < 256; s++){
                const count = blockHistogram[s];
                if (8 * count >= 7 * size) {
                    concentrated = true;
                    break;
                }
                if (1024 * count >= size) symbols++;
            }
            if (!concentrated && symbols > 16) insertionDepth = 24;
        }
        cacheCount = 0;
        for(let pos = start; pos < end;){
            if (cacheCount + MAX_MATCH >= matchCache.length) {
                end = pos;
                break;
            }
            matchStarts[pos - start] = cacheCount;
            const len = cacheMatches(data, view, pos, end, depth, nice);
            const next = len >= skipLength ? pos + len : pos + 1;
            const distance = cacheCount > matchStarts[pos - start] ? (0xffff & matchCache[cacheCount - 1]) + 1 : 0;
            for(let p = pos + 1; p < next; p++){
                matchStarts[p - start] = cacheCount;
                insertTree(data, view, p, end, insertionDepth, nice, distance, next - p);
            }
            matchStarts[next - start] = cacheCount;
            pos = next;
        }
        matchStarts[end - start] = cacheCount;
        const count = optimalTokens(data, start, end, level >= 12 ? 4 : 3, level >= 12 ? 1 : level >= 11 ? 16 : 32, fastOptimal && 11 === level);
        emitBlock(bw, end === data.length, data, start, end, count);
        start = end;
    }
}
function buildCLSequence(hlit, hdist, litLen, distLen) {
    let i = 0;
    let out = 0;
    const total = hlit + hdist;
    while(i < total){
        const v = i < hlit ? litLen[i] : distLen[i - hlit];
        let run = 1;
        while(i + run < total){
            const w = i + run < hlit ? litLen[i + run] : distLen[i + run - hlit];
            if (w !== v) break;
            run++;
        }
        if (0 === v) {
            let r = run;
            while(r >= 11){
                const t = r < 138 ? r : 138;
                seqSym[out] = 18;
                seqVal[out] = t - 11;
                seqCnt[out] = 7;
                out++;
                r -= t;
            }
            while(r >= 3){
                const t = r < 10 ? r : 10;
                seqSym[out] = 17;
                seqVal[out] = t - 3;
                seqCnt[out] = 3;
                out++;
                r -= t;
            }
            while(r > 0){
                seqSym[out] = 0;
                seqVal[out] = 0;
                seqCnt[out] = 0;
                out++;
                r--;
            }
        } else {
            seqSym[out] = v;
            seqVal[out] = 0;
            seqCnt[out] = 0;
            out++;
            let r = run - 1;
            while(r >= 3){
                const t = r < 6 ? r : 6;
                seqSym[out] = 16;
                seqVal[out] = t - 3;
                seqCnt[out] = 2;
                out++;
                r -= t;
            }
            while(r > 0){
                seqSym[out] = v;
                seqVal[out] = 0;
                seqCnt[out] = 0;
                out++;
                r--;
            }
        }
        i += run;
    }
    return out;
}
function emitStored(bw, final, data, start, end) {
    const len = end - start;
    if (bw instanceof SizeCounter) return void bw.addStored(len);
    bw.writeBits(final ? 1 : 0, 1);
    bw.writeBits(0, 2);
    bw.alignToByte();
    bw.writeBits(0xff & len, 8);
    bw.writeBits(len >>> 8 & 0xff, 8);
    bw.writeBits(0xff & ~len, 8);
    bw.writeBits(~len >>> 8 & 0xff, 8);
    bw.pushBytes(data.subarray(start, end));
}
const FIXED_LIT_LEN = new Uint8Array(288);
for(let i = 0; i < 144; i++)FIXED_LIT_LEN[i] = 8;
for(let i = 144; i < 256; i++)FIXED_LIT_LEN[i] = 9;
for(let i = 256; i < 280; i++)FIXED_LIT_LEN[i] = 7;
for(let i = 280; i < 288; i++)FIXED_LIT_LEN[i] = 8;
let fixedCodes = null;
function getFixedCodes() {
    if (!fixedCodes) {
        const dist = new Uint8Array(30).fill(5);
        fixedCodes = {
            lit: buildCodes(FIXED_LIT_LEN),
            dist: buildCodes(dist)
        };
    }
    return fixedCodes;
}
function writeTokens(bw, litCodes, distCodes, count) {
    const lrev = litCodes.rev;
    const llen = litCodes.lengths;
    const drev = distCodes.rev;
    const dlen = distCodes.lengths;
    for(let i = 0; i < count; i++){
        const d = tDist[i];
        if (0 === d) {
            const b = tLen[i];
            bw.writeBits(lrev[b], llen[b]);
        } else {
            const L = tLen[i];
            const ls = lenSym[L];
            const lc = llen[ls];
            bw.writeBits(lrev[ls] | L - lenBase[L] << lc, lc + lenExtraCnt[L]);
            const ds = distSym[d];
            const dc = dlen[ds];
            bw.writeBits(drev[ds] | d - DIST_BASE[ds] << dc, dc + distExtraCnt[d]);
        }
    }
    bw.writeBits(lrev[256], llen[256]);
}
function emitBlock(bw, final, data, start, end, count, collectCosts = false) {
    const blockBytes = end - start;
    litFreq.fill(0);
    distFreq.fill(0);
    let extraBits = 0;
    for(let i = 0; i < count; i++){
        const d = tDist[i];
        if (0 === d) litFreq[tLen[i]]++;
        else {
            const L = tLen[i];
            litFreq[lenSym[L]]++;
            distFreq[distSym[d]]++;
            extraBits += lenExtraCnt[L] + distExtraCnt[d];
        }
    }
    litFreq[256]++;
    const storedBits = blockBytes <= 0xffff ? 40 + 8 * blockBytes : 1 / 0;
    let fixedBits = 3 + extraBits;
    for(let s = 0; s < 286; s++)if (0 !== litFreq[s]) fixedBits += litFreq[s] * FIXED_LIT_LEN[s];
    for(let s = 0; s < 30; s++)if (0 !== distFreq[s]) fixedBits += 5 * distFreq[s];
    const cheap = storedBits < fixedBits ? storedBits : fixedBits;
    let hlit = 286;
    while(hlit > 257 && 0 === litFreq[hlit - 1])hlit--;
    const litLen = limitedLengths(litFreq, 15);
    if (collectCosts) trialLiteralCosts.set(litLen);
    makeComplete(litLen.subarray(0, hlit));
    let hdist = 30;
    while(hdist > 1 && 0 === distFreq[hdist - 1])hdist--;
    if (hdist < 2) hdist = 2;
    const distLen = limitedLengths(distFreq, 15);
    if (collectCosts) trialDistanceCosts.set(distLen);
    makeComplete(distLen.subarray(0, hdist));
    const seqCount = buildCLSequence(hlit, hdist, litLen, distLen);
    clFreq.fill(0);
    for(let i = 0; i < seqCount; i++)clFreq[seqSym[i]]++;
    const clLen = limitedLengths(clFreq, 7);
    makeComplete(clLen);
    let hclen = 19;
    while(hclen > 4 && 0 === clLen[deflate_CL_ORDER[hclen - 1]])hclen--;
    let dynBits = 17 + 3 * hclen + extraBits;
    for(let i = 0; i < seqCount; i++)dynBits += clLen[seqSym[i]] + seqCnt[i];
    for(let s = 0; s < 286; s++){
        const f = litFreq[s];
        if (0 !== f) dynBits += f * litLen[s];
    }
    for(let s = 0; s < 30; s++){
        const f = distFreq[s];
        if (0 !== f) dynBits += f * distLen[s];
    }
    if (bw instanceof SizeCounter) {
        if (cheap < dynBits && storedBits <= fixedBits) bw.addStored(blockBytes);
        else bw.addBits(cheap < dynBits ? fixedBits : dynBits);
        return;
    }
    if (cheap < dynBits) {
        if (storedBits <= fixedBits) return void emitStored(bw, final, data, start, end);
        const { lit, dist } = getFixedCodes();
        bw.writeBits(final ? 1 : 0, 1);
        bw.writeBits(1, 2);
        writeTokens(bw, lit, dist, count);
        return;
    }
    bw.writeBits(final ? 1 : 0, 1);
    bw.writeBits(2, 2);
    bw.writeBits(hlit - 257, 5);
    bw.writeBits(hdist - 1, 5);
    bw.writeBits(hclen - 4, 4);
    for(let i = 0; i < hclen; i++)bw.writeBits(clLen[deflate_CL_ORDER[i]], 3);
    const clCodes = buildCodes(clLen);
    for(let i = 0; i < seqCount; i++){
        const s = seqSym[i];
        bw.writeBits(clCodes.rev[s], clCodes.lengths[s]);
        if (0 !== seqCnt[i]) bw.writeBits(seqVal[i], seqCnt[i]);
    }
    writeTokens(bw, buildCodes(litLen), buildCodes(distLen), count);
}
function deflateInto(bw, data, level, fastOptimal = false) {
    const n = data.length;
    const view = n >= 4 ? new DataView(data.buffer, data.byteOffset, n) : null;
    if (0 === n) return void emitStored(bw, true, data, 0, 0);
    if (level <= 0) {
        let pos = 0;
        while(pos < n){
            const end = Math.min(pos + 0xffff, n);
            emitStored(bw, end >= n, data, pos, end);
            pos = end;
        }
        return;
    }
    const params = LEVELS[level < LEVELS.length ? level : LEVELS.length - 1];
    epoch = epoch + 1 >>> 0;
    if (0 === epoch) {
        headEpoch.fill(0);
        head3Epoch.fill(0);
        head4Epoch.fill(0);
        epoch = 1;
    }
    wideMatches = level >= 7;
    if (level >= 10 && n >= 4) return void deflateOptimal(bw, data, view, level, fastOptimal);
    const chain = params.chain;
    const nice = params.nice;
    const lazy = params.lazy;
    let pos = 0;
    let blockStart = 0;
    let cached = -1;
    while(pos < n){
        const nominalEnd = blockStart + BLOCK_SIZE < n ? blockStart + BLOCK_SIZE : n;
        let count = 0;
        while(pos < nominalEnd){
            let m;
            if (cached >= 0) {
                m = cached;
                cached = -1;
            } else m = wideMatches ? findWideMatch(data, view, n, pos, chain, nice) : findMatch(data, view, n, pos, chain, nice, true);
            let len = m >>> 16;
            let dist = (0xffff & m) + 1;
            let insertedNext = false;
            if (lazy && len >= MIN_MATCH && len < nice && pos + 1 < n) {
                const m2 = wideMatches ? findWideMatch(data, view, n, pos + 1, chain, nice) : findMatch(data, view, n, pos + 1, chain, nice, true);
                insertedNext = true;
                if (m2 >>> 16 > len) {
                    tLen[count] = data[pos];
                    tDist[count] = 0;
                    count++;
                    pos++;
                    cached = m2;
                    continue;
                }
            }
            if (len >= MIN_MATCH) {
                tLen[count] = len;
                tDist[count] = dist;
                count++;
                const end = pos + len;
                const insLimit = end < n - 3 ? end : n - 3;
                for(let p = pos + (insertedNext ? 2 : 1); p < insLimit; p++){
                    const h = hashAt(view, p);
                    deflate_prev[p & WINDOW_MASK] = headEpoch[h] === epoch ? deflate_head[h] : -1;
                    headEpoch[h] = epoch;
                    deflate_head[h] = p;
                }
                pos = end;
            } else {
                tLen[count] = data[pos];
                tDist[count] = 0;
                count++;
                pos++;
            }
        }
        emitBlock(bw, pos >= n, data, blockStart, pos, count);
        blockStart = pos;
    }
}
function deflateRawSize(data, level, maxSize = 1 / 0, fastOptimal = false) {
    const counter = new SizeCounter(maxSize);
    deflateInto(counter, data, level, fastOptimal);
    return counter.finish();
}
function deflateRaw(data, level, maxSize, fastOptimal = false) {
    const bw = new BitWriter(Math.max(64, data.length >>> 1), maxSize ?? 1 / 0);
    deflateInto(bw, data, level, fastOptimal);
    return bw.finish();
}
function zlibCompress(data, level, maxSize, fastOptimal = false) {
    const bw = new BitWriter(Math.max(64, data.length >>> 1), maxSize ?? 1 / 0);
    bw.skip(2);
    deflateInto(bw, data, level, fastOptimal);
    const tail = new Uint8Array(4);
    adler32Bytes(data, tail, 1);
    bw.pushBytes(tail);
    const out = bw.finish();
    out[0] = 0x78;
    out[1] = 0x01;
    return out;
}
function libdeflater(compression, fastOptimal = false) {
    if (fastOptimal) return {
        kind: 'libdeflater',
        compression,
        fastOptimal
    };
    return {
        kind: 'libdeflater',
        compression
    };
}
function zopfli(options = {}) {
    return {
        kind: 'zopfli',
        options: {
            iterationCount: options.iterationCount ?? 15,
            iterationsWithoutImprovement: options.iterationsWithoutImprovement ?? Number.MAX_SAFE_INTEGER
        }
    };
}
function deflaterEquals(a, b) {
    if (a.kind !== b.kind) return false;
    if ('libdeflater' === a.kind && 'libdeflater' === b.kind) return a.compression === b.compression && Boolean(a.fastOptimal) === Boolean(b.fastOptimal);
    if ('zopfli' !== a.kind || 'zopfli' !== b.kind) return false;
    const bo = b.options;
    return a.options.iterationCount === bo.iterationCount && a.options.iterationsWithoutImprovement === bo.iterationsWithoutImprovement;
}
function deflaterToString(d) {
    return 'libdeflater' === d.kind ? `zc = ${d.compression}` : `zopfli, zi = ${d.options.iterationCount}`;
}
function mapLevel(compression) {
    return Math.max(0, Math.min(12, Math.round(compression)));
}
function deflate(data, compression, maxSize, fastOptimal = false) {
    try {
        return zlibCompress(data, mapLevel(compression), maxSize, fastOptimal);
    } catch (err) {
        if (err instanceof SizeLimitExceeded) throw PngError.deflatedDataTooLong(maxSize);
        throw err;
    }
}
function deflate_deflateRaw(data, compression, maxSize, fastOptimal = false) {
    try {
        return deflateRaw(data, mapLevel(compression), maxSize, fastOptimal);
    } catch (err) {
        if (err instanceof SizeLimitExceeded) throw PngError.deflatedDataTooLong(maxSize);
        throw err;
    }
}
function deflate_deflateRawSize(data, compression, maxSize, fastOptimal = false) {
    try {
        return deflateRawSize(data, mapLevel(compression), maxSize, fastOptimal);
    } catch (err) {
        if (err instanceof SizeLimitExceeded) return null;
        throw err;
    }
}
function inflate(data, outSize) {
    try {
        return inflateZlib(data, outSize);
    } catch (err) {
        if (err instanceof PngError) throw err;
        throw PngError.invalidData();
    }
}
function deflaterDeflate(deflater, data, maxSize) {
    const compression = 'libdeflater' === deflater.kind ? deflater.compression : 12;
    return deflate(data, compression, maxSize, 'libdeflater' === deflater.kind && deflater.fastOptimal);
}
function deflaterDeflateSize(deflater, data, maxSize) {
    const compression = 'libdeflater' === deflater.kind ? deflater.compression : 12;
    if (void 0 !== maxSize && maxSize < 6) throw PngError.deflatedDataTooLong(maxSize);
    const size = deflate_deflateRawSize(data, compression, void 0 === maxSize ? void 0 : maxSize - 6, 'libdeflater' === deflater.kind && deflater.fastOptimal);
    if (null === size) throw PngError.deflatedDataTooLong(maxSize);
    return size + 6;
}
function readBeU16(bytes, offset = 0) {
    return bytes[offset] << 8 | bytes[offset + 1];
}
function readBeU32(bytes, offset = 0) {
    return 0x1000000 * bytes[offset] + (bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0;
}
function writeBeU16(value, out, offset = 0) {
    out[offset] = value >>> 8 & 0xff;
    out[offset + 1] = 0xff & value;
}
function writeBeU32(value, out, offset = 0) {
    out[offset] = value >>> 24 & 0xff;
    out[offset + 1] = value >>> 16 & 0xff;
    out[offset + 2] = value >>> 8 & 0xff;
    out[offset + 3] = 0xff & value;
}
const CRC_TABLE = (()=>{
    const table = new Uint32Array(256);
    for(let n = 0; n < 256; n++){
        let c = n;
        for(let k = 0; k < 8; k++)c = 1 & c ? 0xedb88320 ^ c >>> 1 : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();
function crc32(bytes) {
    let crc = 0xffffffff;
    const table = CRC_TABLE;
    for(let i = 0; i < bytes.length; i++)crc = table[(crc ^ bytes[i]) & 0xff] ^ crc >>> 8;
    return (0xffffffff ^ crc) >>> 0;
}
const DISPLAY_CHUNKS = [
    'cICP',
    'iCCP',
    'sRGB',
    'pHYs',
    'acTL',
    'fcTL',
    'fdAT'
];
function ihdrBpp(ihdr) {
    return ihdr.bitDepth * channelsPerPixel(ihdr.colorType);
}
function rawDataSize(ihdr) {
    const w = ihdr.width;
    const h = ihdr.height;
    const bpp = ihdrBpp(ihdr);
    const bitmapSize = (b, width, height)=>Math.ceil(width * b / 8) * height;
    if (ihdr.interlaced) {
        let size = bitmapSize(bpp, w + 7 >> 3, h + 7 >> 3) + (h + 7 >> 3);
        if (w > 4) size += bitmapSize(bpp, w + 3 >> 3, h + 7 >> 3) + (h + 7 >> 3);
        size += bitmapSize(bpp, w + 3 >> 2, h + 3 >> 3) + (h + 3 >> 3);
        if (w > 2) size += bitmapSize(bpp, w + 1 >> 2, h + 3 >> 2) + (h + 3 >> 2);
        size += bitmapSize(bpp, w + 1 >> 1, h + 1 >> 2) + (h + 1 >> 2);
        if (w > 1) size += bitmapSize(bpp, w >> 1, h + 1 >> 1) + (h + 1 >> 1);
        return size + bitmapSize(bpp, w, h >> 1) + (h >> 1);
    }
    return bitmapSize(bpp, w, h) + h;
}
const REDUCTION_CONFLICTS = [
    'bKGD',
    'sBIT',
    'hIST'
];
function stripKeep(strip, name) {
    switch(strip.mode){
        case 'none':
            return true;
        case 'keep':
            return strip.names.has(name);
        case 'strip':
            return !strip.names.has(name);
        case 'safe':
            return DISPLAY_CHUNKS.includes(name);
        case 'all':
            return false;
    }
}
function fileHeaderIsValid(bytes) {
    return bytes.length >= 8 && 0x89 === bytes[0] && 0x50 === bytes[1] && 0x4e === bytes[2] && 0x47 === bytes[3] && 0x0d === bytes[4] && 0x0a === bytes[5] && 0x1a === bytes[6] && 0x0a === bytes[7];
}
const NAME_DECODER = /* @__PURE__ */ (()=>{
    const table = new Array(256);
    for(let i = 0; i < 256; i++)table[i] = String.fromCharCode(i);
    return table;
})();
function chunkName(bytes, offset) {
    return NAME_DECODER[bytes[offset]] + NAME_DECODER[bytes[offset + 1]] + NAME_DECODER[bytes[offset + 2]] + NAME_DECODER[bytes[offset + 3]];
}
function parseNextChunk(byteData, state, fixErrors) {
    const start = state.offset;
    if (start + 4 > byteData.length) throw PngError.truncatedData();
    const length = readBeU32(byteData, start);
    if (byteData.length < start + 12 + length) throw PngError.truncatedData();
    const nameOffset = start + 4;
    const name = chunkName(byteData, nameOffset);
    if ('IEND' === name) {
        state.offset = start + 12 + length;
        return null;
    }
    const dataStart = nameOffset + 4;
    const data = byteData.subarray(dataStart, dataStart + length);
    const crcOffset = dataStart + length;
    const crc = readBeU32(byteData, crcOffset);
    state.offset = crcOffset + 4;
    const chunkBytes = byteData.subarray(nameOffset, crcOffset);
    if (!fixErrors && crc32(chunkBytes) !== crc) throw PngError.crcMismatch(nameBytes(name));
    return {
        name,
        data
    };
}
function nameBytes(name) {
    return new Uint8Array([
        name.charCodeAt(0),
        name.charCodeAt(1),
        name.charCodeAt(2),
        name.charCodeAt(3)
    ]);
}
function parseIhdrChunk(byteData, paletteData, trnsData) {
    if (byteData.length < 13) throw PngError.truncatedData();
    const interlaced = byteData[12];
    const colorCode = byteData[9];
    let colorType;
    switch(colorCode){
        case 0:
            colorType = grayscale(trnsData && trnsData.length >= 2 ? readBeU16(trnsData, 0) : null);
            break;
        case 2:
            colorType = rgb(trnsData && trnsData.length >= 6 ? {
                r: readBeU16(trnsData, 0),
                g: readBeU16(trnsData, 2),
                b: readBeU16(trnsData, 4)
            } : null);
            break;
        case 3:
            colorType = colors_indexed(paletteToRgba(paletteData, trnsData) ?? []);
            break;
        case 4:
            colorType = GRAYSCALE_ALPHA;
            break;
        case 6:
            colorType = RGBA;
            break;
        default:
            throw PngError.invalidData();
    }
    return {
        colorType,
        bitDepth: tryBitDepth(byteData[8]),
        width: readBeU32(byteData, 0),
        height: readBeU32(byteData, 4),
        interlaced: 0 === interlaced ? false : 1 === interlaced ? true : raiseInvalid()
    };
}
function raiseInvalid() {
    throw PngError.invalidData();
}
function tryBitDepth(value) {
    try {
        return bitDepthFromNumber(value);
    } catch  {
        throw PngError.invalidData();
    }
}
function paletteToRgba(paletteData, trnsData) {
    if (!paletteData) throw PngError.chunkMissing('PLTE');
    const count = Math.floor(paletteData.length / 3);
    const palette = new Array(count);
    for(let i = 0; i < count; i++)palette[i] = rgba8(paletteData[3 * i], paletteData[3 * i + 1], paletteData[3 * i + 2], 255);
    if (trnsData) {
        const n = Math.min(palette.length, trnsData.length);
        for(let i = 0; i < n; i++)palette[i] = rgba8(palette[i] >>> 24, palette[i] >>> 16 & 0xff, palette[i] >>> 8 & 0xff, trnsData[i]);
    }
    return palette;
}
function extractIcc(iccp, maxSize) {
    const data = iccp.data;
    let i = 0;
    while(i < data.length){
        const n = data[i++];
        if (0 === n) break;
    }
    if (i >= data.length) return null;
    const compressionMethod = data[i++];
    if (0 !== compressionMethod) return null;
    const compressed = data.subarray(i);
    let outSize = Math.max(10 * compressed.length, 1000);
    outSize = Math.min(outSize, maxSize ?? 1000000);
    try {
        return inflate(compressed, outSize);
    } catch  {
        return null;
    }
}
function makeIccp(icc, deflater, maxSize) {
    const compressed = deflaterDeflate(deflater, icc, maxSize);
    const data = new Uint8Array(compressed.length + 5);
    data.set([
        0x69,
        0x63,
        0x63,
        0x00,
        0x00
    ], 0);
    data.set(compressed, 5);
    return {
        name: 'iCCP',
        data
    };
}
const KNOWN_SRGB_PROFILE_IDS = [
    '\x29\xf8\x3d\xde\xaf\xf2\x55\xae\x78\x42\xfa\xe4\xca\x83\x39\x0d',
    '\xc9\x5b\xd6\x37\xe9\x5d\x8a\x3b\x0d\xf3\x8f\x99\xc1\x32\x03\x89',
    '\xfc\x66\x33\x78\x37\xe2\x88\x6b\xfd\x72\xe9\x83\x82\x28\xf1\xb8',
    '\x34\x56\x2a\xbf\x99\x4c\xcd\x06\x6d\x2c\x57\x21\xd0\xd6\x8c\x5d'
];
function srgbRenderingIntent(iccData) {
    if (iccData.length <= 67) return null;
    const renderingIntent = iccData[67];
    const profileId = bytesToString(iccData.subarray(84, 100));
    if (KNOWN_SRGB_PROFILE_IDS.includes(profileId)) return renderingIntent;
    if (profileId === '\x00'.repeat(16)) {
        const crc = crc32(iccData);
        const len = iccData.length;
        if (0x5d5129ce === crc && 3024 === len || 0x182ea552 === crc && 3144 === len || 0xf29e526d === crc && 3144 === len) return renderingIntent;
    }
    return null;
}
function bytesToString(bytes) {
    let out = '';
    for(let i = 0; i < bytes.length; i++)out += String.fromCharCode(bytes[i]);
    return out;
}
function preprocessChunks(auxChunks, opts, warn) {
    const hasSrgb = auxChunks.some((c)=>'sRGB' === c.name);
    let allowGrayscale = !hasSrgb || 'none' !== opts.strip.mode;
    const iccpIdx = auxChunks.findIndex((c)=>'iCCP' === c.name);
    if (-1 !== iccpIdx) {
        allowGrayscale = false;
        const mayReplaceIccp = 'none' !== opts.strip.mode && stripKeep(opts.strip, 'sRGB');
        if (mayReplaceIccp && hasSrgb) {
            auxChunks.splice(iccpIdx, 1);
            allowGrayscale = true;
        } else {
            const icc = extractIcc(auxChunks[iccpIdx], opts.maxDecompressedSize);
            if (icc) {
                const intent = mayReplaceIccp ? srgbRenderingIntent(icc) : null;
                if (null !== intent) {
                    auxChunks[iccpIdx] = {
                        name: 'sRGB',
                        data: new Uint8Array([
                            intent
                        ])
                    };
                    allowGrayscale = true;
                } else if (opts.idatRecoding) {
                    const curLen = auxChunks[iccpIdx].data.length;
                    try {
                        const iccp = makeIccp(icc, opts.deflater, curLen - 1);
                        auxChunks[iccpIdx] = iccp;
                    } catch  {}
                }
            }
        }
    }
    if (!allowGrayscale && opts.grayscaleReduction) opts.grayscaleReduction = false;
    if (auxChunks.some((c)=>'acTL' === c.name)) {
        warn('APNG detected, disabling all reductions');
        opts.interlace = null;
        opts.bitDepthReduction = false;
        opts.colorTypeReduction = false;
        opts.paletteReduction = false;
    } else if ('keep' === opts.strip.mode) {
        for (const name of REDUCTION_CONFLICTS)if (opts.strip.names.has(name) && auxChunks.some((c)=>c.name === name)) {
            warn(`${name} chunk explicitly kept, disabling all reductions`);
            opts.bitDepthReduction = false;
            opts.colorTypeReduction = false;
            opts.paletteReduction = false;
            break;
        }
    }
}
function postprocessChunks(auxChunks, ihdr, origIhdr, warn) {
    if (origIhdr.bitDepth !== ihdr.bitDepth || !colorTypeEqualsLoose(origIhdr.colorType, ihdr.colorType)) {
        for(let i = auxChunks.length - 1; i >= 0; i--)if (REDUCTION_CONFLICTS.includes(auxChunks[i].name)) {
            warn(`Removing ${auxChunks[i].name} chunk as it no longer matches the image data`);
            auxChunks.splice(i, 1);
        }
    }
    if (isGrayLoose(origIhdr.colorType) !== isGrayLoose(ihdr.colorType)) {
        for(let i = auxChunks.length - 1; i >= 0; i--)if ('sRGB' === auxChunks[i].name || 'iCCP' === auxChunks[i].name) auxChunks.splice(i, 1);
    }
}
function colorTypeEqualsLoose(a, b) {
    if (a.kind !== b.kind) return false;
    if ('indexed' === a.kind && 'indexed' === b.kind) {
        if (a.palette.length !== b.palette.length) return false;
        for(let i = 0; i < a.palette.length; i++)if (a.palette[i] !== b.palette[i]) return false;
        return true;
    }
    if ('grayscale' === a.kind && 'grayscale' === b.kind) return a.transparentShade === b.transparentShade;
    if ('rgb' === a.kind && 'rgb' === b.kind) {
        const ac = a.transparentColor;
        const bc = b.transparentColor;
        if (null === ac || null === bc) return ac === bc;
        return ac.r === bc.r && ac.g === bc.g && ac.b === bc.b;
    }
    return true;
}
function isGrayLoose(ct) {
    return 'grayscale' === ct.kind || 'grayscaleAlpha' === ct.kind;
}
const RowFilter = {
    None: 0,
    Sub: 1,
    Up: 2,
    Average: 3,
    Paeth: 4
};
const ROW_FILTER_ALL = [
    0,
    1,
    2,
    3,
    4
];
const ROW_FILTER_NAMES = [
    'None',
    'Sub',
    'Up',
    'Average',
    'Paeth'
];
function rowFilterName(filter) {
    return ROW_FILTER_NAMES[filter];
}
function rowFilterFromNumber(value) {
    if (value < 0 || value > 4 || value !== Math.floor(value)) throw new Error('invalid row filter');
    return value;
}
function paethPredictor(a, b, c) {
    const p = a + b - c;
    const pa = p > a ? p - a : a - p;
    const pb = p > b ? p - b : b - p;
    const pc = p > c ? p - c : c - p;
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}
function filterLine(filter, bpp, data, prevLine, out, alphaBytes) {
    if (0 !== alphaBytes) filters_optimizeAlpha(filter, bpp, data, prevLine, bpp - alphaBytes);
    const len = data.length;
    out.reserve(len + 1);
    const buf = out.buf;
    let p = out.len;
    buf[p++] = filter;
    switch(filter){
        case RowFilter.None:
            buf.set(data, p);
            p += len;
            break;
        case RowFilter.Sub:
            buf.set(data.subarray(0, bpp), p);
            p += bpp;
            for(let i = bpp; i < len; i++)buf[p++] = data[i] - data[i - bpp];
            break;
        case RowFilter.Up:
            for(let i = 0; i < len; i++)buf[p++] = data[i] - prevLine[i];
            break;
        case RowFilter.Average:
            for(let i = 0; i < bpp; i++)buf[p++] = data[i] - (prevLine[i] >> 1);
            for(let i = bpp; i < len; i++)buf[p++] = data[i] - (data[i - bpp] + prevLine[i] >> 1);
            break;
        case RowFilter.Paeth:
            for(let i = 0; i < bpp; i++)buf[p++] = data[i] - prevLine[i];
            for(let i = bpp; i < len; i++){
                const a = data[i - bpp];
                const b = prevLine[i];
                const c = prevLine[i - bpp];
                const pa = Math.abs(b - c);
                const pb = Math.abs(a - c);
                const pc = Math.abs(a + b - 2 * c);
                buf[p++] = data[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
            }
            break;
    }
    out.len = p;
}
function filterLineMinSum(filter, bpp, data, prevLine, out, alphaBytes, bestSize) {
    if (0 !== alphaBytes) filters_optimizeAlpha(filter, bpp, data, prevLine, bpp - alphaBytes);
    const len = data.length;
    out.reserve(len + 1);
    const buf = out.buf;
    let p = out.len;
    buf[p++] = filter;
    let size = filter;
    if (size >= bestSize) return size;
    switch(filter){
        case RowFilter.None:
            for(let i = 0; i < len; i++){
                const value = data[i];
                buf[p++] = value;
                size += Math.abs(value << 24 >> 24);
                if (size >= bestSize) return size;
            }
            break;
        case RowFilter.Sub:
            for(let i = 0; i < bpp; i++){
                const value = data[i];
                buf[p++] = value;
                size += Math.abs(value << 24 >> 24);
                if (size >= bestSize) return size;
            }
            for(let i = bpp; i < len; i++){
                const value = data[i] - data[i - bpp];
                buf[p++] = value;
                size += Math.abs(value << 24 >> 24);
                if (size >= bestSize) return size;
            }
            break;
        case RowFilter.Up:
            for(let i = 0; i < len; i++){
                const value = data[i] - prevLine[i];
                buf[p++] = value;
                size += Math.abs(value << 24 >> 24);
                if (size >= bestSize) return size;
            }
            break;
        case RowFilter.Average:
            for(let i = 0; i < bpp; i++){
                const value = data[i] - (prevLine[i] >> 1);
                buf[p++] = value;
                size += Math.abs(value << 24 >> 24);
                if (size >= bestSize) return size;
            }
            for(let i = bpp; i < len; i++){
                const value = data[i] - (data[i - bpp] + prevLine[i] >> 1);
                buf[p++] = value;
                size += Math.abs(value << 24 >> 24);
                if (size >= bestSize) return size;
            }
            break;
        case RowFilter.Paeth:
            for(let i = 0; i < bpp; i++){
                const value = data[i] - prevLine[i];
                buf[p++] = value;
                size += Math.abs(value << 24 >> 24);
                if (size >= bestSize) return size;
            }
            for(let i = bpp; i < len; i++){
                const a = data[i - bpp];
                const b = prevLine[i];
                const c = prevLine[i - bpp];
                const pa = Math.abs(b - c);
                const pb = Math.abs(a - c);
                const pc = Math.abs(a + b - 2 * c);
                const value = data[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
                buf[p++] = value;
                size += Math.abs(value << 24 >> 24);
                if (size >= bestSize) return size;
            }
            break;
    }
    out.len = p;
    return size;
}
function filters_optimizeAlpha(filter, bpp, data, prevLine, colorBytes) {
    if (filter === RowFilter.None) return;
    const numPixels = Math.floor(data.length / bpp);
    for(let i = 0; i < numPixels; i++){
        const base = i * bpp;
        let transparent = true;
        for(let j = colorBytes; j < bpp; j++)if (0 !== data[base + j]) {
            transparent = false;
            break;
        }
        if (!transparent) continue;
        let prev;
        if (0 === i) {
            prev = i;
            for(let k = 0; k < numPixels; k++){
                const kb = k * bpp;
                let anyNonZero = false;
                for(let j = colorBytes; j < bpp; j++)if (0 !== data[kb + j]) {
                    anyNonZero = true;
                    break;
                }
                if (anyNonZero) {
                    prev = k;
                    break;
                }
            }
        } else prev = i - 1;
        switch(filter){
            case RowFilter.Sub:
                if (prev !== i) {
                    const src = prev * bpp;
                    for(let j = 0; j < colorBytes; j++)data[base + j] = data[src + j];
                }
                break;
            case RowFilter.Up:
                for(let j = 0; j < colorBytes; j++)data[base + j] = prevLine[base + j];
                break;
            case RowFilter.Average:
                for(let j = 0; j < colorBytes; j++)data[base + j] = 0 === i ? prevLine[base + j] >> 1 : data[base - bpp + j] + prevLine[base + j] >> 1;
                break;
            case RowFilter.Paeth:
                for(let j = 0; j < colorBytes; j++)data[base + j] = 0 === i ? Math.min(data[prev * bpp + j], prevLine[base + j]) : paethPredictor(data[base - bpp + j], prevLine[base + j], prevLine[base - bpp + j]);
                break;
        }
    }
}
function unfilterLine(filter, bpp, data, prevLine, out) {
    const len = data.length;
    const offset = out.len;
    out.reserve(len);
    const buf = out.buf;
    let p = offset;
    switch(filter){
        case RowFilter.None:
            buf.set(data, p);
            p += len;
            break;
        case RowFilter.Sub:
            buf.set(data.subarray(0, bpp), p);
            p += bpp;
            for(let i = bpp; i < len; i++)buf[p++] = data[i] + buf[offset + i - bpp];
            break;
        case RowFilter.Up:
            for(let i = 0; i < len; i++)buf[p++] = data[i] + prevLine[i];
            break;
        case RowFilter.Average:
            for(let i = 0; i < bpp; i++)buf[p++] = data[i] + (prevLine[i] >> 1);
            for(let i = bpp; i < len; i++)buf[p++] = data[i] + (buf[offset + i - bpp] + prevLine[i] >> 1);
            break;
        case RowFilter.Paeth:
            for(let i = 0; i < bpp; i++)buf[p++] = data[i] + prevLine[i];
            for(let i = bpp; i < len; i++){
                const a = buf[offset + i - bpp];
                const b = prevLine[i];
                const c = prevLine[i - bpp];
                const pa = Math.abs(b - c);
                const pb = Math.abs(a - c);
                const pc = Math.abs(a + b - 2 * c);
                buf[p++] = data[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
            }
            break;
    }
    out.len = p;
}
const basic = (filter)=>({
        kind: 'basic',
        filter
    });
const NONE = /* @__PURE__ */ basic(RowFilter.None);
const SUB = /* @__PURE__ */ basic(RowFilter.Sub);
const UP = /* @__PURE__ */ basic(RowFilter.Up);
const AVERAGE = /* @__PURE__ */ basic(RowFilter.Average);
const PAETH = /* @__PURE__ */ basic(RowFilter.Paeth);
const MinSum = {
    kind: 'minSum'
};
const Entropy = {
    kind: 'entropy'
};
const Bigrams = {
    kind: 'bigrams'
};
const BigEnt = {
    kind: 'bigEnt'
};
const Brute = (numLines, level)=>({
        kind: 'brute',
        numLines,
        level
    });
const Predefined = (lines)=>({
        kind: 'predefined',
        lines
    });
function filterStrategyKey(fs) {
    switch(fs.kind){
        case 'basic':
            return `b${fs.filter}`;
        case 'brute':
            return `brute:${fs.numLines}:${fs.level}`;
        case 'predefined':
            return `p:${fs.lines.join(',')}`;
        default:
            return fs.kind;
    }
}
function kindOrder(fs) {
    switch(fs.kind){
        case 'basic':
            return 0;
        case 'minSum':
            return 1;
        case 'entropy':
            return 2;
        case 'bigrams':
            return 3;
        case 'bigEnt':
            return 4;
        case 'brute':
            return 5;
        case 'predefined':
            return 6;
    }
}
function filterStrategyCompare(a, b) {
    const ka = kindOrder(a);
    const kb = kindOrder(b);
    if (ka !== kb) return ka - kb;
    if ('basic' === a.kind && 'basic' === b.kind) return a.filter - b.filter;
    if ('brute' === a.kind && 'brute' === b.kind) {
        if (a.numLines !== b.numLines) return a.numLines - b.numLines;
        return a.level - b.level;
    }
    if ('predefined' === a.kind && 'predefined' === b.kind) {
        const n = Math.min(a.lines.length, b.lines.length);
        for(let i = 0; i < n; i++)if (a.lines[i] !== b.lines[i]) return a.lines[i] - b.lines[i];
        return a.lines.length - b.lines.length;
    }
    return 0;
}
function filterStrategyEquals(a, b) {
    return filterStrategyKey(a) === filterStrategyKey(b);
}
function filterStrategyToString(fs) {
    switch(fs.kind){
        case 'basic':
            return rowFilterName(fs.filter);
        case 'minSum':
            return 'MinSum';
        case 'entropy':
            return 'Entropy';
        case 'bigrams':
            return 'Bigrams';
        case 'bigEnt':
            return 'BigEnt';
        case 'brute':
            return 'Brute';
        case 'predefined':
            return 'Predefined';
    }
}
function strategyEvaluator(fs) {
    switch(fs.kind){
        case 'minSum':
            return new MinSumEvaluator();
        case 'entropy':
            return new EntropyEvaluator();
        case 'bigrams':
            return new BigramsEvaluator();
        case 'bigEnt':
            return new BigEntEvaluator();
        case 'brute':
            return new BruteEvaluator(fs.numLines, fs.level);
        default:
            return null;
    }
}
function ilog2i(i) {
    const log = 31 - Math.clz32(i);
    return i * log + (i - (1 << log) << 1);
}
class MinSumEvaluator {
    bestSize = Number.MAX_SAFE_INTEGER;
    reset() {
        this.bestSize = Number.MAX_SAFE_INTEGER;
    }
    evaluate(buf, offset, end) {
        let size = 0;
        for(let i = offset; i < end; i++){
            const signed = buf[i] << 24 >> 24;
            size += Math.abs(signed);
        }
        if (size < this.bestSize) {
            this.bestSize = size;
            return true;
        }
        return false;
    }
}
class EntropyEvaluator {
    hist = new Uint32Array(256);
    bestSize = -2147483648;
    reset() {
        this.bestSize = -2147483648;
    }
    evaluate(buf, offset, end) {
        const hist = this.hist;
        hist.fill(0);
        let i = offset;
        for(; i + 4 <= end; i += 4){
            hist[buf[i]]++;
            hist[buf[i + 1]]++;
            hist[buf[i + 2]]++;
            hist[buf[i + 3]]++;
        }
        for(; i < end; i++)hist[buf[i]]++;
        let size = 0;
        for(let k = 0; k < 256; k++){
            const x = hist[k];
            if (0 !== x) size += ilog2i(x);
        }
        if (size > this.bestSize) {
            this.bestSize = size;
            return true;
        }
        return false;
    }
}
class BigramsEvaluator {
    seen = new Uint8Array(0x10000);
    touched = [];
    bestSize = Number.MAX_SAFE_INTEGER;
    reset() {
        this.bestSize = Number.MAX_SAFE_INTEGER;
    }
    evaluate(buf, offset, end) {
        for(let i = 0; i < this.touched.length; i++)this.seen[this.touched[i]] = 0;
        this.touched.length = 0;
        let count = 0;
        for(let i = offset; i + 1 < end; i++){
            const bigram = buf[i] << 8 | buf[i + 1];
            if (0 === this.seen[bigram]) {
                count++;
                if (count >= this.bestSize) return false;
                this.seen[bigram] = 1;
                this.touched.push(bigram);
            }
        }
        this.bestSize = count;
        return true;
    }
}
class BigEntEvaluator {
    seen = new Uint32Array(0x10000);
    touched = [];
    bestSize = -2147483648;
    reset() {
        this.bestSize = -2147483648;
    }
    evaluate(buf, offset, end) {
        for(let i = offset; i + 1 < end; i++){
            const bigram = buf[i] << 8 | buf[i + 1];
            if (0 === this.seen[bigram]) this.touched.push(bigram);
            this.seen[bigram]++;
        }
        let size = 0;
        for(let i = 0; i < this.touched.length; i++){
            const idx = this.touched[i];
            size += ilog2i(this.seen[idx]);
            this.seen[idx] = 0;
        }
        this.touched.length = 0;
        if (size > this.bestSize) {
            this.bestSize = size;
            return true;
        }
        return false;
    }
}
class BruteEvaluator {
    limit = 0;
    bufferSize = Number.MAX_SAFE_INTEGER;
    numLines;
    level;
    constructor(numLines, level){
        this.numLines = numLines;
        this.level = level;
    }
    reset(lineLen) {
        this.limit = lineLen * this.numLines;
        this.bufferSize = Number.MAX_SAFE_INTEGER;
    }
    evaluate(buf, _offset, end) {
        const start = Math.max(0, end - this.limit);
        const size = deflate_deflateRawSize(buf.subarray(start, end), this.level, this.bufferSize);
        if (null === size) return false;
        this.bufferSize = size - 1;
        return true;
    }
}
class Frame {
    width;
    height;
    xOffset;
    yOffset;
    delayNum;
    delayDen;
    disposeOp;
    blendOp;
    data;
    constructor(init){
        this.width = init.width;
        this.height = init.height;
        this.xOffset = init.xOffset;
        this.yOffset = init.yOffset;
        this.delayNum = init.delayNum;
        this.delayDen = init.delayDen;
        this.disposeOp = init.disposeOp;
        this.blendOp = init.blendOp;
        this.data = init.data ?? new Uint8Array(0);
    }
    static fromFctlData(byteData) {
        if (byteData.length < 26) throw PngError.truncatedData();
        return new Frame({
            width: readBeU32(byteData, 4),
            height: readBeU32(byteData, 8),
            xOffset: readBeU32(byteData, 12),
            yOffset: readBeU32(byteData, 16),
            delayNum: readBeU16(byteData, 20),
            delayDen: readBeU16(byteData, 22),
            disposeOp: byteData[24],
            blendOp: byteData[25]
        });
    }
    fctlData(sequenceNumber) {
        const byteData = new Uint8Array(26);
        writeBeU32(sequenceNumber >>> 0, byteData, 0);
        writeBeU32(this.width, byteData, 4);
        writeBeU32(this.height, byteData, 8);
        writeBeU32(this.xOffset, byteData, 12);
        writeBeU32(this.yOffset, byteData, 16);
        writeBeU16(this.delayNum, byteData, 20);
        writeBeU16(this.delayDen, byteData, 22);
        byteData[24] = this.disposeOp;
        byteData[25] = this.blendOp;
        return byteData;
    }
    fdatData(sequenceNumber) {
        const byteData = new Uint8Array(4 + this.data.length);
        writeBeU32(sequenceNumber >>> 0, byteData, 0);
        byteData.set(this.data, 4);
        return byteData;
    }
}
class ByteBuffer {
    buf;
    len;
    constructor(capacity = 0){
        this.buf = new Uint8Array(capacity);
        this.len = 0;
    }
    static from(bytes) {
        const b = new ByteBuffer(bytes.length);
        b.buf.set(bytes, 0);
        b.len = bytes.length;
        return b;
    }
    reserve(additional) {
        const required = this.len + additional;
        if (required <= this.buf.length) return;
        let capacity = 0 === this.buf.length ? 32 : this.buf.length;
        while(capacity < required)capacity *= 2;
        const next = new Uint8Array(capacity);
        next.set(this.buf.subarray(0, this.len), 0);
        this.buf = next;
    }
    push(byte) {
        if (this.len >= this.buf.length) this.reserve(1);
        this.buf[this.len++] = 0xff & byte;
    }
    extend(bytes) {
        const n = bytes.length;
        if (0 === n) return;
        this.reserve(n);
        if (bytes instanceof Uint8Array) this.buf.set(bytes, this.len);
        else for(let i = 0; i < n; i++)this.buf[this.len + i] = 0xff & bytes[i];
        this.len += n;
    }
    truncate(newLen) {
        if (newLen < this.len) this.len = newLen;
    }
    extendZeros(count) {
        this.reserve(count);
        this.buf.fill(0, this.len, this.len + count);
        this.len += count;
    }
    extendFill(value, count) {
        this.reserve(count);
        this.buf.fill(0xff & value, this.len, this.len + count);
        this.len += count;
    }
    toUint8Array() {
        return this.buf.slice(0, this.len);
    }
}
function _to_primitive(input, hint) {
    if ("object" !== _type_of(input) || null === input) return input;
    var prim = input[Symbol.toPrimitive];
    if (void 0 !== prim) {
        var res = prim.call(input, hint || "default");
        if ("object" !== _type_of(res)) return res;
        throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return ("string" === hint ? String : Number)(input);
}
function _to_property_key(arg) {
    var key = _to_primitive(arg, "string");
    return "symbol" === _type_of(key) ? key : String(key);
}
function _type_of(obj) {
    return obj && "u" > typeof Symbol && obj.constructor === Symbol ? "symbol" : typeof obj;
}
let _computedKey;
class ScanLineRanges {
    pass;
    bitsPerPixel;
    width;
    height;
    left;
    hasFilter;
    constructor(ihdr, dataLen, hasFilter){
        this.bitsPerPixel = ihdrBpp(ihdr);
        this.width = ihdr.width;
        this.height = ihdr.height;
        this.left = dataLen;
        this.pass = ihdr.interlaced ? {
            p: 1,
            row: 0
        } : null;
        this.hasFilter = hasFilter;
    }
    next() {
        if (0 === this.left) return null;
        let pixelsPerLine;
        let currentPass;
        const pass = this.pass;
        if (pass) {
            if (this.width < 5 && 2 === pass.p) {
                pass.p = 3;
                pass.row = 4;
            }
            if (this.height < 5 && 3 === pass.p) {
                pass.p = 4;
                pass.row = 0;
            }
            if (this.width < 3 && 4 === pass.p) {
                pass.p = 5;
                pass.row = 2;
            }
            if (this.height < 3 && 5 === pass.p) {
                pass.p = 6;
                pass.row = 0;
            }
            if (1 === this.width && 6 === pass.p) {
                pass.p = 7;
                pass.row = 1;
            }
            let pixelsFactor;
            let ySteps;
            switch(pass.p){
                case 1:
                case 2:
                    pixelsFactor = 8;
                    ySteps = 8;
                    break;
                case 3:
                    pixelsFactor = 4;
                    ySteps = 8;
                    break;
                case 4:
                    pixelsFactor = 4;
                    ySteps = 4;
                    break;
                case 5:
                    pixelsFactor = 2;
                    ySteps = 4;
                    break;
                case 6:
                    pixelsFactor = 2;
                    ySteps = 2;
                    break;
                case 7:
                    pixelsFactor = 1;
                    ySteps = 2;
                    break;
                default:
                    throw new Error('unreachable');
            }
            let ppl = Math.floor(this.width / pixelsFactor);
            const gap = this.width % pixelsFactor;
            switch(pass.p){
                case 1:
                case 3:
                case 5:
                    if (gap > 0) ppl += 1;
                    break;
                case 2:
                    if (gap >= 5) ppl += 1;
                    break;
                case 4:
                    if (gap >= 3) ppl += 1;
                    break;
                case 6:
                    if (gap >= 2) ppl += 1;
                    break;
                default:
                    break;
            }
            currentPass = pass.p;
            if (pass.row + ySteps >= this.height) {
                pass.p += 1;
                pass.row = 3 === pass.p ? 4 : 5 === pass.p ? 2 : 7 === pass.p ? 1 : 0;
            } else pass.row += ySteps;
            pixelsPerLine = ppl;
        } else {
            pixelsPerLine = this.width;
            currentPass = null;
        }
        const bitsPerLine = pixelsPerLine * this.bitsPerPixel;
        let len = Math.ceil(bitsPerLine / 8);
        if (this.hasFilter) len += 1;
        this.left -= len;
        if (this.left < 0) {
            this.left = 0;
            return null;
        }
        return {
            len,
            pass: currentPass,
            numPixels: pixelsPerLine
        };
    }
}
_computedKey = _to_property_key(Symbol.iterator);
class ScanLines {
    iter;
    data;
    pos = 0;
    hasFilter;
    constructor(ihdr, data, hasFilter){
        this.iter = new ScanLineRanges(ihdr, data.length, hasFilter);
        this.data = data;
        this.hasFilter = hasFilter;
    }
    next() {
        const range = this.iter.next();
        if (!range) return null;
        const { len, pass, numPixels } = range;
        if (this.data.length - this.pos < len) return null;
        const start = this.pos;
        this.pos += len;
        let filter = 0;
        let dataStart = start;
        if (this.hasFilter) {
            filter = this.data[start];
            dataStart = start + 1;
        }
        return {
            filter,
            data: this.data.subarray(dataStart, start + len),
            pass,
            numPixels
        };
    }
    [_computedKey]() {
        return {
            next: ()=>{
                const line = this.next();
                if (null === line) return {
                    done: true,
                    value: void 0
                };
                return {
                    done: false,
                    value: line
                };
            }
        };
    }
}
const EMPTY = new Uint8Array(0);
class PngImage {
    ihdr;
    data;
    constructor(ihdr, data){
        this.ihdr = ihdr;
        this.data = data;
    }
    static new(ihdr, compressedData) {
        const expected = rawDataSize(ihdr);
        const raw = inflate(compressedData, expected);
        if (raw.length !== expected) throw PngError.truncatedData();
        const image = new PngImage(ihdr, raw);
        image.data = image.unfilterImage();
        return image;
    }
    channelsPerPixel() {
        return channelsPerPixel(this.ihdr.colorType);
    }
    bytesPerChannel() {
        return 16 === this.ihdr.bitDepth ? 2 : 1;
    }
    keyChunksSize() {
        const ct = this.ihdr.colorType;
        if ('indexed' === ct.kind) {
            const plte = 12 + 3 * ct.palette.length;
            let lastTrns = -1;
            for(let i = ct.palette.length - 1; i >= 0; i--)if ((0xff & ct.palette[i]) !== 255) {
                lastTrns = i;
                break;
            }
            return -1 === lastTrns ? plte : plte + 12 + lastTrns + 1;
        }
        if ('grayscale' === ct.kind && null !== ct.transparentShade) return 14;
        if ('rgb' === ct.kind && null !== ct.transparentColor) return 18;
        return 0;
    }
    estimatedOutputSize(idatData) {
        return idatData.length + this.keyChunksSize();
    }
    scanLines(hasFilter) {
        return new ScanLines(this.ihdr, this.data, hasFilter);
    }
    unfilterImage() {
        const out = new ByteBuffer(this.data.length);
        const bpp = this.bytesPerChannel() * this.channelsPerPixel();
        let prevLine = EMPTY;
        let prevPass = null;
        for (const line of this.scanLines(true)){
            if (prevPass !== line.pass || 0 === prevLine.length) {
                prevLine = new Uint8Array(line.data.length);
                prevPass = line.pass;
            }
            const offset = out.len;
            const filter = rowFilterFromNumber(line.filter);
            unfilterLine(filter, bpp, line.data, prevLine, out);
            prevLine.set(out.buf.subarray(offset, out.len));
        }
        return out.toUint8Array();
    }
    filterImage(strategy, optimizeAlpha) {
        const out = new ByteBuffer(rawDataSize(this.ihdr));
        const bpp = this.bytesPerChannel() * this.channelsPerPixel();
        const alphaBytes = optimizeAlpha && hasAlpha(this.ihdr.colorType) ? this.bytesPerChannel() : 0;
        let cur = EMPTY;
        let prev = EMPTY;
        let best = new Uint8Array(0);
        let bestRaw = EMPTY;
        let passLen = -1;
        let prevPass = null;
        const filtersUsed = [];
        const heuristic = strategyEvaluator(strategy);
        let index = 0;
        for (const line of this.scanLines(false)){
            const lineLen = line.data.length;
            if (prevPass !== line.pass) {
                prevPass = line.pass;
                passLen = -1;
            }
            if (passLen !== lineLen) {
                passLen = lineLen;
                cur = 0 !== alphaBytes ? new Uint8Array(lineLen) : EMPTY;
                prev = new Uint8Array(lineLen);
                best = null !== heuristic ? new Uint8Array(lineLen + 1) : EMPTY;
                bestRaw = 0 !== alphaBytes && null !== heuristic ? new Uint8Array(lineLen) : EMPTY;
            }
            if (0 !== alphaBytes) cur.set(line.data);
            else cur = line.data;
            if ('basic' === strategy.kind) {
                filterLine(strategy.filter, bpp, cur, prev, out, alphaBytes);
                const tmp = cur;
                cur = prev;
                prev = tmp;
                index++;
                continue;
            }
            if ('predefined' === strategy.kind) {
                const f = strategy.lines[index] ?? RowFilter.None;
                filterLine(f, bpp, cur, prev, out, alphaBytes);
                const tmp = cur;
                cur = prev;
                prev = tmp;
                index++;
                continue;
            }
            let bestFilter = RowFilter.None;
            let allZero = true;
            for(let k = 0; k < lineLen; k++)if (0 !== cur[k]) {
                allZero = false;
                break;
            }
            if (allZero) {
                filterLine(bestFilter, bpp, cur, prev, out, alphaBytes);
                const tmp = cur;
                cur = prev;
                prev = tmp;
                filtersUsed.push(bestFilter);
                index++;
                continue;
            }
            const offset = out.len;
            const evaluator = heuristic;
            evaluator.reset(lineLen + 1);
            let bestSize = Number.MAX_SAFE_INTEGER;
            for (const f of ROW_FILTER_ALL){
                let improved;
                if ('minSum' === strategy.kind) {
                    const size = filterLineMinSum(f, bpp, cur, prev, out, alphaBytes, bestSize);
                    improved = size < bestSize;
                    if (improved) bestSize = size;
                } else {
                    filterLine(f, bpp, cur, prev, out, alphaBytes);
                    improved = evaluator.evaluate(out.buf, offset, out.len);
                }
                if (improved) {
                    best.set(out.buf.subarray(offset, out.len));
                    if (0 !== alphaBytes) bestRaw.set(cur);
                    bestFilter = f;
                }
                out.truncate(offset);
            }
            out.extend(best);
            if (0 !== alphaBytes) {
                const tmp = bestRaw;
                bestRaw = prev;
                prev = tmp;
            } else prev = cur;
            filtersUsed.push(bestFilter);
            index++;
        }
        const filtered = out.buf.subarray(0, out.len);
        if (0 === filtersUsed.length) return [
            filtered,
            strategy
        ];
        return [
            filtered,
            Predefined(filtersUsed)
        ];
    }
}
class PngData {
    raw;
    idatData;
    auxChunks;
    frames;
    constructor(raw, idatData, auxChunks, frames){
        this.raw = raw;
        this.idatData = idatData;
        this.auxChunks = auxChunks;
        this.frames = frames;
    }
    static fromSlice(byteData, opts) {
        if (byteData.length < 8 || !fileHeaderIsValid(byteData.subarray(0, 8))) throw PngError.notPNG();
        const state = {
            offset: 8
        };
        const idatParts = [];
        let idatLength = 0;
        let sawIdat = false;
        const keyChunks = new Map();
        const auxChunks = [];
        const frames = [];
        let sequenceNumber = 0;
        for(;;){
            const chunk = parseNextChunk(byteData, state, opts.fixErrors);
            if (null === chunk) break;
            const name = chunk.name;
            if ('IDAT' === name) {
                if (!sawIdat) {
                    auxChunks.push({
                        name: 'IDAT',
                        data: EMPTY
                    });
                    sawIdat = true;
                }
                idatParts.push(chunk.data);
                idatLength += chunk.data.length;
            } else if ('IHDR' === name || 'PLTE' === name || 'tRNS' === name) keyChunks.set(name, chunk.data.slice());
            else if (stripKeep(opts.strip, name)) {
                if ('caBX' === name || 'iDOT' === name) {
                    if ('keep' === opts.strip.mode) throw PngError.chunkPreventsChanges(nameBytes(name));
                    continue;
                }
                if ('fcTL' === name || 'fdAT' === name) {
                    if (chunk.data.length < 4 || readBeU32(chunk.data, 0) !== sequenceNumber) throw PngError.apngOutOfOrder();
                    sequenceNumber += 1;
                    if ('fcTL' === name && sawIdat) {
                        frames.push(Frame.fromFctlData(chunk.data));
                        continue;
                    } else if ('fdAT' === name) {
                        const last = frames[frames.length - 1];
                        if (!last) throw PngError.apngOutOfOrder();
                        const merged = new Uint8Array(last.data.length + chunk.data.length - 4);
                        merged.set(last.data, 0);
                        merged.set(chunk.data.subarray(4), last.data.length);
                        last.data = merged;
                        continue;
                    }
                }
                auxChunks.push({
                    name,
                    data: chunk.data.slice()
                });
            }
        }
        if (!sawIdat || 0 === idatLength) throw PngError.chunkMissing('IDAT');
        const idatData = new Uint8Array(idatLength);
        {
            let p = 0;
            for (const part of idatParts){
                idatData.set(part, p);
                p += part.length;
            }
        }
        const ihdrChunk = keyChunks.get('IHDR');
        if (!ihdrChunk) throw PngError.chunkMissing('IHDR');
        const ihdr = parseIhdrChunk(ihdrChunk, keyChunks.get('PLTE'), keyChunks.get('tRNS'));
        if (null !== opts.maxDecompressedSize && rawDataSize(ihdr) > opts.maxDecompressedSize) throw PngError.inflatedDataTooLong(opts.maxDecompressedSize);
        const raw = PngImage.new(ihdr, idatData);
        return new PngData(raw, idatData, auxChunks, frames);
    }
    output() {
        const out = new ByteBuffer();
        out.extend([
            0x89,
            0x50,
            0x4e,
            0x47,
            0x0d,
            0x0a,
            0x1a,
            0x0a
        ]);
        const ihdr = this.raw.ihdr;
        const ihdrData = new Uint8Array(13);
        writeBeU32(ihdr.width, ihdrData, 0);
        writeBeU32(ihdr.height, ihdrData, 4);
        ihdrData[8] = ihdr.bitDepth;
        ihdrData[9] = pngCode(ihdr.colorType);
        ihdrData[10] = 0;
        ihdrData[11] = 0;
        ihdrData[12] = ihdr.interlaced ? 1 : 0;
        writePngBlock('IHDR', ihdrData, out);
        let idatIndex = this.auxChunks.findIndex((c)=>'IDAT' === c.name);
        if (-1 === idatIndex) idatIndex = this.auxChunks.length;
        const auxPre = this.auxChunks.slice(0, idatIndex);
        const auxPost = this.auxChunks.slice(idatIndex + 1);
        const isLateChunk = (name)=>'bKGD' === name || 'hIST' === name || 'tRNS' === name || 'fcTL' === name;
        for (const chunk of auxPre)if (!isLateChunk(chunk.name)) writePngBlock(chunk.name, chunk.data, out);
        const ct = ihdr.colorType;
        if ('indexed' === ct.kind) {
            const paletteData = new Uint8Array(3 * ct.palette.length);
            for(let i = 0; i < ct.palette.length; i++){
                const c = ct.palette[i];
                paletteData[3 * i] = c >>> 24 & 0xff;
                paletteData[3 * i + 1] = c >>> 16 & 0xff;
                paletteData[3 * i + 2] = c >>> 8 & 0xff;
            }
            writePngBlock('PLTE', paletteData, out);
            let lastTrns = -1;
            for(let i = ct.palette.length - 1; i >= 0; i--)if ((0xff & ct.palette[i]) !== 255) {
                lastTrns = i;
                break;
            }
            if (-1 !== lastTrns) {
                const trnsData = new Uint8Array(lastTrns + 1);
                for(let i = 0; i <= lastTrns; i++)trnsData[i] = 0xff & ct.palette[i];
                writePngBlock('tRNS', trnsData, out);
            }
        } else if ('grayscale' === ct.kind && null !== ct.transparentShade) {
            const trns = new Uint8Array(2);
            writeBeU16(ct.transparentShade, trns, 0);
            writePngBlock('tRNS', trns, out);
        } else if ('rgb' === ct.kind && null !== ct.transparentColor) {
            const trns = new Uint8Array(6);
            writeBeU16(ct.transparentColor.r, trns, 0);
            writeBeU16(ct.transparentColor.g, trns, 2);
            writeBeU16(ct.transparentColor.b, trns, 4);
            writePngBlock('tRNS', trns, out);
        }
        let sequenceNumber = 0;
        for (const chunk of auxPre)if (isLateChunk(chunk.name)) {
            writePngBlock(chunk.name, chunk.data, out);
            if ('fcTL' === chunk.name) sequenceNumber += 1;
        }
        writePngBlock('IDAT', this.idatData, out);
        for (const frame of this.frames){
            writePngBlock('fcTL', frame.fctlData(sequenceNumber), out);
            writePngBlock('fdAT', frame.fdatData(sequenceNumber + 1), out);
            sequenceNumber += 2;
        }
        for (const chunk of auxPost)writePngBlock(chunk.name, chunk.data, out);
        writePngBlock('IEND', EMPTY, out);
        return out.toUint8Array();
    }
}
function pngCode(ct) {
    switch(ct.kind){
        case 'grayscale':
            return 0;
        case 'rgb':
            return 2;
        case 'indexed':
            return 3;
        case 'grayscaleAlpha':
            return 4;
        case 'rgba':
            return 6;
    }
}
function writePngBlock(name, chunk, output) {
    const length = chunk.length;
    output.reserve(12 + length);
    const header = new Uint8Array(8);
    writeBeU32(length, header, 0);
    header[4] = name.charCodeAt(0);
    header[5] = name.charCodeAt(1);
    header[6] = name.charCodeAt(2);
    header[7] = name.charCodeAt(3);
    output.extend(header);
    output.extend(chunk);
    output.reserve(4);
    const crcInput = new Uint8Array(4 + length);
    crcInput.set(header.subarray(4), 0);
    crcInput.set(chunk, 4);
    const crc = crc32(crcInput);
    const crcBytes = new Uint8Array(4);
    writeBeU32(crc, crcBytes, 0);
    output.extend(crcBytes);
}
function filterSetFrom(items) {
    const out = [];
    const seen = new Set();
    for (const item of items){
        const key = filterStrategyKey(item);
        if (!seen.has(key)) {
            seen.add(key);
            out.push(item);
        }
    }
    return out;
}
function filterSetDifference(a, b) {
    const keys = new Set(b.map(filterStrategyKey));
    return a.filter((f)=>!keys.has(filterStrategyKey(f)));
}
class Options {
    fixErrors = false;
    force = false;
    filters = [
        NONE,
        SUB,
        Entropy,
        Bigrams
    ];
    interlace = false;
    optimizeAlpha = false;
    bitDepthReduction = true;
    colorTypeReduction = true;
    paletteReduction = true;
    grayscaleReduction = true;
    idatRecoding = true;
    scale16 = false;
    strip = {
        mode: 'none'
    };
    deflater = libdeflater(11, true);
    fastEvaluation = true;
    timeout = null;
    maxDecompressedSize = null;
    static default() {
        return new Options();
    }
    clone() {
        const o = new Options();
        o.fixErrors = this.fixErrors;
        o.force = this.force;
        o.filters = this.filters.map((f)=>cloneFilter(f));
        o.interlace = this.interlace;
        o.optimizeAlpha = this.optimizeAlpha;
        o.bitDepthReduction = this.bitDepthReduction;
        o.colorTypeReduction = this.colorTypeReduction;
        o.paletteReduction = this.paletteReduction;
        o.grayscaleReduction = this.grayscaleReduction;
        o.idatRecoding = this.idatRecoding;
        o.scale16 = this.scale16;
        o.strip = cloneStrip(this.strip);
        o.deflater = this.deflater;
        o.fastEvaluation = this.fastEvaluation;
        o.timeout = this.timeout;
        o.maxDecompressedSize = this.maxDecompressedSize;
        return o;
    }
    static fromPreset(level) {
        switch(level){
            case 0:
                return preset0();
            case 1:
                return preset1();
            case 2:
                return new Options();
            case 3:
                return preset3();
            case 4:
                return preset4();
            case 5:
                return preset5();
            case 6:
                return preset6();
            default:
                return preset6();
        }
    }
    static maxCompression() {
        return Options.fromPreset(6);
    }
}
function cloneFilter(f) {
    if ('predefined' === f.kind) return {
        kind: 'predefined',
        lines: [
            ...f.lines
        ]
    };
    if ('brute' === f.kind) return {
        kind: 'brute',
        numLines: f.numLines,
        level: f.level
    };
    return {
        ...f
    };
}
function cloneStrip(strip) {
    if ('strip' === strip.mode || 'keep' === strip.mode) return {
        mode: strip.mode,
        names: new Set(strip.names)
    };
    return {
        ...strip
    };
}
function preset0() {
    const o = new Options();
    o.filters = filterSetFrom([
        NONE,
        MinSum
    ]);
    o.deflater = libdeflater(5);
    return o;
}
function preset1() {
    const o = new Options();
    o.filters = filterSetFrom([
        NONE,
        Bigrams
    ]);
    o.deflater = libdeflater(10);
    return o;
}
function preset3() {
    const o = new Options();
    o.deflater = libdeflater(11);
    o.filters = filterSetFrom([
        NONE,
        SUB,
        Entropy,
        Bigrams,
        BigEnt,
        Brute(3, 1)
    ]);
    return o;
}
function preset4() {
    const o = new Options();
    o.filters = filterSetFrom([
        NONE,
        SUB,
        Entropy,
        Bigrams,
        BigEnt,
        Brute(4, 1)
    ]);
    o.deflater = libdeflater(12);
    return o;
}
function preset5() {
    const o = new Options();
    o.fastEvaluation = false;
    o.filters = filterSetFrom([
        NONE,
        SUB,
        Entropy,
        Bigrams,
        BigEnt,
        Brute(8, 1)
    ]);
    o.deflater = libdeflater(12);
    return o;
}
function preset6() {
    const o = new Options();
    o.fastEvaluation = false;
    o.filters = filterSetFrom([
        NONE,
        SUB,
        UP,
        AVERAGE,
        PAETH,
        MinSum,
        Entropy,
        Bigrams,
        BigEnt,
        Brute(8, 5)
    ]);
    o.deflater = libdeflater(12);
    return o;
}
function now() {
    return "u" > typeof performance && 'function' == typeof performance.now ? performance.now() : Date.now();
}
class Deadline {
    start;
    timeoutMs;
    printMessage = true;
    warn;
    constructor(timeoutSeconds, warn = ()=>{}){
        this.warn = warn;
        this.start = now();
        this.timeoutMs = null === timeoutSeconds ? null : 1000 * timeoutSeconds;
    }
    passed() {
        if (null === this.timeoutMs) return false;
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
class AtomicMin {
    value;
    constructor(init){
        this.value = init ?? Number.MAX_SAFE_INTEGER;
    }
    get() {
        return this.value === Number.MAX_SAFE_INTEGER ? null : this.value;
    }
    setMin(newValue) {
        if (newValue < this.value) {
            this.value = newValue;
            return true;
        }
        return false;
    }
}
function cmpKey(c) {
    return [
        c.estimatedOutputSize,
        c.image.data.length,
        c.filter,
        Number.MAX_SAFE_INTEGER - c.nth
    ];
}
function compareCandidates(a, b) {
    const ka = cmpKey(a);
    const kb = cmpKey(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    const fc = filterStrategyCompare(ka[2], kb[2]);
    if (0 !== fc) return fc;
    return ka[3] - kb[3];
}
class Evaluator {
    nth = 0;
    bestCandidateSize;
    best = null;
    deadline;
    filters;
    deflater;
    optimizeAlpha;
    finalRound;
    trace;
    constructor(deadline, filters, deflater, optimizeAlpha, finalRound, trace = ()=>{}){
        this.deadline = deadline;
        this.filters = filters;
        this.deflater = deflater;
        this.optimizeAlpha = optimizeAlpha;
        this.finalRound = finalRound;
        this.trace = trace;
        this.bestCandidateSize = new AtomicMin(null);
    }
    setBestSize(size) {
        this.bestCandidateSize.setMin(size);
    }
    tryImage(image) {
        this.tryImageWithDescription(image, colorTypeToString(image.ihdr.colorType));
    }
    tryImageWithDescription(image, description) {
        const nth = this.nth++;
        const keyChunksSize = image.keyChunksSize();
        for (const filter of this.filters){
            if (this.deadline.passed()) return;
            const [filtered, filterUsed] = image.filterImage(filter, this.optimizeAlpha);
            let idatData = null;
            let idatSize;
            try {
                const bestSize = this.bestCandidateSize.get();
                const limit = null === bestSize ? void 0 : bestSize - keyChunksSize;
                if (void 0 !== limit && limit < 0) continue;
                if (this.finalRound) {
                    idatData = deflaterDeflate(this.deflater, filtered, limit);
                    idatSize = idatData.length;
                } else idatSize = deflaterDeflateSize(this.deflater, filtered, limit);
            } catch (err) {
                if (err instanceof PngError && 'DeflatedDataTooLong' === err.kind) this.trace(`Eval: ${image.ihdr.bitDepth}-bit ${description} >${err.size} bytes`);
                continue;
            }
            const estimatedOutputSize = idatSize + keyChunksSize;
            this.trace(`Eval: ${image.ihdr.bitDepth}-bit ${description} ${estimatedOutputSize} bytes`);
            const bestSize = this.bestCandidateSize.get();
            if (null !== bestSize && estimatedOutputSize > bestSize) continue;
            const candidate = {
                image,
                idatData,
                estimatedOutputSize,
                filter,
                filterUsed,
                nth,
                filteredData: this.finalRound ? void 0 : filtered,
                filteredOptimizeAlpha: this.optimizeAlpha
            };
            this.bestCandidateSize.setMin(estimatedOutputSize);
            if (null === this.best || compareCandidates(this.best, candidate) >= 0) this.best = candidate;
        }
    }
    getBestCandidate() {
        return this.best;
    }
}
const LogLevel = {
    Off: 0,
    Error: 1,
    Warn: 2,
    Info: 3,
    Debug: 4,
    Trace: 5
};
let currentLevel = LogLevel.Warn;
let sink = null;
function setLogLevel(level) {
    currentLevel = level;
}
function getLogLevel() {
    return currentLevel;
}
function setLogSink(fn) {
    sink = fn;
}
function emit(severity, name, message) {
    if (severity > currentLevel) return;
    if (sink) return void sink(name, message);
    if ('ERROR' === name) console.error(message);
    else if ('WARN' === name) console.warn(message);
    else console.log(message);
}
const logError = (message)=>emit(LogLevel.Error, 'ERROR', message);
const logWarn = (message)=>emit(LogLevel.Warn, 'WARN', message);
const logInfo = (message)=>emit(LogLevel.Info, 'INFO', message);
const logDebug = (message)=>emit(LogLevel.Debug, 'DEBUG', message);
const logTrace = (message)=>emit(LogLevel.Trace, 'TRACE', message);
function cloneIhdr(ihdr) {
    return {
        ...ihdr
    };
}
function cleanedAlphaChannel(png) {
    if (!hasAlpha(png.ihdr.colorType)) return null;
    const byteDepth = png.bytesPerChannel();
    const bpp = png.channelsPerPixel() * byteDepth;
    const coloredBytes = bpp - byteDepth;
    const data = png.data;
    const reduced = new ByteBuffer(data.length);
    for(let i = 0; i < data.length; i += bpp){
        let transparent = true;
        for(let j = i + coloredBytes; j < i + bpp; j++)if (0 !== data[j]) {
            transparent = false;
            break;
        }
        if (transparent) reduced.extendZeros(bpp);
        else reduced.extend(data.subarray(i, i + bpp));
    }
    return new PngImage(cloneIhdr(png.ihdr), reduced.toUint8Array());
}
function reducedAlphaChannel(png, optimizeAlpha) {
    const ct = png.ihdr.colorType;
    const bd = png.ihdr.bitDepth;
    if ('grayscaleAlpha' === ct.kind && bd === BitDepth.Eight) return reducedAlphaChannelConst(png, optimizeAlpha, 2, 1);
    if ('grayscaleAlpha' === ct.kind && bd === BitDepth.Sixteen) return reducedAlphaChannelConst(png, optimizeAlpha, 4, 2);
    if ('rgba' === ct.kind && bd === BitDepth.Eight) return reducedAlphaChannelConst(png, optimizeAlpha, 4, 3);
    if ('rgba' === ct.kind && bd === BitDepth.Sixteen) return reducedAlphaChannelConst(png, optimizeAlpha, 8, 6);
    return null;
}
function reducedAlphaChannelConst(png, optimizeAlpha, bpp, coloredBytes) {
    const data = png.data;
    const nPixels = Math.floor(data.length / bpp);
    let hasTransparency = false;
    const usedColors = new Uint8Array(256);
    for(let p = 0; p < nPixels; p++){
        const base = p * bpp;
        let allAlphaZero = true;
        let anyAlphaNot255 = false;
        for(let j = coloredBytes; j < bpp; j++){
            const a = data[base + j];
            if (0 !== a) allAlphaZero = false;
            if (255 !== a) anyAlphaNot255 = true;
        }
        if (optimizeAlpha && allAlphaZero) hasTransparency = true;
        else if (anyAlphaNot255) return null;
        else if (optimizeAlpha) {
            let allSame = true;
            for(let j = 1; j < coloredBytes; j++)if (data[base + j] !== data[base]) {
                allSame = false;
                break;
            }
            if (allSame) usedColors[data[base]] = 1;
        }
    }
    let transparencyPixel = null;
    if (hasTransparency) {
        if ('grayscaleAlpha' === png.ihdr.colorType.kind) {
            for (const v of [
                0x00,
                0xff,
                0x55,
                0xaa
            ])if (!usedColors[v]) {
                transparencyPixel = v;
                break;
            }
        }
        if (null === transparencyPixel) {
            let found = -1;
            for(let v = 0; v < 256; v++)if (!usedColors[v]) {
                found = v;
                break;
            }
            if (-1 === found) return null;
            transparencyPixel = found;
        }
    }
    const rawData = new ByteBuffer(png.data.length);
    for(let p = 0; p < nPixels; p++){
        const base = p * bpp;
        let allAlphaZero = true;
        for(let j = coloredBytes; j < bpp; j++)if (0 !== data[base + j]) {
            allAlphaZero = false;
            break;
        }
        if (null !== transparencyPixel && allAlphaZero) rawData.extendFill(transparencyPixel, coloredBytes);
        else rawData.extend(data.subarray(base, base + coloredBytes));
    }
    const transparent = null === transparencyPixel ? null : png.ihdr.bitDepth === BitDepth.Sixteen ? transparencyPixel << 8 | transparencyPixel : transparencyPixel;
    let colorType;
    colorType = 'grayscaleAlpha' === png.ihdr.colorType.kind ? {
        kind: 'grayscale',
        transparentShade: transparent
    } : {
        kind: 'rgb',
        transparentColor: null === transparent ? null : {
            r: transparent,
            g: transparent,
            b: transparent
        }
    };
    return new PngImage({
        ...cloneIhdr(png.ihdr),
        colorType
    }, rawData.toUint8Array());
}
function rotl8(value, bits) {
    return (value << bits | value >>> 8 - bits) & 0xff;
}
function reducedBitDepth16To8(png, forceScale) {
    if (png.ihdr.bitDepth !== BitDepth.Sixteen) return null;
    if (forceScale) return scaledBitDepth16To8(png);
    const data = png.data;
    for(let i = 0; i + 1 < data.length; i += 2)if (data[i] !== data[i + 1]) return null;
    const reduced = new Uint8Array(data.length >> 1);
    for(let i = 0; i < reduced.length; i++)reduced[i] = data[2 * i];
    return new PngImage({
        ...png.ihdr,
        colorType: cloneColorType(png.ihdr.colorType),
        bitDepth: BitDepth.Eight
    }, reduced);
}
function scaledBitDepth16To8(png) {
    if (png.ihdr.bitDepth !== BitDepth.Sixteen) return null;
    const data = png.data;
    const reduced = new Uint8Array(data.length >> 1);
    for(let i = 0; i < reduced.length; i++){
        const hi = data[2 * i];
        const lo = data[2 * i + 1];
        if (hi === lo) reduced[i] = hi;
        else {
            const value = hi << 8 | lo;
            reduced[i] = Math.round(255 / 65535 * value);
        }
    }
    return new PngImage({
        ...png.ihdr,
        colorType: cloneColorType(png.ihdr.colorType),
        bitDepth: BitDepth.Eight
    }, reduced);
}
function reducedBitDepth8OrLess(png) {
    if (png.ihdr.bitDepth !== BitDepth.Eight || 1 !== png.channelsPerPixel()) return null;
    const ct = png.ihdr.colorType;
    let bitDepth;
    if ('indexed' === ct.kind) {
        const n = ct.palette.length;
        if (n <= 2) bitDepth = BitDepth.One;
        else if (n <= 4) bitDepth = BitDepth.Two;
        else {
            if (!(n <= 16)) return null;
            bitDepth = BitDepth.Four;
        }
    } else {
        let minimumBits = 1;
        let mask = 1;
        let divCount = 7;
        for(let i = 0; i < png.data.length; i++){
            const b = png.data[i];
            if (0 !== b && 255 !== b) tryDepth: for(;;){
                let byte = rotl8(b, minimumBits);
                const compare = byte & mask;
                for(let d = 0; d < divCount; d++){
                    byte = rotl8(byte, minimumBits);
                    if ((byte & mask) !== compare) {
                        minimumBits <<= 1;
                        if (8 === minimumBits) return null;
                        mask = (1 << minimumBits) - 1;
                        divCount = 8 / minimumBits - 1;
                        continue tryDepth;
                    }
                }
                break;
            }
        }
        bitDepth = minimumBits;
    }
    return reducedBitDepthForced(png, bitDepth);
}
function reducedBitDepthForced(png, bitDepth) {
    const numBits = bitDepth;
    const mask = (1 << numBits) - 1;
    const perByte = 8 / numBits;
    const reduced = new ByteBuffer(Math.ceil(png.data.length / perByte) + 1);
    for (const line of png.scanLines(false)){
        const data = line.data;
        for(let i = 0; i < data.length; i += perByte){
            let newByte = 0;
            let shift = 8;
            const end = Math.min(i + perByte, data.length);
            for(let j = i; j < end; j++){
                shift -= numBits;
                newByte |= (data[j] & mask) << shift;
            }
            reduced.push(newByte);
        }
    }
    let colorType = cloneColorType(png.ihdr.colorType);
    if ('grayscale' === colorType.kind && null !== colorType.transparentShade) {
        const trans = colorType.transparentShade;
        const reducedTrans = (0xff & trans) >> 8 - numBits;
        let check = reducedTrans;
        let bits = numBits;
        while(bits < 8){
            check = check << bits | check;
            bits <<= 1;
        }
        colorType = {
            kind: 'grayscale',
            transparentShade: trans === check ? reducedTrans : null
        };
    }
    return new PngImage({
        ...png.ihdr,
        colorType,
        bitDepth
    }, reduced.toUint8Array());
}
function expandedBitDepthTo8(png) {
    const bitDepth = png.ihdr.bitDepth;
    if (bitDepth >= 8) return null;
    const ppb = 8 / bitDepth;
    const isGray = 'grayscale' === png.ihdr.colorType.kind;
    const mask = (1 << bitDepth) - 1;
    const reduced = new ByteBuffer(png.ihdr.width * png.ihdr.height + 1);
    let length = 0;
    for (const line of png.scanLines(false)){
        for(let bi = 0; bi < line.data.length; bi++){
            let byte = line.data[bi];
            for(let k = 0; k < ppb; k++){
                byte = rotl8(byte, bitDepth);
                let val = byte & mask;
                if (isGray) {
                    let bits = bitDepth;
                    while(bits < 8){
                        val = val << bits | val;
                        bits <<= 1;
                    }
                }
                reduced.push(val);
            }
        }
        length += line.numPixels;
        reduced.truncate(length);
    }
    let colorType = cloneColorType(png.ihdr.colorType);
    if ('grayscale' === colorType.kind && null !== colorType.transparentShade) {
        let trans = colorType.transparentShade;
        let bits = bitDepth;
        while(bits < 8){
            trans = trans << bits | trans;
            bits <<= 1;
        }
        colorType = {
            kind: 'grayscale',
            transparentShade: trans
        };
    }
    return new PngImage({
        ...png.ihdr,
        colorType,
        bitDepth: BitDepth.Eight
    }, reduced.toUint8Array());
}
function cloneColorType(ct) {
    if ('indexed' === ct.kind) return {
        kind: 'indexed',
        palette: [
            ...ct.palette
        ]
    };
    if ('grayscale' === ct.kind) return {
        kind: 'grayscale',
        transparentShade: ct.transparentShade
    };
    if ('rgb' === ct.kind) return {
        kind: 'rgb',
        transparentColor: ct.transparentColor ? {
            ...ct.transparentColor
        } : null
    };
    return {
        kind: ct.kind
    };
}
class NumberIndexSet {
    map = new Map();
    values = [];
    insertFull(value) {
        const existing = this.map.get(value);
        if (void 0 !== existing) return [
            existing,
            false
        ];
        const index = this.values.length;
        this.map.set(value, index);
        this.values.push(value);
        return [
            index,
            true
        ];
    }
    get size() {
        return this.values.length;
    }
    toArray() {
        return this.values;
    }
}
const INDEXED_MAX_DIFF = 20000;
const BLACK = rgba8(0, 0, 0, 255);
function reducedToIndexed(png, allowGrayscale) {
    if (png.ihdr.bitDepth !== BitDepth.Eight) return null;
    const ct = png.ihdr.colorType;
    if ('indexed' === ct.kind) return null;
    if (!allowGrayscale && colors_isGray(ct)) return null;
    const data = png.data;
    const channels = channelsPerPixel(ct);
    const nPixels = Math.floor(data.length / channels);
    const indices = new Uint8Array(nPixels);
    const set = new NumberIndexSet();
    for(let i = 0; i < nPixels; i++){
        let key;
        switch(ct.kind){
            case 'grayscale':
                key = data[i];
                break;
            case 'rgb':
                key = data[3 * i] << 16 | data[3 * i + 1] << 8 | data[3 * i + 2];
                break;
            case 'grayscaleAlpha':
                key = data[2 * i] << 8 | data[2 * i + 1];
                break;
            case 'rgba':
                key = (data[4 * i] << 24 | data[4 * i + 1] << 16 | data[4 * i + 2] << 8 | data[4 * i + 3]) >>> 0;
                break;
            default:
                return null;
        }
        const [idx] = set.insertFull(key);
        if (256 === idx) return null;
        indices[i] = idx;
    }
    const keys = set.toArray();
    const palette = keys.map((key)=>decodePixel(key, ct));
    return new PngImage({
        ...png.ihdr,
        colorType: colors_indexed(palette)
    }, indices);
}
function decodePixel(key, ct) {
    switch(ct.kind){
        case 'grayscale':
            {
                const transparency = null === ct.transparentShade ? -1 : 0xff & ct.transparentShade;
                return rgba8(key, key, key, key === transparency ? 0 : 255);
            }
        case 'rgb':
            {
                const trns = ct.transparentColor;
                const transparency = null === trns ? -1 : (0xff & trns.r) << 16 | (0xff & trns.g) << 8 | 0xff & trns.b;
                return rgba8(key >>> 16 & 0xff, key >>> 8 & 0xff, 0xff & key, key === transparency ? 0 : 255);
            }
        case 'grayscaleAlpha':
            return rgba8(key >>> 8 & 0xff, key >>> 8 & 0xff, key >>> 8 & 0xff, 0xff & key);
        case 'rgba':
            return key >>> 0;
        default:
            return BLACK;
    }
}
function reducedRgbToGrayscale(png) {
    const ct = png.ihdr.colorType;
    if (!isRgb(ct)) return null;
    const byteDepth = png.bytesPerChannel();
    const bpp = png.channelsPerPixel() * byteDepth;
    const lastColor = 2 * byteDepth;
    const data = png.data;
    const reduced = new ByteBuffer(data.length);
    for(let i = 0; i < data.length; i += bpp){
        if (1 === byteDepth) {
            if (data[i] !== data[i + 1] || data[i + 1] !== data[i + 2]) return null;
        } else if (data[i] !== data[i + 2] || data[i + 1] !== data[i + 3] || data[i + 2] !== data[i + 4] || data[i + 3] !== data[i + 5]) return null;
        reduced.extend(data.subarray(i + lastColor, i + bpp));
    }
    let colorType;
    if ('rgb' === ct.kind) {
        const trns = ct.transparentColor;
        const shade = trns && trns.r === trns.g && trns.g === trns.b ? trns.r : null;
        colorType = {
            kind: 'grayscale',
            transparentShade: shade
        };
    } else colorType = {
        kind: 'grayscaleAlpha'
    };
    return new PngImage({
        ...png.ihdr,
        colorType
    }, reduced.toUint8Array());
}
function indexedToChannels(png, allowGrayscale, optimizeAlpha) {
    if (png.ihdr.bitDepth !== BitDepth.Eight) return null;
    if ('indexed' !== png.ihdr.colorType.kind) return null;
    const palette = [
        ...png.ihdr.colorType.palette
    ];
    if (optimizeAlpha) {
        for(let i = 0; i < palette.length; i++)if (0 === rgba8A(palette[i])) palette[i] = rgba8(0, 0, 0, 0);
    }
    const isGrayPalette = allowGrayscale && palette.every((c)=>rgba8R(c) === rgba8G(c) && rgba8G(c) === rgba8B(c));
    const hasAlphaPalette = palette.some((c)=>255 !== rgba8A(c));
    let colorType;
    colorType = !isGrayPalette && hasAlphaPalette ? {
        kind: 'rgba'
    } : isGrayPalette || hasAlphaPalette ? isGrayPalette && hasAlphaPalette ? {
        kind: 'grayscaleAlpha'
    } : {
        kind: 'grayscale',
        transparentShade: null
    } : {
        kind: 'rgb',
        transparentColor: null
    };
    const outSize = channelsPerPixel(colorType) * png.data.length;
    if (outSize - png.data.length > INDEXED_MAX_DIFF) return null;
    const chStart = isGrayPalette ? 2 : 0;
    const chEnd = hasAlphaPalette ? 3 : 2;
    const data = new ByteBuffer(outSize);
    for(let i = 0; i < png.data.length; i++){
        const color = palette[png.data[i]] ?? BLACK;
        const r = rgba8R(color);
        const g = rgba8G(color);
        const b = rgba8B(color);
        const a = rgba8A(color);
        const channels = [
            r,
            g,
            b,
            a
        ];
        for(let c = chStart; c <= chEnd; c++)data.push(channels[c]);
    }
    return new PngImage({
        ...png.ihdr,
        colorType
    }, data.toUint8Array());
}
function interlace_cloneColorType(ct) {
    if ('indexed' === ct.kind) return {
        kind: 'indexed',
        palette: [
            ...ct.palette
        ]
    };
    if ('grayscale' === ct.kind) return {
        kind: 'grayscale',
        transparentShade: ct.transparentShade
    };
    if ('rgb' === ct.kind) return {
        kind: 'rgb',
        transparentColor: ct.transparentColor ? {
            ...ct.transparentColor
        } : null
    };
    return {
        kind: ct.kind
    };
}
function changedInterlacing(png, interlace) {
    if (interlace === png.ihdr.interlaced) return null;
    const origDepth = png.ihdr.bitDepth;
    const expanded = expandedBitDepthTo8(png);
    const src = expanded ?? png;
    const data = interlace ? interlaceBytes(src) : deinterlaceBytes(src);
    let next = new PngImage({
        ...src.ihdr,
        colorType: interlace_cloneColorType(src.ihdr.colorType),
        interlaced: interlace
    }, data);
    if (next.ihdr.bitDepth !== origDepth) next = reducedBitDepthForced(next, origDepth);
    return next;
}
function interlaceBytes(png) {
    const bpp = ihdrBpp(png.ihdr) / 8;
    switch(bpp){
        case 1:
            return interlaceBytesConst(png, 1);
        case 2:
            return interlaceBytesConst(png, 2);
        case 3:
            return interlaceBytesConst(png, 3);
        case 4:
            return interlaceBytesConst(png, 4);
        case 6:
            return interlaceBytesConst(png, 6);
        case 8:
            return interlaceBytesConst(png, 8);
        default:
            throw new Error('unreachable interlacing bpp');
    }
}
function interlaceBytesConst(png, BPP) {
    const passes = [
        [],
        [],
        [],
        [],
        [],
        [],
        []
    ];
    let y = 0;
    for (const line of png.scanLines(false)){
        const data = line.data;
        const nPixels = Math.floor(data.length / BPP);
        for(let x = 0; x < nPixels; x++){
            const ym = 7 & y;
            const xm = 7 & x;
            let target;
            target = 0 === ym && 0 === xm ? passes[0] : 0 === ym && 4 === xm ? passes[1] : 4 === ym && (0 === xm || 4 === xm) ? passes[2] : (0 === ym || 4 === ym) && (2 === xm || 6 === xm) ? passes[3] : (2 === ym || 6 === ym) && (1 & x) === 0 ? passes[4] : (1 & y) === 0 ? passes[5] : passes[6];
            const base = x * BPP;
            for(let k = 0; k < BPP; k++)target.push(data[base + k]);
        }
        y++;
    }
    let total = 0;
    for (const p of passes)total += p.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const pass of passes){
        out.set(pass, p);
        p += pass.length;
    }
    return out;
}
function deinterlaceBytes(png) {
    const bpp = ihdrBpp(png.ihdr) / 8;
    switch(bpp){
        case 1:
            return deinterlaceBytesConst(png, 1);
        case 2:
            return deinterlaceBytesConst(png, 2);
        case 3:
            return deinterlaceBytesConst(png, 3);
        case 4:
            return deinterlaceBytesConst(png, 4);
        case 6:
            return deinterlaceBytesConst(png, 6);
        case 8:
            return deinterlaceBytesConst(png, 8);
        default:
            throw new Error('unreachable interlacing bpp');
    }
}
function deinterlaceBytesConst(png, BPP) {
    const height = png.ihdr.height;
    const width = png.ihdr.width;
    const bytesPerLine = BPP * width;
    const data = new Uint8Array(bytesPerLine * height);
    let currentPass = 1;
    let constants = interlacedConstants(currentPass);
    let currentY = constants.yShift;
    for (const line of png.scanLines(false)){
        const lineData = line.data;
        const nPixels = Math.floor(lineData.length / BPP);
        for(let i = 0; i < nPixels; i++){
            const currentX = constants.xShift + i * constants.xStep;
            const index = currentY * bytesPerLine + currentX * BPP;
            const base = i * BPP;
            for(let k = 0; k < BPP; k++)data[index + k] = lineData[base + k];
        }
        currentY += constants.yStep;
        if (currentY >= height) {
            if (7 === currentPass) break;
            currentPass += 1;
            if (2 === currentPass && width <= 4) currentPass += 1;
            if (3 === currentPass && height <= 4) currentPass += 1;
            if (4 === currentPass && width <= 2) currentPass += 1;
            if (5 === currentPass && height <= 2) currentPass += 1;
            if (6 === currentPass && 1 === width) currentPass += 1;
            if (7 === currentPass && 1 === height) break;
            constants = interlacedConstants(currentPass);
            currentY = constants.yShift;
        }
    }
    return data;
}
function interlacedConstants(pass) {
    switch(pass){
        case 1:
            return {
                xShift: 0,
                yShift: 0,
                xStep: 8,
                yStep: 8
            };
        case 2:
            return {
                xShift: 4,
                yShift: 0,
                xStep: 8,
                yStep: 8
            };
        case 3:
            return {
                xShift: 0,
                yShift: 4,
                xStep: 4,
                yStep: 8
            };
        case 4:
            return {
                xShift: 2,
                yShift: 0,
                xStep: 4,
                yStep: 4
            };
        case 5:
            return {
                xShift: 0,
                yShift: 2,
                xStep: 2,
                yStep: 4
            };
        case 6:
            return {
                xShift: 1,
                yShift: 0,
                xStep: 2,
                yStep: 2
            };
        case 7:
            return {
                xShift: 0,
                yShift: 1,
                xStep: 1,
                yStep: 2
            };
        default:
            throw new Error('unreachable interlacing pass');
    }
}
const palette_BLACK = rgba8(0, 0, 0, 255);
function reducedPalette(png, optimizeAlpha) {
    if (png.ihdr.bitDepth !== BitDepth.Eight) return null;
    const ct = png.ihdr.colorType;
    if ('indexed' !== ct.kind) return null;
    const palette = ct.palette;
    const used = new Uint8Array(256);
    for(let i = 0; i < png.data.length; i++)used[png.data[i]] = 1;
    const condensed = new NumberIndexSet();
    const byteMap = new Uint8Array(256);
    let didChange = false;
    for(let i = 0; i < 256; i++){
        if (!used[i]) continue;
        let color = palette[i] ?? palette_BLACK;
        if (optimizeAlpha && 0 === rgba8A(color)) color = rgba8(0, 0, 0, 0);
        const [idx] = condensed.insertFull(color);
        byteMap[i] = idx;
        if (idx !== i) didChange = true;
    }
    let data;
    if (didChange) {
        data = new Uint8Array(png.data.length);
        for(let i = 0; i < png.data.length; i++)data[i] = byteMap[png.data[i]];
    } else {
        if (condensed.size === palette.length) return null;
        data = png.data.slice();
    }
    return new PngImage({
        ...png.ihdr,
        colorType: {
            kind: 'indexed',
            palette: condensed.toArray()
        }
    }, data);
}
function sortedPalette(png) {
    if (png.ihdr.bitDepth !== BitDepth.Eight) return null;
    const ct = png.ihdr.colorType;
    if ('indexed' !== ct.kind || ct.palette.length <= 1) return null;
    const palette = ct.palette;
    const enumerated = palette.map((c, i)=>[
            i,
            c
        ]);
    const keepFirst = mostPopularEdgeColor(palette.length, png);
    const first = null === keepFirst ? null : enumerated.splice(keepFirst, 1)[0];
    enumerated.sort((a, b)=>colorValue(a[1]) - colorValue(b[1]));
    if (first) enumerated.unshift(first);
    const remapping = enumerated.map((e)=>e[0]);
    const newPalette = enumerated.map((e)=>e[1]);
    if (remapping.every((v, i)=>v === i)) return null;
    const byteMap = new Uint8Array(256);
    for(let i = 0; i < remapping.length; i++)byteMap[remapping[i]] = i;
    const data = new Uint8Array(png.data.length);
    for(let i = 0; i < png.data.length; i++)data[i] = byteMap[png.data[i]];
    return new PngImage({
        ...png.ihdr,
        colorType: {
            kind: 'indexed',
            palette: newPalette
        }
    }, data);
}
function sortedPaletteEzeng(png, matrix, maxSwapDist) {
    const remapping = ezengReindex(matrix);
    pairwiseSwapSearch(remapping, matrix, maxSwapDist);
    applyMostPopularColor(remapping, matrix, Math.floor(3 * png.data.length / 20));
    return applyPaletteReorder(png, remapping);
}
function sortedPaletteBattiato(png, matrix) {
    const remapping = battiatoReindex(matrix);
    applyMostPopularColor(remapping, matrix, 0);
    return applyPaletteReorder(png, remapping);
}
function applyPaletteReorder(png, remapping) {
    const ct = png.ihdr.colorType;
    if ('indexed' !== ct.kind) return null;
    const palette = ct.palette;
    if (remapping.every((v, i)=>v === i)) return null;
    const newPalette = [];
    const byteMap = new Uint8Array(256);
    for(let i = 0; i < remapping.length; i++){
        const v = remapping[i];
        newPalette.push(palette[v]);
        byteMap[v] = i;
    }
    const data = new Uint8Array(png.data.length);
    for(let i = 0; i < png.data.length; i++)data[i] = byteMap[png.data[i]];
    return new PngImage({
        ...png.ihdr,
        colorType: {
            kind: 'indexed',
            palette: newPalette
        }
    }, data);
}
function colorValue(color) {
    const a = rgba8A(color);
    return ((0xfe & a) << 18) + (0x01 & a) - 299 * rgba8R(color) - 587 * rgba8G(color) - 114 * rgba8B(color);
}
function mostPopularEdgeColor(numColors, png) {
    const counts = new Uint32Array(256);
    for (const line of png.scanLines(false)){
        const data = line.data;
        if (data.length >= 1) {
            counts[data[0]] += 1;
            counts[data[data.length - 1]] += 1;
        }
    }
    let bestIndex = 0;
    let bestCount = -1;
    for(let i = 0; i < numColors; i++)if (counts[i] > bestCount) {
        bestCount = counts[i];
        bestIndex = i;
    }
    let maxEqual = 0;
    for(let i = 0; i < 256; i++)if (counts[i] === bestCount) maxEqual++;
    if (maxEqual > 1) return null;
    return bestIndex;
}
function applyMostPopularColor(remapping, matrix, min) {
    const [mostPopular, count] = matrix.mostPopularColor();
    if (count < min) return;
    const firstIdx = remapping.indexOf(mostPopular);
    if (-1 === firstIdx) return;
    if (firstIdx >= Math.floor(remapping.length / 2)) {
        remapping.reverse();
        rotateRight(remapping, firstIdx + 1);
    } else rotateLeft(remapping, firstIdx);
}
function rotateLeft(arr, n) {
    const k = (n % arr.length + arr.length) % arr.length;
    if (0 === k) return;
    const head = arr.splice(0, k);
    arr.push(...head);
}
function rotateRight(arr, n) {
    const k = (n % arr.length + arr.length) % arr.length;
    if (0 === k) return;
    const tail = arr.splice(arr.length - k, k);
    arr.unshift(...tail);
}
function ezengReindex(matrix) {
    const edges = matrix.weightedEdges;
    const remapping = [
        edges[0][0],
        edges[0][1]
    ];
    const sums = [];
    let bestSumPos = 0;
    let bestSum = [
        0,
        0
    ];
    for(let i = 0; i < matrix.numColors; i++){
        const mRow = matrix.row(i);
        if (i === remapping[0] || i === remapping[1]) continue;
        const sum = [
            i,
            mRow[remapping[0]] + mRow[remapping[1]]
        ];
        if (sum[1] > bestSum[1]) {
            bestSumPos = sums.length;
            bestSum = sum;
        }
        sums.push(sum);
    }
    while(sums.length > 0){
        const bestIndex = bestSum[0];
        const m = remapping.length;
        let bestPos = 0;
        let bestCost = Number.MAX_SAFE_INTEGER;
        let crossCost = 0;
        const bestRow = matrix.row(bestIndex);
        for(let p = 0; p <= m; p++){
            let newCost = 0;
            for(let k = 0; k < m; k++){
                const dist = k < p ? p - k : k + 1 - p;
                newCost += bestRow[remapping[k]] * dist;
            }
            const total = newCost + crossCost;
            if (total < bestCost) {
                bestCost = total;
                bestPos = p;
            }
            if (p < m) {
                const rowP = matrix.row(remapping[p]);
                for(let bi = p + 1; bi < m; bi++)crossCost += rowP[remapping[bi]];
                for(let ai = 0; ai < p; ai++)crossCost -= rowP[remapping[ai]];
            }
        }
        remapping.splice(bestPos, 0, bestIndex);
        sums[bestSumPos] = sums[sums.length - 1];
        sums.pop();
        if (sums.length > 0) {
            bestSumPos = 0;
            bestSum = [
                0,
                0
            ];
            for(let i = 0; i < sums.length; i++){
                const sum = sums[i];
                sum[1] += bestRow[sum[0]];
                if (sum[1] > bestSum[1]) {
                    bestSumPos = i;
                    bestSum = sum;
                }
            }
        }
    }
    return remapping;
}
function battiatoReindex(matrix) {
    const chains = [];
    const vx = Array.from({
        length: matrix.numColors
    }, ()=>[
            0,
            0
        ]);
    for (const [ei, ej] of matrix.weightedEdges){
        const i = ei;
        const j = ej;
        const vi = vx[i];
        const vj = vx[j];
        if (0 === vi[0] && 0 === vj[0]) {
            vi[0] = 1;
            vi[1] = chains.length;
            vj[0] = 1;
            vj[1] = chains.length;
            chains.push([
                i,
                j
            ]);
        } else if (0 === vi[0] && 1 === vj[0]) {
            vi[0] = 1;
            vi[1] = vj[1];
            vj[0] = 2;
            const chain = chains[vj[1]];
            if (chain[0] === j) chain.unshift(i);
            else chain.push(i);
        } else if (1 === vi[0] && 0 === vj[0]) {
            vj[0] = 1;
            vj[1] = vi[1];
            vi[0] = 2;
            const chain = chains[vi[1]];
            if (chain[0] === i) chain.unshift(j);
            else chain.push(j);
        } else if (1 === vi[0] && 1 === vj[0] && vi[1] !== vj[1]) {
            vi[0] = 2;
            vj[0] = 2;
            const a = vi[1] < vj[1] ? i : j;
            const b = vi[1] < vj[1] ? j : i;
            const ca = vx[a][1];
            const cb = vx[b][1];
            const chainb = chains[cb];
            chains[cb] = [];
            for (const v of chainb)vx[v][1] = ca;
            const chaina = chains[ca];
            if (chaina[0] === a && chainb[0] === b) for (const v of chainb)chaina.unshift(v);
            else if (chaina[0] === a) chaina.splice(0, 0, ...chainb);
            else if (chainb[0] === b) chaina.push(...chainb);
            else {
                const pos = chaina.length;
                for (const v of chainb)chaina.splice(pos, 0, v);
            }
        }
        if (chains[0].length === matrix.numColors) break;
    }
    const result = [];
    for (const chain of chains)for (const v of chain)result.push(v);
    for(let i = 0; i < vx.length; i++)if (0 === vx[i][0]) result.push(i);
    return result;
}
function pairwiseSwapSearch(remapping, matrix, maxDist) {
    const numColors = remapping.length;
    const bLimit = maxDist + 1;
    let swaps = 2;
    while(swaps >= 2){
        swaps = 0;
        for(let a = 0; a < numColors - 1; a++){
            const end = Math.min(a + bLimit, numColors);
            for(let b = a + 1; b < end; b++){
                const va = remapping[a];
                const vb = remapping[b];
                const rowA = matrix.row(va);
                const rowB = matrix.row(vb);
                let delta = 0;
                const dist = b - a;
                for(let i = 0; i < a; i++)delta += (rowA[remapping[i]] - rowB[remapping[i]]) * dist;
                for(let i = a + 1; i < b; i++)delta += (rowA[remapping[i]] - rowB[remapping[i]]) * (a + b - 2 * i);
                for(let i = b + 1; i < numColors; i++)delta -= (rowA[remapping[i]] - rowB[remapping[i]]) * dist;
                if (delta < 0) {
                    const tmp = remapping[a];
                    remapping[a] = remapping[b];
                    remapping[b] = tmp;
                    swaps++;
                }
            }
        }
    }
}
class CoOccurrenceMatrix {
    numColors;
    data;
    weightedEdges;
    constructor(numColors, data, weightedEdges){
        this.numColors = numColors;
        this.data = data;
        this.weightedEdges = weightedEdges;
    }
    static from(png) {
        if (png.ihdr.bitDepth !== BitDepth.Eight) return null;
        const ct = png.ihdr.colorType;
        if ('indexed' !== ct.kind || ct.palette.length <= 2) return null;
        const numColors = ct.palette.length;
        const data = CoOccurrenceMatrix.build(numColors, png);
        const weightedEdges = CoOccurrenceMatrix.buildWeightedEdges(numColors, data);
        return new CoOccurrenceMatrix(numColors, data, weightedEdges);
    }
    static build(numColors, png) {
        const data = new Uint32Array(numColors * numColors);
        let prev = null;
        for (const line of png.scanLines(false)){
            const lineData = line.data;
            let prevVal = -1;
            for(let i = 0; i < lineData.length; i++){
                const val = lineData[i];
                if (-1 !== prevVal) data[prevVal * numColors + val] += 1;
                if (null !== prev && i < prev.length) data[prev[i] * numColors + val] += 1;
                prevVal = val;
            }
            prev = lineData;
        }
        for(let i = 0; i < numColors; i++){
            const rowStart = i * numColors;
            for(let j = 0; j <= i; j++){
                const opposite = j * numColors + i;
                data[rowStart + j] += data[opposite];
                data[opposite] = data[rowStart + j];
            }
        }
        return data;
    }
    static buildWeightedEdges(numColors, data) {
        const edges = [];
        for(let i = 0; i < numColors; i++){
            const rowStart = i * numColors;
            for(let j = 0; j < i; j++){
                const val = data[rowStart + j];
                if (val > 0) edges.push([
                    j,
                    i,
                    val
                ]);
            }
        }
        edges.sort((a, b)=>b[2] - a[2]);
        return edges;
    }
    row(row) {
        const start = row * this.numColors;
        return this.data.subarray(start, start + this.numColors);
    }
    mostPopularColor() {
        let best = [
            0,
            0
        ];
        for(let i = 0; i < this.numColors; i++){
            const r = this.row(i);
            let sum = 0;
            for(let k = 0; k < r.length; k++)sum += r[k];
            if (sum > best[1]) best = [
                i,
                sum
            ];
        }
        best[1] = Math.floor(best[1] / 4);
        return best;
    }
}
function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for(let i = 0; i < a.length; i++)if (a[i] !== b[i]) return false;
    return true;
}
function performReductions(pngIn, opts, deadline, eval_) {
    let png = pngIn;
    let evaluationAdded = false;
    const effort = (()=>{
        if ('libdeflater' !== opts.deflater.kind) return 4;
        const c = opts.deflater.compression;
        if (c <= 9) return 0;
        if (10 === c) return 1;
        if (11 === c) return opts.filters.length <= 4 ? 2 : 3;
        return 4;
    })();
    if (opts.optimizeAlpha) {
        const reduced = cleanedAlphaChannel(png);
        if (reduced) png = reduced;
    }
    if (opts.bitDepthReduction) {
        const reduced = reducedBitDepth16To8(png, opts.scale16);
        if (reduced) png = reduced;
    }
    if (opts.colorTypeReduction && opts.grayscaleReduction) {
        const reduced = reducedRgbToGrayscale(png);
        if (reduced) png = reduced;
    }
    if (opts.bitDepthReduction) {
        const reduced = expandedBitDepthTo8(png);
        if (reduced) png = reduced;
    }
    if (null !== opts.interlace) {
        const reduced = changedInterlacing(png, opts.interlace);
        if (reduced) png = reduced;
    }
    let baseline = png;
    if (opts.paletteReduction && !deadline.passed()) {
        const reduced = reducedPalette(png, opts.optimizeAlpha);
        if (reduced) {
            png = reduced;
            if (bytesEqual(png.data, baseline.data)) baseline = png;
        }
        const sorted = sortedPalette(png);
        if (sorted) png = sorted;
        if (png !== baseline) {
            eval_.tryImageWithDescription(png, 'Indexed (luma sort)');
            evaluationAdded = true;
        }
    }
    if (opts.colorTypeReduction && !deadline.passed()) {
        const reduced = reducedAlphaChannel(png, opts.optimizeAlpha);
        if (reduced) {
            png = reduced;
            if (hasTrns(png.ihdr.colorType) && baseline.data.length - png.data.length <= 1000) {
                eval_.tryImage(png);
                evaluationAdded = true;
            } else baseline = png;
        }
    }
    if (effort >= 3 && opts.colorTypeReduction && !deadline.passed()) {
        const reduced = indexedToChannels(png, opts.grayscaleReduction, opts.optimizeAlpha);
        if (reduced) {
            eval_.tryImage(reduced);
            evaluationAdded = true;
        }
    }
    let indexed = null;
    if (opts.colorTypeReduction && opts.paletteReduction && !deadline.passed()) {
        const reduced = reducedToIndexed(png, opts.grayscaleReduction);
        if (reduced) {
            const sorted = sortedPalette(reduced);
            const next = sorted ?? reduced;
            if (png.data.length - next.data.length <= 20000) {
                eval_.tryImageWithDescription(next, 'Indexed (luma sort)');
                evaluationAdded = true;
            } else baseline = next;
            indexed = next;
        }
    }
    if (effort >= 2 && opts.paletteReduction && !deadline.passed()) {
        const palettes = [
            baseline.ihdr.colorType
        ];
        const input = indexed ?? png;
        const matrix = CoOccurrenceMatrix.from(input);
        if (matrix) {
            const maxSwapDist = effort >= 3 ? 50 : 1;
            if (!deadline.passed()) {
                const reduced = sortedPaletteEzeng(input, matrix, maxSwapDist);
                if (reduced && !palettes.some((ct)=>colorTypeEquals(ct, reduced.ihdr.colorType))) {
                    palettes.push(reduced.ihdr.colorType);
                    eval_.tryImageWithDescription(reduced, 'Indexed (ezeng sort)');
                    evaluationAdded = true;
                }
            }
            if (effort >= 4 && !deadline.passed()) {
                const reduced = sortedPaletteBattiato(input, matrix);
                if (reduced && !palettes.some((ct)=>colorTypeEquals(ct, reduced.ihdr.colorType))) {
                    palettes.push(reduced.ihdr.colorType);
                    eval_.tryImageWithDescription(reduced, 'Indexed (battiato sort)');
                    evaluationAdded = true;
                }
            }
        }
    }
    if (opts.bitDepthReduction && !deadline.passed()) {
        const reduced = reducedBitDepth8OrLess(png);
        if ((effort >= 3 || null === reduced) && !deadline.passed()) {
            const indexedReduced = indexed ? reducedBitDepth8OrLess(indexed) : null;
            if (indexedReduced && (null === reduced || !bytesEqual(reduced.data, indexedReduced.data))) {
                eval_.tryImage(indexedReduced);
                evaluationAdded = true;
            }
        }
        if (reduced) {
            eval_.tryImage(reduced);
            evaluationAdded = true;
        }
    }
    if (evaluationAdded) eval_.tryImage(baseline);
    return baseline;
}
function isFullyOptimized(originalSize, optimizedSize, opts) {
    return originalSize <= optimizedSize && !opts.force;
}
function optimizeFromMemory(data, opts) {
    logInfo('Processing from memory');
    const deadline = new Deadline(opts.timeout, logWarn);
    const originalSize = data.length;
    const png = PngData.fromSlice(data, opts);
    const optimized = optimizePng(png, data, opts, deadline);
    if (isFullyOptimized(originalSize, optimized.length, opts)) {
        logInfo('Image already optimized');
        return data;
    }
    return optimized;
}
function optimizePng(png, originalData, optsIn, deadline) {
    const fileOriginalSize = originalData.length;
    const idatOriginalSize = png.idatData.length;
    const raw = png.raw;
    logDebug(`    ${raw.ihdr.width}x${raw.ihdr.height} pixels, PNG format`);
    logDebug(`    IDAT size = ${idatOriginalSize} bytes`);
    logDebug(`    File size = ${fileOriginalSize} bytes`);
    const opts = optsIn.clone();
    preprocessChunks(png.auxChunks, opts, logWarn);
    const maxSize = opts.force ? void 0 : raw.estimatedOutputSize(png.idatData);
    const result = optimizeRaw(raw, opts, deadline, maxSize);
    if (result) {
        png.raw = result.image;
        png.idatData = result.idatData;
        recompressFrames(png, opts, deadline, result.filter);
        postprocessChunks(png.auxChunks, png.raw.ihdr, raw.ihdr, logWarn);
    }
    const output = png.output();
    logTrace(`    Optimized file size = ${output.length} bytes`);
    return output;
}
function optimizeRaw(image, opts, deadline, maxSize) {
    const compression = 'libdeflater' === opts.deflater.kind && opts.deflater.compression < 11 ? Math.min(5, opts.deflater.compression) : opts.filters.length <= 4 ? 7 : 8;
    const evalDeflater = libdeflater(compression);
    const evalFilters = opts.filters.length <= 2 ? opts.filters : filterSetFrom([
        NONE,
        Bigrams
    ]);
    const eval_ = new Evaluator(deadline, evalFilters, evalDeflater, false, false, (msg)=>logTrace(msg));
    let newImage = performReductions(image, opts, deadline, eval_);
    const evalResult = eval_.getBestCandidate();
    if (evalResult) newImage = evalResult.image;
    const cheapEvaluation = opts.fastEvaluation && null === evalResult && 'libdeflater' === opts.deflater.kind && 11 === opts.deflater.compression && 4 === opts.filters.length && 8 === image.ihdr.bitDepth && !image.ihdr.interlaced && 8 === newImage.ihdr.bitDepth && ('rgb' === newImage.ihdr.colorType.kind || 'rgba' === newImage.ihdr.colorType.kind) && newImage.data.length >= 65536 && void 0 !== maxSize && 8 * maxSize >= newImage.data.length;
    const trialDeflater = cheapEvaluation ? libdeflater(2) : evalDeflater;
    const reductionOccurred = !colorTypeEquals(newImage.ihdr.colorType, image.ihdr.colorType) || newImage.ihdr.bitDepth !== image.ihdr.bitDepth || newImage.ihdr.interlaced !== image.ihdr.interlaced;
    if (reductionOccurred) logDebug(`Transformed image to ${image.ihdr.bitDepth}-bit ${colorTypeToString(newImage.ihdr.colorType)}`);
    let result;
    let deflater;
    if (opts.idatRecoding || reductionOccurred) {
        result = performTrials(newImage, opts, deadline, maxSize, evalResult, evalFilters, trialDeflater);
        if (null === result) return null;
        deflater = opts.deflater;
    } else {
        result = evalResult;
        if (null === result) return null;
        deflater = evalDeflater;
    }
    if (null !== result.idatData && (void 0 === maxSize || result.estimatedOutputSize < maxSize)) {
        logDebug('Found better result:');
        logDebug(`    ${deflaterLabel(deflater)}, f = ${result.filter}`);
        return result;
    }
    return null;
}
function deflaterLabel(d) {
    return 'libdeflater' === d.kind ? `zc = ${d.compression}` : `zopfli, zi = ${d.options.iterationCount}`;
}
function performTrials(image, opts, deadline, maxSize, evalResultIn, evalFilters, evalDeflater) {
    let evalResult = evalResultIn;
    let filters = opts.filters;
    const fastEval = opts.fastEvaluation && (filters.length > 1 || null !== evalResult);
    if (fastEval) {
        if (null !== evalResult) filters = filterSetDifference(filters, evalFilters);
        if (filters.length > 0) {
            logTrace(`Evaluating ${filters.length} filters`);
            const eval_ = new Evaluator(deadline, filters, evalDeflater, opts.optimizeAlpha, deflaterEquals(opts.deflater, evalDeflater), (msg)=>logTrace(msg));
            if (evalResult) eval_.setBestSize(evalResult.estimatedOutputSize);
            eval_.tryImage(image);
            const r = eval_.getBestCandidate();
            if (r) evalResult = r;
        }
        const result = evalResult;
        if (null === result) return null;
        if (null === result.idatData) {
            logDebug(`Trying filter ${result.filter} with ${deflaterLabel(opts.deflater)}`);
            const canReuse = void 0 !== result.filteredData && (result.filteredOptimizeAlpha === opts.optimizeAlpha || !hasAlpha(result.image.ihdr.colorType));
            const data = canReuse ? result.filteredData : result.image.filterImage(result.filterUsed, opts.optimizeAlpha)[0];
            result.filteredData = void 0;
            try {
                const idatData = deflaterDeflate(opts.deflater, data, void 0 === maxSize ? void 0 : maxSize - result.image.keyChunksSize());
                result.estimatedOutputSize = result.image.estimatedOutputSize(idatData);
                result.idatData = idatData;
            } catch (err) {
                if (err instanceof PngError && 'DeflatedDataTooLong' === err.kind) logTrace(`>${err.size} bytes`);
            }
        }
        return result;
    }
    logDebug(`Trying ${filters.length} filters with ${deflaterLabel(opts.deflater)}`);
    const eval_ = new Evaluator(deadline, filters, opts.deflater, opts.optimizeAlpha, true, (msg)=>logTrace(msg));
    if (void 0 !== maxSize) eval_.setBestSize(maxSize);
    eval_.tryImage(image);
    return eval_.getBestCandidate();
}
function recompressFrames(png, opts, deadline, filter) {
    if (!opts.idatRecoding || 0 === png.frames.length) return;
    for(let i = 0; i < png.frames.length; i++){
        if (deadline.passed()) return;
        const frame = png.frames[i];
        const ihdr = {
            ...png.raw.ihdr,
            width: frame.width,
            height: frame.height
        };
        const image = PngImage["new"](ihdr, frame.data);
        const [filtered] = image.filterImage(filter, opts.optimizeAlpha);
        const maxSize = frame.data.length - 1;
        try {
            const data = deflaterDeflate(opts.deflater, filtered, maxSize);
            logDebug(`Recompressed fdAT #${i}: ${data.length} (${frame.data.length - data.length} bytes decrease)`);
            frame.data = data;
        } catch  {}
    }
}
class RawImage {
    png;
    auxChunks;
    constructor(width, height, colorType, bitDepth, data){
        const validDepth = 'grayscale' === colorType.kind ? true : 'indexed' === colorType.kind ? bitDepth <= 8 : bitDepth >= 8;
        if (!validDepth) throw PngError.invalidDepthForType(bitDepth, colorType);
        const bpp = bitDepth * channelsPerPixel(colorType);
        const rowBytes = Math.ceil(bpp * width / 8);
        const expectedLen = rowBytes * height;
        if (data.length !== expectedLen) throw PngError.incorrectDataLength(data.length, expectedLen);
        this.png = new PngImage({
            width,
            height,
            colorType,
            bitDepth,
            interlaced: false
        }, data);
        this.auxChunks = [];
    }
    addPngChunk(name, data) {
        this.auxChunks.push({
            name,
            data
        });
    }
    addIccProfile(data) {
        try {
            const iccp = makeIccp(data, libdeflater(1), void 0);
            this.auxChunks.push(iccp);
        } catch  {}
    }
    createOptimizedPng(optsIn) {
        const opts = optsIn.clone();
        const auxChunks = this.auxChunks.filter((c)=>stripKeep(opts.strip, c.name)).map((c)=>({
                name: c.name,
                data: c.data
            }));
        preprocessChunks(auxChunks, opts, logWarn);
        const deadline = new Deadline(opts.timeout, logWarn);
        const result = optimizeRaw(this.png, opts, deadline, void 0);
        if (!result) throw PngError.other('Failed to optimize input data');
        const png = new PngData(result.image, result.idatData, auxChunks, []);
        postprocessChunks(png.auxChunks, png.raw.ihdr, this.png.ihdr, logWarn);
        return png.output();
    }
}
async function oxipng(image, options) {
    return oxipngSync(image, options);
}
function oxipngSync(image, options) {
    const data = toUint8Array(image);
    const opts = options ?? new Options();
    return optimizeFromMemory(data, opts);
}
function toUint8Array(image) {
    if (image instanceof Uint8Array) return image;
    if (image instanceof ArrayBuffer) return new Uint8Array(image);
    return new Uint8Array(image.buffer, image.byteOffset, image.byteLength);
}
export { AVERAGE, AtomicMin, BigEnt, Bigrams, BitDepth, Brute, CoOccurrenceMatrix, DISPLAY_CHUNKS, Deadline, Entropy, Evaluator, Frame, GRAYSCALE_ALPHA, INDEXED_MAX_DIFF, LogLevel, MinSum, NONE, Options, PAETH, PngData, PngError, PngImage, Predefined, RGBA, ROW_FILTER_ALL, ROW_FILTER_NAMES, RawImage, RowFilter, SUB, ScanLineRanges, ScanLines, UP, basic, changedInterlacing, channelsPerPixel, cleanedAlphaChannel, colorTypeEquals, colorTypeToString, colors_indexed as indexed, colors_isGray as isGray, deflate, deflate_deflateRaw as deflateRaw, deflaterDeflate, deflaterEquals, deflaterToString, expandedBitDepthTo8, extractIcc, fileHeaderIsValid, filterLine, filterStrategyCompare, filterStrategyEquals, filterStrategyKey, filterStrategyToString, getLogLevel, grayscale, hasAlpha, hasTrns, indexedToChannels, inflate, isFullyOptimized, isRgb, libdeflater, logDebug, logError, logInfo, logTrace, logWarn, makeIccp, nameBytes, now, optimizeFromMemory, optimizePng, optimizeRaw, oxipng, oxipngSync, paethPredictor, parseIhdrChunk, parseNextChunk, performReductions, performTrials, pngHeaderCode, postprocessChunks, preprocessChunks, rawDataSize, recompressFrames, reducedAlphaChannel, reducedBitDepth16To8, reducedBitDepth8OrLess, reducedBitDepthForced, reducedPalette, reducedRgbToGrayscale, reducedToIndexed, rgb, rgba8, rgba8A, rgba8B, rgba8G, rgba8R, rowFilterFromNumber, rowFilterName, scaledBitDepth16To8, setLogLevel, setLogSink, sortedPalette, sortedPaletteBattiato, sortedPaletteEzeng, srgbRenderingIntent, strategyEvaluator, stripKeep, unfilterLine, writePngBlock, zopfli };
