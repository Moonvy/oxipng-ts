import { describe, expect, it } from 'vitest';
import { BitWriter, SizeLimitExceeded } from '../src/deflate/bitwriter.ts';
import { optimalLengths } from '../src/deflate/huffman.ts';

// Independent Huffman oracle: sorted queue and explicit tree traversal.
// Ordering equal weights by creation ID preserves the encoder's tie choices.
function referenceLengths(freq: Uint32Array, add: number): Uint8Array {
  interface Node { id: number; weight: number; symbol?: number; children?: Node[] }
  const queue: Node[] = [];
  for (let symbol = 0; symbol < freq.length; symbol++) {
    if (freq[symbol] > 0) queue.push({ id: queue.length, weight: freq[symbol] + add, symbol });
  }
  const lengths = new Uint8Array(freq.length);
  if (queue.length === 0) return lengths;
  if (queue.length === 1) {
    lengths[queue[0].symbol!] = 1;
    return lengths;
  }
  let next = queue.length;
  while (queue.length > 1) {
    queue.sort((a, b) => a.weight - b.weight || a.id - b.id);
    const a = queue.shift()!;
    const b = queue.shift()!;
    queue.push({ id: next++, weight: a.weight + b.weight, children: [a, b] });
  }
  function visit(node: Node, depth: number): void {
    if (node.symbol !== undefined) lengths[node.symbol] = depth;
    else for (const child of node.children!) visit(child, depth + 1);
  }
  visit(queue[0], 0);
  return lengths;
}

describe('Huffman construction ordering', () => {
  it('matches an independent sorted queue for ties, sparse symbols and added weights', () => {
    let state = 791329;
    const random = () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return state >>> 0;
    };
    for (let trial = 0; trial < 180; trial++) {
      const freq = new Uint32Array([19, 30, 286][trial % 3]);
      for (let i = 0; i < freq.length; i++) {
        freq[i] = trial % 3 === 0 ? random() % 4 : trial % 3 === 1 ? random() % 65536 : random();
      }
      for (const add of [0, 1, 17, 10000]) {
        expect(optimalLengths(freq, add)).toEqual(referenceLengths(freq, add));
      }
    }
  });

  it('handles empty and single-symbol trees after reusing scratch', () => {
    optimalLengths(new Uint32Array(286).fill(1), 0);
    expect(optimalLengths(new Uint32Array(19), 0)).toEqual(new Uint8Array(19));
    const single = new Uint32Array(30);
    single[29] = 12;
    const lengths = new Uint8Array(30);
    lengths[29] = 1;
    expect(optimalLengths(single, 100)).toEqual(lengths);
  });
});

function packBits(writes: Array<[number, number]>): Uint8Array {
  const bytes: number[] = [];
  let byte = 0;
  let pending = 0;
  for (const [value, count] of writes) {
    for (let i = 0; i < count; i++) {
      byte |= ((value >>> i) & 1) << pending;
      if (++pending === 8) {
        bytes.push(byte);
        byte = 0;
        pending = 0;
      }
    }
  }
  if (pending > 0) bytes.push(byte);
  return new Uint8Array(bytes);
}

describe('integer bit accumulator', () => {
  it('preserves every pending-bit/count combination including 33–35-bit writes', () => {
    for (let pending = 0; pending < 8; pending++) {
      for (let count = 0; count <= 28; count++) {
        for (const value of [0, 2 ** count - 1, Math.floor((2 ** count - 1) / 3)]) {
          const writes: Array<[number, number]> = [[2 ** pending - 1, pending], [value, count], [123, 7]];
          const writer = new BitWriter(1);
          for (const [bits, size] of writes) writer.writeBits(bits, size);
          expect(writer.finish()).toEqual(packBits(writes));
        }
      }
    }
  });

  it('packs mixed writes independently across output growth', () => {
    const writes: Array<[number, number]> = [];
    let state = 971231;
    const random = () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return state >>> 0;
    };
    const writer = new BitWriter(1);
    for (let i = 0; i < 10000; i++) {
      const count = random() % 29;
      const value = random() & (2 ** count - 1);
      writes.push([value, count]);
      writer.writeBits(value, count);
    }
    expect(writer.finish()).toEqual(packBits(writes));
  });

  it('preserves alignment for raw bytes and header reservations', () => {
    const writer = new BitWriter(1);
    writer.skip(2);
    writer.writeBits(5, 3);
    writer.pushBytes(new Uint8Array([19, 255]));
    writer.writeBits(31, 5);
    expect(writer.finish()).toEqual(new Uint8Array([0, 0, 5, 19, 255, 31]));
  });

  it('enforces limits before changing the pending bits', () => {
    const writer = new BitWriter(1, 2);
    writer.writeBits(5, 3);
    expect(() => writer.writeBits(0xfffffff, 28)).toThrow(SizeLimitExceeded);
    writer.writeBits(3, 2);
    expect(writer.finish()).toEqual(new Uint8Array([29]));
    const exact = new BitWriter(1, 1);
    exact.writeBits(255, 8);
    expect(() => exact.writeBits(0, 8)).toThrow(SizeLimitExceeded);
    expect(exact.finish()).toEqual(new Uint8Array([255]));
  });
});
