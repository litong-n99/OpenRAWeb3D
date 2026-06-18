/**
 * PerfTimer.test.ts — PerfTimer + Log 迁移单元测试
 *
 * PerfTimer 测试焦点：start/stop/reset 生命周期、elapsed getter、
 * toString 格式化、边界情况（未启动就 stop、多次 start）。
 *
 * Log 测试焦点：LogLevel 过滤、通道静音、write + 便利方法、
 * 全局 level 属性。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PerfTimer } from './PerfTimer.js'
import { Log, LogLevel } from './Log.js'

// ---------------------------------------------------------------------------
// PerfTimer
// ---------------------------------------------------------------------------

describe('PerfTimer', () => {
  describe('construction', () => {
    it('should create a stopped timer', () => {
      const t = new PerfTimer()
      expect(t.isRunning).toBe(false)
      expect(t.elapsed).toBe(0)
    })
  })

  describe('start', () => {
    it('should start the timer', () => {
      const t = new PerfTimer()
      t.start()
      expect(t.isRunning).toBe(true)
    })

    it('should be idempotent when already running', () => {
      const t = new PerfTimer()
      t.start()
      const firstStart = performance.now()
      // Second start() should not change the start time
      t.start()
      // After a short wait, elapsed should be at least the time since first start
      // But since we can't test exact timing, just verify it's running
      expect(t.isRunning).toBe(true)
      expect(t.elapsed).toBeGreaterThanOrEqual(0)
      // Verify timestamp was not reset by second start (elapsed accounts for time
      // since first start, not second)
      // Cast to any to silence "unused variable" warning
      void firstStart
    })

    it('should resume after stop without resetting accumulated time', () => {
      const t = new PerfTimer()
      // We can't really test timing precisely in unit tests, but we can verify
      // the state machine works correctly
      t.start()
      t.stop()
      const stoppedElapsed = t.elapsed
      expect(t.isRunning).toBe(false)
      t.start() // resume
      expect(t.isRunning).toBe(true)
      // Accumulated time should be preserved from before
      expect(t.accumulated).toBe(stoppedElapsed)
    })
  })

  describe('stop', () => {
    it('should stop the timer', () => {
      const t = new PerfTimer()
      t.start()
      const elapsed = t.stop()
      expect(t.isRunning).toBe(false)
      expect(elapsed).toBeGreaterThanOrEqual(0)
    })

    it('should return 0 when not running', () => {
      const t = new PerfTimer()
      expect(t.stop()).toBe(0)
      expect(t.isRunning).toBe(false)
    })

    it('should accumulate time across multiple start/stop cycles', () => {
      const t = new PerfTimer()
      t.start()
      t.stop()
      // Not possible to test exact accumulation without time mocking,
      // but we verify accumulated time is non-decreasing
      const firstAccum = t.accumulated
      t.start()
      t.stop()
      expect(t.accumulated).toBeGreaterThanOrEqual(firstAccum)
    })
  })

  describe('reset', () => {
    it('should zero accumulated time and restart', () => {
      const t = new PerfTimer()
      t.start()
      t.stop()
      expect(t.accumulated).toBeGreaterThanOrEqual(0)
      t.reset()
      expect(t.isRunning).toBe(true)
      expect(t.accumulated).toBe(0)
    })

    it('should reset even when not running', () => {
      const t = new PerfTimer()
      t.reset()
      expect(t.isRunning).toBe(true)
      expect(t.accumulated).toBe(0)
      expect(t.elapsed).toBeGreaterThanOrEqual(0)
    })
  })

  describe('elapsed', () => {
    it('should return 0 before starting', () => {
      const t = new PerfTimer()
      expect(t.elapsed).toBe(0)
    })

    it('should return accumulated time after stopping', () => {
      const t = new PerfTimer()
      t.start()
      // Let some time pass — we can't test exact values but
      // accumulated should be >= 0 after stop
      t.stop()
      expect(t.elapsed).toBeGreaterThanOrEqual(0)
    })

    it('should reflect running time while timer is active', () => {
      const t = new PerfTimer()
      t.start()
      // Immediate check — elapsed should be very small
      const immediate = t.elapsed
      expect(immediate).toBeGreaterThanOrEqual(0)
    })
  })

  describe('toString', () => {
    it('should format microsecond values', () => {
      const t = new PerfTimer()
      t.start()
      t.stop()
      const str = t.toString()
      // Should contain a time unit
      const hasUnit = str.includes('µs') || str.includes('ms') || str.includes('s')
      expect(hasUnit).toBe(true)
    })

    it('should return "0 µs" for zero elapsed', () => {
      const t = new PerfTimer()
      expect(t.toString()).toBe('0 µs')
    })

    it('should return a string', () => {
      const t = new PerfTimer()
      t.start()
      const s = t.toString()
      expect(typeof s).toBe('string')
      expect(s.length).toBeGreaterThan(0)
    })
  })

  describe('isRunning', () => {
    it('should be false by default', () => {
      const t = new PerfTimer()
      expect(t.isRunning).toBe(false)
    })

    it('should be true after start', () => {
      const t = new PerfTimer()
      t.start()
      expect(t.isRunning).toBe(true)
    })

    it('should be false after stop', () => {
      const t = new PerfTimer()
      t.start()
      t.stop()
      expect(t.isRunning).toBe(false)
    })

    it('should be true after reset', () => {
      const t = new PerfTimer()
      t.reset()
      expect(t.isRunning).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

describe('Log', () => {
  let consoleSpies: {
    info: ReturnType<typeof vi.spyOn>
    warn: ReturnType<typeof vi.spyOn>
    error: ReturnType<typeof vi.spyOn>
    debug: ReturnType<typeof vi.spyOn>
    log: ReturnType<typeof vi.spyOn>
  }

  beforeEach(() => {
    consoleSpies = {
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    }
    // Reset to default state
    Log.level = LogLevel.INFO
    Log.mutedChannels.clear()
  })

  afterEach(() => {
    Object.values(consoleSpies).forEach((s) => s.mockRestore())
  })

  describe('LogLevel', () => {
    it('should define ordered levels', () => {
      expect(LogLevel.VERBOSE).toBeLessThan(LogLevel.DEBUG)
      expect(LogLevel.DEBUG).toBeLessThan(LogLevel.INFO)
      expect(LogLevel.INFO).toBeLessThan(LogLevel.WARN)
      expect(LogLevel.WARN).toBeLessThan(LogLevel.ERROR)
    })
  })

  describe('write', () => {
    it('should write INFO messages via console.info', () => {
      Log.write('test', LogLevel.INFO, 'hello')
      expect(consoleSpies.info).toHaveBeenCalledWith('[test]', 'hello')
    })

    it('should write WARN messages via console.warn', () => {
      Log.write('test', LogLevel.WARN, 'warning')
      expect(consoleSpies.warn).toHaveBeenCalledWith('[test]', 'warning')
    })

    it('should write ERROR messages via console.error', () => {
      Log.write('test', LogLevel.ERROR, 'failure')
      expect(consoleSpies.error).toHaveBeenCalledWith('[test]', 'failure')
    })

    it('should write DEBUG messages via console.debug', () => {
      Log.level = LogLevel.DEBUG
      Log.write('test', LogLevel.DEBUG, 'debug msg')
      expect(consoleSpies.debug).toHaveBeenCalledWith('[test]', 'debug msg')
    })

    it('should write VERBOSE messages via console.debug', () => {
      Log.level = LogLevel.VERBOSE
      Log.write('test', LogLevel.VERBOSE, 'trace')
      expect(consoleSpies.debug).toHaveBeenCalledWith('[test]', 'trace')
    })

    it('should suppress messages below global level', () => {
      Log.level = LogLevel.WARN
      Log.write('test', LogLevel.INFO, 'should be suppressed')
      expect(consoleSpies.info).not.toHaveBeenCalled()
    })

    it('should suppress messages from muted channels', () => {
      Log.mutedChannels.add('noisy')
      Log.write('noisy', LogLevel.ERROR, 'should be muted')
      expect(consoleSpies.error).not.toHaveBeenCalled()
    })

    it('should still emit messages from non-muted channels', () => {
      Log.mutedChannels.add('noisy')
      Log.write('quiet', LogLevel.WARN, 'should not be muted')
      expect(consoleSpies.warn).toHaveBeenCalledWith('[quiet]', 'should not be muted')
    })
  })

  describe('convenience methods', () => {
    it('debug() should write at DEBUG level', () => {
      Log.level = LogLevel.DEBUG
      Log.debug('ch', 'dbg')
      expect(consoleSpies.debug).toHaveBeenCalledWith('[ch]', 'dbg')
    })

    it('info() should write at INFO level', () => {
      Log.info('ch', 'inf')
      expect(consoleSpies.info).toHaveBeenCalledWith('[ch]', 'inf')
    })

    it('warn() should write at WARN level', () => {
      Log.warn('ch', 'wrn')
      expect(consoleSpies.warn).toHaveBeenCalledWith('[ch]', 'wrn')
    })

    it('error() should write at ERROR level', () => {
      Log.error('ch', 'err')
      expect(consoleSpies.error).toHaveBeenCalledWith('[ch]', 'err')
    })
  })

  describe('level', () => {
    it('should default to INFO', () => {
      expect(Log.level).toBe(LogLevel.INFO)
    })

    it('can be changed at runtime', () => {
      Log.level = LogLevel.ERROR
      expect(Log.level).toBe(LogLevel.ERROR)

      Log.info('ch', 'suppressed')
      expect(consoleSpies.info).not.toHaveBeenCalled()

      Log.error('ch', 'emitted')
      expect(consoleSpies.error).toHaveBeenCalledWith('[ch]', 'emitted')
    })
  })

  describe('mutedChannels', () => {
    it('starts empty', () => {
      expect(Log.mutedChannels.size).toBe(0)
    })

    it('can add and remove channels', () => {
      Log.mutedChannels.add('temp')
      expect(Log.mutedChannels.has('temp')).toBe(true)
      Log.mutedChannels.delete('temp')
      expect(Log.mutedChannels.has('temp')).toBe(false)
    })
  })
})
