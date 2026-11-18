import { describe, expect, it } from 'vitest';
import type { Row } from '@lensiq/shared';
import { daysBetween, monthGrid, rowsByDay, shiftDate } from './calendar';

const row = (id: string, start: string | null, end: string | null = null): Row => ({
  id,
  url: '',
  lastEditedTime: '',
  cells: { d: { kind: 'date', value: start ? { start, end } : null } },
});

describe('monthGrid', () => {
  it('starts on Monday and covers the whole month', () => {
    const weeks = monthGrid(2026, 11); // Nov 1, 2026 is a Sunday
    expect(weeks[0]![0]).toBe('2026-10-26');
    expect(weeks[0]![6]).toBe('2026-11-01');
    expect(weeks.at(-1)!.includes('2026-11-30')).toBe(true);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks).toHaveLength(6);
  });
  it('uses five weeks when that is enough', () => {
    expect(monthGrid(2027, 2)).toHaveLength(4); // Feb 2027 starts on a Monday and has 28 days
  });
});

describe('rowsByDay', () => {
  it('places single days and ranges, clipped to the window, and counts undated rows', () => {
    const { byDay, undated } = rowsByDay(
      [row('a', '2026-11-03'), row('b', '2026-10-30', '2026-11-02'), row('c', null), row('d', '2026-11-18T09:30:00-06:00')],
      'd',
      '2026-11-01',
      '2026-11-30',
    );
    expect(byDay.get('2026-11-03')!.map((r) => r.id)).toEqual(['a']);
    expect(byDay.get('2026-11-01')!.map((r) => r.id)).toEqual(['b']);
    expect(byDay.get('2026-11-02')!.map((r) => r.id)).toEqual(['b']);
    expect(byDay.has('2026-10-30')).toBe(false);
    expect(byDay.get('2026-11-18')!.map((r) => r.id)).toEqual(['d']);
    expect(undated).toBe(1);
  });
});

describe('shiftDate', () => {
  it('moves dates and ranges by whole days, keeping length and times', () => {
    expect(shiftDate({ start: '2026-11-30', end: null }, 2)).toEqual({ start: '2026-12-02', end: null });
    expect(shiftDate({ start: '2026-11-01', end: '2026-11-03' }, -1)).toEqual({ start: '2026-10-31', end: '2026-11-02' });
    const moved = shiftDate({ start: '2026-11-18T09:30:00-06:00', end: null }, 1);
    expect(moved.start).toMatch(/^2026-11-19T\d{2}:30:00[+-]\d{2}:\d{2}$/);
  });
  it('counts days across months and years', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('2026-11-05', '2026-11-01')).toBe(-4);
  });
});
