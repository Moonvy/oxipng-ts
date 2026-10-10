import { PngError } from './error.js';
import { readBeU16, readBeU32, writeBeU16, writeBeU32 } from './util/bytes.js';

/** Animated PNG frame. */
export class Frame {
  width: number;
  height: number;
  xOffset: number;
  yOffset: number;
  delayNum: number;
  delayDen: number;
  disposeOp: number;
  blendOp: number;
  data: Uint8Array;

  constructor(init: {
    width: number;
    height: number;
    xOffset: number;
    yOffset: number;
    delayNum: number;
    delayDen: number;
    disposeOp: number;
    blendOp: number;
    data?: Uint8Array;
  }) {
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

  /** Construct a new Frame from the data in a fcTL chunk. */
  static fromFctlData(byteData: Uint8Array): Frame {
    if (byteData.length < 26) throw PngError.truncatedData();
    return new Frame({
      width: readBeU32(byteData, 4),
      height: readBeU32(byteData, 8),
      xOffset: readBeU32(byteData, 12),
      yOffset: readBeU32(byteData, 16),
      delayNum: readBeU16(byteData, 20),
      delayDen: readBeU16(byteData, 22),
      disposeOp: byteData[24],
      blendOp: byteData[25],
    });
  }

  /** Construct the data for a fcTL chunk using the given sequence number. */
  fctlData(sequenceNumber: number): Uint8Array {
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

  /** Construct the data for a fdAT chunk using the given sequence number. */
  fdatData(sequenceNumber: number): Uint8Array {
    const byteData = new Uint8Array(4 + this.data.length);
    writeBeU32(sequenceNumber >>> 0, byteData, 0);
    byteData.set(this.data, 4);
    return byteData;
  }
}
