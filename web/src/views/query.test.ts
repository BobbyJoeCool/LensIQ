import { describe, expect, it } from 'vitest';
import type { Filter } from '@lensiq/shared';
import { applyQuery, cellText, columnKind, isComplete } from './query';
import { applied, columns, frontend, offer, rows } from './fixtures';

const run = (filters: Filter[], extra: Partial<Parameters<typeof applyQuery>[2]> = {}, today = '2026-11-18') =>
  applyQuery(rows, columns, { filters, filterMode: 'and', sorts: [], ...extra }, today).rows.map((r) => r.id);
const f = (columnId: string, op: Filter['op'], value?: Filter['value']): Filter => ({ id: `${columnId}-${op}`, columnId, op, value });

describe('columnKind', () => {
  it('maps types and infers formulas from their values', () => {
    expect(columnKind(columns[1]!)).toBe('select');
    expect(columnKind(columns[6]!, rows)).toBe('number'); // formula with numbers
    expect(columnKind(columns[6]!, [])).toBe('other');
  });
});

describe('filters', () => {
  it('text: contains is case-insensitive; equals; empty', () => {
    expect(run([f('city', 'contains', 'CHI')])).toEqual(['a', 'd']);
    expect(run([f('city', 'equals', 'austin')])).toEqual(['b']);
    expect(run([f('city', 'is_empty')])).toEqual(['c']);
    expect(run([f('city', 'not_contains', 'chi')])).toEqual(['b', 'c']);
  });

  it('number comparisons, with empty numbers only matching ≠ and is empty', () => {
    expect(run([f('sal', 'gte', 145000)])).toEqual(['a', 'd']);
    expect(run([f('sal', 'lt', 150000)])).toEqual(['a', 'c']);
    expect(run([f('sal', 'neq', 145000)])).toEqual(['b', 'c', 'd']);
    expect(run([f('sal', 'is_empty')])).toEqual(['b']);
  });

  it('select and multi-select any/none of', () => {
    expect(run([f('stat', 'any_of', [applied.id, offer.id])])).toEqual(['b', 'c', 'd']);
    expect(run([f('stat', 'none_of', [applied.id])])).toEqual(['a', 'd']);
    expect(run([f('tags', 'any_of', [frontend.id])])).toEqual(['a', 'b']);
    expect(run([f('tags', 'is_empty')])).toEqual(['c']);
  });

  it('checkbox', () => {
    expect(run([f('rem', 'checked')])).toEqual(['a', 'c']);
    expect(run([f('rem', 'unchecked')])).toEqual(['b', 'd']);
  });

  it('dates: before/after and relative windows', () => {
    expect(run([f('appl', 'before', '2026-10-12')])).toEqual(['a']);
    expect(run([f('appl', 'on_or_after', '2026-10-12')])).toEqual(['b', 'c']);
    expect(run([f('appl', 'past_days', 7)])).toEqual(['c']); // Nov 15 is within 7 days of Nov 18
    expect(run([f('appl', 'next_days', 7)])).toEqual([]);
    expect(run([f('appl', 'is_empty')])).toEqual(['d']);
  });

  it('combines with and/or; skips incomplete filters', () => {
    const both = [f('rem', 'checked'), f('stat', 'any_of', [applied.id])];
    expect(run(both)).toEqual(['c']);
    expect(run(both, { filterMode: 'or' })).toEqual(['a', 'b', 'c']);
    expect(run([f('city', 'contains', '')])).toEqual(['a', 'b', 'c', 'd']);
    expect(isComplete(f('stat', 'any_of', []))).toBe(false);
  });

  it('reports filters and sorts on missing columns instead of failing', () => {
    const res = applyQuery(rows, columns, { filters: [f('gone', 'is_empty')], filterMode: 'and', sorts: [{ columnId: 'gone2', direction: 'asc' }] });
    expect(res.rows).toHaveLength(4);
    expect(res.missing.sort()).toEqual(['gone', 'gone2']);
  });
});

describe('sorts', () => {
  const sorted = (columnId: string, direction: 'asc' | 'desc' = 'asc') =>
    applyQuery(rows, columns, { filters: [], filterMode: 'and', sorts: [{ columnId, direction }] }).rows.map((r) => r.id);

  it('numbers, with empty values last in both directions', () => {
    expect(sorted('sal')).toEqual(['c', 'a', 'd', 'b']);
    expect(sorted('sal', 'desc')).toEqual(['d', 'a', 'c', 'b']);
  });
  it('select by option order, not alphabet', () => {
    expect(sorted('stat')).toEqual(['b', 'c', 'a', 'd']); // Applied, Applied, Interviewing, Offer
  });
  it('dates and text', () => {
    expect(sorted('appl')).toEqual(['a', 'b', 'c', 'd']);
    expect(sorted('title')).toEqual(['d', 'b', 'c', 'a']);
  });
  it('applies multiple sorts in order', () => {
    const res = applyQuery(rows, columns, {
      filters: [],
      filterMode: 'and',
      sorts: [
        { columnId: 'stat', direction: 'asc' },
        { columnId: 'title', direction: 'desc' },
      ],
    });
    expect(res.rows.map((r) => r.id)).toEqual(['c', 'b', 'a', 'd']);
  });
});

describe('cellText', () => {
  it('flattens every kind', () => {
    expect(cellText(rows[1]!.cells.tags)).toBe('Full stack, Frontend');
    expect(cellText({ kind: 'boolean', value: true })).toBe('Checked');
    expect(cellText(undefined)).toBe('');
  });
});
