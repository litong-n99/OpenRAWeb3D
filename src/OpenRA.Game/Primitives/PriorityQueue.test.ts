/**
 * PriorityQueue.test.ts — PriorityQueue migration unit tests
 */

import { describe, it, expect } from 'vitest'
import { PriorityQueue } from './PriorityQueue'

describe('PriorityQueue', () => {
  it('starts empty', () => {
    const pq = new PriorityQueue<number>((a, b) => a - b)
    expect(pq.empty).toBe(true)
  })

  it('add and peek returns minimum', () => {
    const pq = new PriorityQueue<number>((a, b) => a - b)
    pq.add(5)
    pq.add(3)
    pq.add(7)
    expect(pq.peek()).toBe(3)
  })

  it('pop returns and removes minimum', () => {
    const pq = new PriorityQueue<number>((a, b) => a - b)
    pq.add(5)
    pq.add(3)
    pq.add(7)

    expect(pq.pop()).toBe(3)
    expect(pq.pop()).toBe(5)
    expect(pq.pop()).toBe(7)
    expect(pq.empty).toBe(true)
  })

  it('peek throws on empty', () => {
    const pq = new PriorityQueue<number>((a, b) => a - b)
    expect(() => pq.peek()).toThrow(/empty/)
  })

  it('pop throws on empty', () => {
    const pq = new PriorityQueue<number>((a, b) => a - b)
    expect(() => pq.pop()).toThrow(/empty/)
  })

  it('handles 100 items in sorted order', () => {
    const pq = new PriorityQueue<number>((a, b) => a - b)
    for (let i = 0; i < 100; i++) {
      pq.add(i)
    }
    for (let i = 0; i < 100; i++) {
      expect(pq.pop()).toBe(i)
    }
    expect(pq.empty).toBe(true)
  })

  it('handles 100 items in reverse order', () => {
    const pq = new PriorityQueue<number>((a, b) => a - b)
    for (let i = 99; i >= 0; i--) {
      pq.add(i)
    }
    for (let i = 0; i < 100; i++) {
      expect(pq.pop()).toBe(i)
    }
    expect(pq.empty).toBe(true)
  })

  it('handles 10000 items correctly', () => {
    const pq = new PriorityQueue<number>((a, b) => a - b)
    const n = 10000
    for (let i = n - 1; i >= 0; i--) {
      pq.add(i)
    }
    for (let i = 0; i < n; i++) {
      expect(pq.pop()).toBe(i)
    }
    expect(pq.empty).toBe(true)
  })

  it('handles duplicate priorities', () => {
    const pq = new PriorityQueue<number>((a, b) => a - b)
    pq.add(5)
    pq.add(5)
    pq.add(3)
    expect(pq.pop()).toBe(3)
    expect(pq.pop()).toBe(5)
    expect(pq.pop()).toBe(5)
  })

  it('works with string items (lexicographic)', () => {
    const pq = new PriorityQueue<string>((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    pq.add('banana')
    pq.add('apple')
    pq.add('cherry')
    expect(pq.pop()).toBe('apple')
    expect(pq.pop()).toBe('banana')
    expect(pq.pop()).toBe('cherry')
  })
})
