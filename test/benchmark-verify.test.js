import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { assertPngEqual, decodePng } from '../benchmark/verify.mjs';
import { Options, oxipngSync } from '../src/index.js';

describe('independent benchmark verification', () => {
  it('detects a change to a low bit that ordinary 8-bit decoding hides', () => {
    const make = value => PNG.sync.write({ width: 1, height: 1, data: new Uint16Array([value, 0, 0, 65535]) },
      { bitDepth: 16, colorType: 6, inputColorType: 6, inputHasAlpha: true });
    const before = make(0x1234), after = make(0x1235);
    expect(PNG.sync.read(before).data).toEqual(PNG.sync.read(after).data);
    expect(() => assertPngEqual(decodePng(before), decodePng(after))).toThrow('pixels changed');
  });

  it('checks every APNG frame, including timing, disposal and blending', () => {
    const input = readFileSync(new URL('./files/apng_file.png', import.meta.url));
    const original = decodePng(input);
    expect(original.frames.length).toBeGreaterThan(1);
    for (const preset of [2, 4]) {
      const optimized = decodePng(oxipngSync(input, Options.fromPreset(preset)));
      expect(() => assertPngEqual(original, optimized)).not.toThrow();
    }
    const changed = decodePng(input);
    changed.frames[1].image.rgba[0] ^= 1;
    expect(() => assertPngEqual(original, changed)).toThrow('frame 1 changed');
    const changedControl = decodePng(input);
    changedControl.frames[1].control[16] ^= 1;
    expect(() => assertPngEqual(original, changedControl)).toThrow('frame 1 changed');
  });
});
