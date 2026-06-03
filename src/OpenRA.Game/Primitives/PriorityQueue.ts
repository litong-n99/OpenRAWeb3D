/**
 * PriorityQueue.ts — Binary min-heap priority queue
 * OpenRA 对照: OpenRA.Game/Primitives/PriorityQueue.cs
 *
 * 核心范式转换:
 * - C# struct IComparer<T> generic constraint → comparison function
 * - C# IPriorityQueue<T> + PriorityQueue<T, TComparer> → single class
 * - OpenRA's LEVEL-based indexing preserved verbatim:
 *   Index(level, idx) = (1 << level) - 1 + idx
 *   AboveIndex(level, idx) = (1 << (level - 1)) - 1 + (idx >> 1)
 */

// ---------------------------------------------------------------------------
// IPriorityQueue
// ---------------------------------------------------------------------------

/**
 * Interface for a priority queue.
 *
 * OpenRA 对照: IPriorityQueue<T>
 */
export interface IPriorityQueue<T> {
  /** Add an item to the queue. */
  add(item: T): void
  /** Whether the queue is empty. */
  readonly empty: boolean
  /** Peek at the minimum item without removing it. */
  peek(): T
  /** Remove and return the minimum item. */
  pop(): T
}

// ---------------------------------------------------------------------------
// PriorityQueue
// ---------------------------------------------------------------------------

/**
 * Binary min-heap priority queue using OpenRA's level-based indexing.
 *
 * OpenRA 对照: PriorityQueue<T, TComparer>
 *
 * On pop, the item with the lowest priority value is removed.
 * Uses a binary heap stored in a level-indexed array.
 * Add: O(log n). Pop: O(log n). Peek: O(1).
 *
 * @typeParam T — item type
 */
export class PriorityQueue<T> implements IPriorityQueue<T> {
  /** Comparison function: returns negative if a < b, 0 if equal, positive if a > b. */
  private readonly comparer: (a: T, b: T) => number

  /**
   * Items array. Divided into levels. At each level, the number of elements doubles.
   * Elements at deeper levels always have higher priority values than elements
   * nearer to the root.
   */
  private items: T[]

  /** Index of the deepest level currently in use. */
  private level: number

  /** Number of elements currently in the deepest level. */
  private index: number

  /**
   * Create a PriorityQueue with a comparison function.
   *
   * OpenRA 对照: PriorityQueue(TComparer comparer)
   *
   * @param comparer — (a, b) => negative if a < b, 0 if equal, positive if a > b
   */
  constructor(comparer: (a: T, b: T) => number) {
    this.comparer = comparer
    this.items = new Array<T>(1)
    this.level = 0
    this.index = 0
  }

  // -----------------------------------------------------------------------
  // Level-index helpers (from OpenRA verbatim)
  // -----------------------------------------------------------------------

  /**
   * Array index for a given level and index within that level.
   *
   * OpenRA 对照: PriorityQueue.Index(int level, int index)
   */
  private static indexOf(level: number, index: number): number {
    return (1 << level) - 1 + index
  }

  /**
   * Parent index for a given level and index.
   *
   * OpenRA 对照: PriorityQueue.AboveIndex(int level, int index)
   */
  private static aboveIndex(level: number, index: number): number {
    return (1 << (level - 1)) - 1 + (index >> 1)
  }

  /**
   * Array index of the last element in the heap.
   */
  private indexLast(): number {
    let lastLevel = this.level
    let lastIndex = this.index

    if (--lastIndex < 0) lastIndex = (1 << --lastLevel) - 1

    return PriorityQueue.indexOf(lastLevel, lastIndex)
  }

  // -----------------------------------------------------------------------
  // Add
  // -----------------------------------------------------------------------

  /**
   * Add an item to the queue.
   *
   * OpenRA 对照: PriorityQueue.Add(T)
   */
  add(item: T): void {
    let addLevel = this.level
    let addIndex = this.index

    // Bubble up: while the parent is greater, swap
    while (addLevel >= 1) {
      const above = this.items[PriorityQueue.aboveIndex(addLevel, addIndex)]
      if (this.comparer(above, item) > 0) {
        this.items[PriorityQueue.indexOf(addLevel, addIndex)] = above
        addLevel--
        addIndex >>= 1
      } else {
        break
      }
    }

    this.items[PriorityQueue.indexOf(addLevel, addIndex)] = item

    // Advance insertion point
    if (++this.index >= 1 << this.level) {
      this.index = 0
      const count = 2 * (1 << ++this.level)
      if (count - 1 >= this.items.length) {
        // Expand array
        const newItems = new Array<T>(count)
        for (let i = 0; i < this.items.length; i++) {
          newItems[i] = this.items[i]
        }
        this.items = newItems
      }
    }
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /**
   * Whether the queue is empty.
   *
   * OpenRA 对照: PriorityQueue.Empty
   */
  get empty(): boolean {
    return this.level === 0
  }

  /**
   * Peek at the minimum item without removing it.
   *
   * OpenRA 对照: PriorityQueue.Peek()
   *
   * @throws if the queue is empty
   */
  peek(): T {
    if (this.level <= 0 && this.index <= 0) {
      throw new Error('PriorityQueue empty.')
    }

    return this.items[PriorityQueue.indexOf(0, 0)]
  }

  /**
   * Remove and return the minimum item.
   *
   * OpenRA 对照: PriorityQueue.Pop()
   *
   * @throws if the queue is empty
   */
  pop(): T {
    const ret = this.peek()
    this.bubbleInto(0, 0, this.items[this.indexLast()])
    if (--this.index < 0) {
      this.index = (1 << --this.level) - 1
    }
    return ret
  }

  // -----------------------------------------------------------------------
  // BubbleInto (heapify-down)
  // -----------------------------------------------------------------------

  /**
   * Bubble a value down from a given level/index to its correct position.
   *
   * OpenRA 对照: PriorityQueue.BubbleInto(int intoLevel, int intoIndex, T val)
   */
  private bubbleInto(intoLevel: number, intoIndex: number, val: T): void {
    while (true) {
      let downLevel = intoLevel + 1
      let downIndex = intoIndex << 1

      // If no children exist, place val here
      if (downLevel > this.level || (downLevel === this.level && downIndex >= this.index)) {
        this.items[PriorityQueue.indexOf(intoLevel, intoIndex)] = val
        return
      }

      // Get left child
      let down = this.items[PriorityQueue.indexOf(downLevel, downIndex)]

      // If right child exists and is smaller, use it
      if (downLevel < this.level || (downLevel === this.level && downIndex < this.index - 1)) {
        const downRight = this.items[PriorityQueue.indexOf(downLevel, downIndex + 1)]
        if (this.comparer(down, downRight) >= 0) {
          down = downRight
          downIndex++
        }
      }

      // If val is <= smaller child, place val here
      if (this.comparer(val, down) <= 0) {
        this.items[PriorityQueue.indexOf(intoLevel, intoIndex)] = val
        return
      }

      // Move child up and continue
      this.items[PriorityQueue.indexOf(intoLevel, intoIndex)] = down
      intoLevel = downLevel
      intoIndex = downIndex
    }
  }
}
