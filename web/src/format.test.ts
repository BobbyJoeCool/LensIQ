import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatNumber, timeAgo } from './format';

describe('formatNumber', () => {
  it('uses currency formats', () => {
    expect(formatNumber(1234.5, 'dollar')).toContain('1,234.50');
    expect(formatNumber(1234.5, 'dollar')).toContain('$');
  });

  it('shows Notion percent values multiplied by 100', () => {
    expect(formatNumber(0.25, 'percent')).toBe('25%');
  });

  it('groups digits only for number_with_commas', () => {
    expect(formatNumber(1234567, 'number_with_commas')).toBe('1,234,567');
    expect(formatNumber(1234567, 'number')).toBe('1234567');
    expect(formatNumber(42)).toBe('42');
  });
});

describe('formatDate', () => {
  it('never shifts a date-only value to the previous day', () => {
    expect(formatDate({ start: '2026-11-01', end: null })).toMatch(/Nov 1, 2026/);
  });

  it('shows ranges with an arrow', () => {
    expect(formatDate({ start: '2026-11-01', end: '2026-11-03' })).toMatch(/Nov 1, 2026 → Nov 3, 2026/);
  });
});

describe('timeAgo', () => {
  afterEach(() => vi.useRealTimers());

  it('describes recent times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
    expect(timeAgo(null)).toBe('never');
    expect(timeAgo('2026-11-17T11:59:50Z')).toBe('just now');
    expect(timeAgo('2026-11-17T11:55:00Z')).toBe('5 min ago');
    expect(timeAgo('2026-11-17T09:00:00Z')).toBe('3 h ago');
  });
});
