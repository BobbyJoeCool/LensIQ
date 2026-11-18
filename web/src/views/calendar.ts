/** Date math for the calendar view. Pure, so it's unit-tested. */
import type { DateValue, Row } from '@lensiq/shared';
import { localIso, splitIso } from '../editing/editable';
import { addDays, dayOf, toDay } from './query';

/** Weeks (Monday first) covering a month: each week is seven YYYY-MM-DD days. */
export function monthGrid(year: number, month: number): string[][] {
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  let day = dayOf(new Date(year, month - 1, 1 - offset));
  const last = dayOf(new Date(year, month, 0));
  const weeks: string[][] = [];
  while (weeks.length < 6 && (weeks.length === 0 || day <= last)) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

const MAX_SPAN = 62;

/**
 * Rows placed on each day between `from` and `to` (inclusive). A date range
 * appears on every day it covers, up to two months.
 */
export function rowsByDay(rows: Row[], columnId: string, from: string, to: string): { byDay: Map<string, Row[]>; undated: number } {
  const byDay = new Map<string, Row[]>();
  let undated = 0;
  for (const r of rows) {
    const v = r.cells[columnId];
    if (v?.kind !== 'date' || !v.value) {
      undated++;
      continue;
    }
    const start = toDay(v.value.start);
    const end = v.value.end ? toDay(v.value.end) : start;
    for (let d = start < from ? from : start, i = 0; d <= end && d <= to && i < MAX_SPAN; d = addDays(d, 1), i++) {
      const list = byDay.get(d);
      if (list) list.push(r);
      else byDay.set(d, [r]);
    }
  }
  return { byDay, undated };
}

function shiftOne(iso: string, days: number): string {
  const { date, time } = splitIso(iso);
  const moved = addDays(date, days);
  return time ? localIso(moved, time) : moved;
}

/** Moves a date (or range, keeping its length and any times) by whole days. */
export function shiftDate(value: DateValue, days: number): DateValue {
  return { start: shiftOne(value.start, days), end: value.end ? shiftOne(value.end, days) : null };
}
