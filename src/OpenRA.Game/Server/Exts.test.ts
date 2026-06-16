/**
 * Exts.test.ts — Server Exts utility function unit tests
 *
 * Tests cover: except() for numbers, strings, objects; removal of all
 * occurrences; empty arrays; reference equality semantics; and immutability.
 */

import { describe, it, expect } from 'vitest';
import { except } from './Exts';

// ---------------------------------------------------------------------------
// except — basic functionality
// ---------------------------------------------------------------------------

describe('except', () => {
  // ----- Number array tests -----

  it('removes a single matching element from number array', () => {
    expect(except([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it('removes the only element, returning empty array', () => {
    expect(except([1], 1)).toEqual([]);
  });

  it('returns empty array when input is empty', () => {
    expect(except([], 1)).toEqual([]);
  });

  it('removes ALL occurrences of the item', () => {
    expect(except([1, 1, 1], 1)).toEqual([]);
    expect(except([2, 1, 2, 1, 3], 2)).toEqual([1, 1, 3]);
  });

  it('returns identical array when item is not present', () => {
    const input = [1, 2, 3];
    const result = except(input, 4);
    expect(result).toEqual([1, 2, 3]);
    expect(result.length).toBe(3);
  });

  // ----- String array tests -----

  it('removes string element', () => {
    expect(except(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('removes all identical strings', () => {
    expect(except(['a', 'b', 'a'], 'a')).toEqual(['b']);
  });

  // ----- Object reference tests -----

  it('removes by reference (same object reference matches)', () => {
    const obj = { a: 1 };
    expect(except([obj], obj)).toEqual([]);
  });

  it('does NOT remove by structural equality (different references)', () => {
    const obj1 = { a: 1 };
    const obj2 = { a: 1 };
    const result = except([obj1], obj2);
    // obj1 and obj2 are different references, so obj1 is NOT removed
    expect(result).toEqual([obj1]);
    expect(result.length).toBe(1);
  });

  it('removes only matching references from mixed array', () => {
    const keep = { id: 1 };
    const remove = { id: 2 };
    const arr = [keep, remove];
    const result = except(arr, remove);
    expect(result).toEqual([keep]);
    expect(result.length).toBe(1);
  });

  // ----- Immutability tests -----

  it('returns a new array (does not mutate original)', () => {
    const input = [1, 2, 3];
    const result = except(input, 2);
    expect(result).toEqual([1, 3]);
    expect(input).toEqual([1, 2, 3]); // original unchanged
  });

  it('handles readonly input arrays', () => {
    const input: readonly number[] = [1, 2, 3];
    const result = except(input, 2);
    expect(result).toEqual([1, 3]);
  });

  // ----- Edge cases -----

  it('handles arrays with mixed truthy/falsy values', () => {
    expect(except([0, 1, 0], 0)).toEqual([1]);
    expect(except([false, true, false], false)).toEqual([true]);
    expect(except([null, undefined], null)).toEqual([undefined]);
  });

  it('handles removal of NaN (NaN !== NaN, so NaN is NOT removed)', () => {
    const result = except([NaN], NaN);
    // Since NaN !== NaN, filter does NOT remove it
    expect(result.length).toBe(1);
    expect(Number.isNaN(result[0])).toBe(true);
  });
});
