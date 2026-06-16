/**
 * ProtocolVersion.test.ts — ProtocolVersion unit tests
 *
 * Tests cover: protocol constant values, OrderType byte values, byte range
 * validity, and uniqueness of all OrderType constants.
 */

import { describe, it, expect } from 'vitest';
import {
  Handshake,
  Orders,
  MaxOrderLength,
  OrderType,
  type ReceiveState,
  type OrderTypeValue,
} from './ProtocolVersion';

// ---------------------------------------------------------------------------
// Protocol Version Constants
// ---------------------------------------------------------------------------

describe('ProtocolVersion constants', () => {
  it('Handshake version is 7', () => {
    expect(Handshake).toBe(7);
  });

  it('Orders version is 21', () => {
    expect(Orders).toBe(21);
  });

  it('MaxOrderLength is 131072 (128 kB)', () => {
    expect(MaxOrderLength).toBe(131072);
    expect(MaxOrderLength).toBe(128 * 1024);
  });

  it('Handshake and Orders are positive integers', () => {
    expect(Handshake).toBeGreaterThan(0);
    expect(Orders).toBeGreaterThan(0);
  });

  it('MaxOrderLength is a multiple of 1024', () => {
    expect(MaxOrderLength % 1024).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// OrderType Byte Values
// ---------------------------------------------------------------------------

describe('OrderType byte values', () => {
  it('SyncHash is 0x65', () => {
    expect(OrderType.SyncHash).toBe(0x65);
  });

  it('Disconnect is 0xBF', () => {
    expect(OrderType.Disconnect).toBe(0xbf);
  });

  it('Handshake is 0xFE', () => {
    expect(OrderType.Handshake).toBe(0xfe);
  });

  it('WorldOrder is 0xFF', () => {
    expect(OrderType.WorldOrder).toBe(0xff);
  });

  it('Ack is 0x10', () => {
    expect(OrderType.Ack).toBe(0x10);
  });

  it('Ping is 0x20', () => {
    expect(OrderType.Ping).toBe(0x20);
  });

  it('TickScale is 0x76', () => {
    expect(OrderType.TickScale).toBe(0x76);
  });

  it('all OrderType values are within valid byte range (0x00–0xFF)', () => {
    const values = Object.values(OrderType) as OrderTypeValue[];
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0x00);
      expect(v).toBeLessThanOrEqual(0xff);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('all OrderType values are unique (no duplicates)', () => {
    const values = Object.values(OrderType) as OrderTypeValue[];
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('OrderType has exactly 7 entries', () => {
    const keys = Object.keys(OrderType);
    expect(keys.length).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// ReceiveState type (compile-time check)
// ---------------------------------------------------------------------------

describe('ReceiveState type', () => {
  it('ReceiveState is a string union of "Header" and "Data"', () => {
    // This is a compile-time type assertion; at runtime we just verify
    // that string literals "Header" and "Data" are assignable.
    // The actual type enforcement is done by tsc.

    const header: ReceiveState = 'Header';
    const data: ReceiveState = 'Data';

    expect(header).toBe('Header');
    expect(data).toBe('Data');
  });
});
