import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batch } from './batch.ts';

test('preserves all items including an incomplete last batch', () => {
  assert.deepEqual(batch([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
test('size one, empty input, and a size larger than input', () => {
  assert.deepEqual(batch(['a', 'b'], 1), [['a'], ['b']]);
  assert.deepEqual(batch([], 2), []);
  assert.deepEqual(batch([1], 5), [[1]]);
});
test('rejects invalid sizes without mutating input', () => {
  const input = Object.freeze([1, 2, 3]);
  for (const size of [0, -1, 0.5, NaN, Infinity]) assert.throws(() => batch(input, size), RangeError);
  batch(input, 2);
  assert.deepEqual(input, [1, 2, 3]);
});
