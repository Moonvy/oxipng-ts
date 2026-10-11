import { filterStrategyKey, type FilterStrategy } from '../filters/strategies.ts';

/** Insertion-ordered, de-duplicated collection of filter strategies. */
export function filterSetFrom(items: Iterable<FilterStrategy>): FilterStrategy[] {
  const out: FilterStrategy[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = filterStrategyKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/** Remove the items of `b` from `a`, preserving order. */
export function filterSetDifference(a: FilterStrategy[], b: FilterStrategy[]): FilterStrategy[] {
  const keys = new Set(b.map(filterStrategyKey));
  return a.filter((f) => !keys.has(filterStrategyKey(f)));
}
