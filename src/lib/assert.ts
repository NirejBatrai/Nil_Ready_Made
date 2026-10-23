/** Narrow a possibly-undefined value, throwing a clear error if it is missing. */
export function must<T>(value: T | undefined | null, what = "value"): T {
  if (value === undefined || value === null) throw new Error(`Missing ${what}`);
  return value;
}

/** Index into an array that must contain that element. */
export const nth = <T>(arr: readonly T[], i: number): T => must(arr[i], `item ${i}`);
