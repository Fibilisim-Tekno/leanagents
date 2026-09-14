/** Split items into consecutive groups. Size must be a positive integer. */
export function batch<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError('size must be positive');
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size - 1));
  }
  return result;
}
