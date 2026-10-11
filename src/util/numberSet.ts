/** An insertion-ordered set of numbers, tracking each element's index. */
export class NumberIndexSet {
  private map = new Map<number, number>();
  private values: number[] = [];

  /** Insert `value`, returning `[index, inserted]`. */
  insertFull(value: number): [number, boolean] {
    const existing = this.map.get(value);
    if (existing !== undefined) return [existing, false];
    const index = this.values.length;
    this.map.set(value, index);
    this.values.push(value);
    return [index, true];
  }

  get size(): number {
    return this.values.length;
  }

  toArray(): number[] {
    return this.values;
  }
}
