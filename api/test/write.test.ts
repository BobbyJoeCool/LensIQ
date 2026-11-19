import { describe, expect, it } from 'vitest';
import type { CellValue, Column } from '@lensiq/shared';
import { AppError } from '../src/errors.js';
import { isRich } from '../src/notion/normalize.js';
import { sameCell, toNotionProperties, toNotionProperty } from '../src/notion/write.js';

const col = (type: Column['type'], extra: Partial<Column> = {}): Column => ({ id: `c-${type}`, name: type, type, ...extra });
const statusCol = col('status', {
  options: [
    { id: 's1', name: 'Applied', color: 'blue' },
    { id: 's2', name: 'Offer', color: 'green' },
  ],
});
const selectCol = col('select', { options: [{ id: 'o1', name: 'High', color: 'red' }] });

function expectError(fn: () => unknown, status: number, text: RegExp) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).statusCode).toBe(status);
    expect((e as AppError).message).toMatch(text);
    return;
  }
  throw new Error('expected an error');
}

describe('toNotionProperty', () => {
  it('writes text as rich text, split at 2000 characters', () => {
    expect(toNotionProperty(col('rich_text'), { kind: 'text', value: 'Hi' })).toEqual({
      rich_text: [{ type: 'text', text: { content: 'Hi' } }],
    });
    const long = toNotionProperty(col('title'), { kind: 'text', value: 'x'.repeat(4500) }) as { title: unknown[] };
    expect(long.title).toHaveLength(3);
    expect(toNotionProperty(col('title'), { kind: 'empty' })).toEqual({ title: [] });
  });

  it('writes numbers and rejects non-finite ones', () => {
    expect(toNotionProperty(col('number'), { kind: 'number', value: 12.5 })).toEqual({ number: 12.5 });
    expect(toNotionProperty(col('number'), { kind: 'number', value: null })).toEqual({ number: null });
    expectError(() => toNotionProperty(col('number'), { kind: 'number', value: Number.NaN }), 400, /must be a number/);
  });

  it('matches select options by ID, then name, and creates new select options by name', () => {
    expect(toNotionProperty(selectCol, { kind: 'select', value: { id: 'o1', name: 'x', color: 'red' } })).toEqual({
      select: { id: 'o1' },
    });
    expect(toNotionProperty(selectCol, { kind: 'select', value: { id: '', name: 'High', color: 'default' } })).toEqual({
      select: { id: 'o1' },
    });
    expect(toNotionProperty(selectCol, { kind: 'select', value: { id: '', name: ' Low ', color: 'default' } })).toEqual({
      select: { name: 'Low' },
    });
    expect(toNotionProperty(selectCol, { kind: 'select', value: null })).toEqual({ select: null });
    expectError(
      () => toNotionProperty(selectCol, { kind: 'select', value: { id: '', name: 'a,b', color: 'default' } }),
      400,
      /commas/,
    );
  });

  it('never creates status options and never clears a status', () => {
    expect(toNotionProperty(statusCol, { kind: 'select', value: { id: 's2', name: 'Offer', color: 'green' } })).toEqual({
      status: { id: 's2' },
    });
    expectError(
      () => toNotionProperty(statusCol, { kind: 'select', value: { id: '', name: 'Ghosted', color: 'default' } }),
      400,
      /added in Notion/,
    );
    expectError(() => toNotionProperty(statusCol, { kind: 'select', value: null }), 400, /can't be empty/);
  });

  it('writes multi-select with a mix of existing and new options', () => {
    const multi = col('multi_select', { options: [{ id: 't1', name: 'Frontend', color: 'purple' }] });
    expect(
      toNotionProperty(multi, {
        kind: 'multi_select',
        value: [
          { id: 't1', name: 'Frontend', color: 'purple' },
          { id: '', name: 'Remote', color: 'default' },
        ],
      }),
    ).toEqual({ multi_select: [{ id: 't1' }, { name: 'Remote' }] });
  });

  it('validates dates and ranges', () => {
    expect(toNotionProperty(col('date'), { kind: 'date', value: { start: '2026-11-18', end: null } })).toEqual({
      date: { start: '2026-11-18', end: null },
    });
    expect(
      toNotionProperty(col('date'), { kind: 'date', value: { start: '2026-11-18T09:30:00-06:00', end: '2026-11-19' } }),
    ).toEqual({ date: { start: '2026-11-18T09:30:00-06:00', end: '2026-11-19' } });
    expect(toNotionProperty(col('date'), { kind: 'date', value: null })).toEqual({ date: null });
    expectError(() => toNotionProperty(col('date'), { kind: 'date', value: { start: 'next week', end: null } }), 400, /Start/);
    expectError(
      () => toNotionProperty(col('date'), { kind: 'date', value: { start: '2026-11-18', end: '2026-11-01' } }),
      400,
      /before the start/,
    );
  });

  it('writes links, blanks to null, and checks email shape', () => {
    expect(toNotionProperty(col('url'), { kind: 'link', value: ' https://x.dev ', linkType: 'url' })).toEqual({
      url: 'https://x.dev',
    });
    expect(toNotionProperty(col('url'), { kind: 'link', value: '', linkType: 'url' })).toEqual({ url: null });
    expectError(() => toNotionProperty(col('email'), { kind: 'link', value: 'nope', linkType: 'email' }), 400, /email/);
  });

  it('refuses read-only columns and mismatched kinds', () => {
    expectError(() => toNotionProperty(col('formula'), { kind: 'number', value: 1 }), 422, /calculated/);
    expectError(() => toNotionProperty(col('people'), { kind: 'empty' }), 422, /calculated/);
    expectError(() => toNotionProperty(col('checkbox'), { kind: 'text', value: 'yes' }), 400, /can't be set/);
  });

  it('writes relations as page IDs, deduplicated, and refuses truncated ones', () => {
    expect(toNotionProperty(col('relation'), { kind: 'relation', value: ['a', 'b', 'a'], hasMore: false })).toEqual({
      relation: [{ id: 'a' }, { id: 'b' }],
    });
    expect(toNotionProperty(col('relation'), { kind: 'empty' })).toEqual({ relation: [] });
    expectError(() => toNotionProperty(col('relation'), { kind: 'relation', value: ['a'], hasMore: true }), 422, /more than 25/);
  });

  it('builds a properties object and rejects unknown columns', () => {
    expect(toNotionProperties([col('checkbox')], { 'c-checkbox': { kind: 'boolean', value: true } })).toEqual({
      'c-checkbox': { checkbox: true },
    });
    expectError(() => toNotionProperties([], { nope: { kind: 'empty' } }), 400, /Refresh/);
  });
});

describe('sameCell', () => {
  const opt = (id: string, name = id) => ({ id, name, color: 'default' as const });
  it('treats blank values as equal', () => {
    const blanks: CellValue[] = [
      { kind: 'empty' },
      { kind: 'text', value: '' },
      { kind: 'number', value: null },
      { kind: 'select', value: null },
      { kind: 'multi_select', value: [] },
    ];
    for (const a of blanks) for (const b of blanks) expect(sameCell(a, b)).toBe(true);
  });

  it('compares options by ID and multi-select regardless of order', () => {
    expect(sameCell({ kind: 'select', value: opt('a', 'Old') }, { kind: 'select', value: opt('a', 'Renamed') })).toBe(true);
    expect(sameCell({ kind: 'select', value: opt('a') }, { kind: 'select', value: opt('b') })).toBe(false);
    expect(
      sameCell({ kind: 'multi_select', value: [opt('a'), opt('b')] }, { kind: 'multi_select', value: [opt('b'), opt('a')] }),
    ).toBe(true);
  });

  it('compares relations by ID set, ignoring dashes and order', () => {
    expect(sameCell({ kind: 'relation', value: ['ab-cd', 'ef'], hasMore: false }, { kind: 'relation', value: ['ef', 'abcd'], hasMore: false })).toBe(true);
    expect(sameCell({ kind: 'relation', value: ['a'], hasMore: false }, { kind: 'relation', value: ['b'], hasMore: false })).toBe(false);
    expect(sameCell({ kind: 'relation', value: [], hasMore: false }, { kind: 'empty' })).toBe(true);
  });

  it('compares text by content, ignoring the rich flag, and other kinds deeply', () => {
    expect(sameCell({ kind: 'text', value: 'x', rich: true }, { kind: 'text', value: 'x' })).toBe(true);
    expect(sameCell({ kind: 'text', value: 'x' }, { kind: 'text', value: 'y' })).toBe(false);
    expect(
      sameCell({ kind: 'date', value: { start: '2026-01-01', end: null } }, { kind: 'date', value: { end: null, start: '2026-01-01' } }),
    ).toBe(true);
    expect(sameCell({ kind: 'number', value: 1 }, { kind: 'number', value: 2 })).toBe(false);
  });
});

describe('isRich', () => {
  const t = (extra: object = {}) => ({ type: 'text', plain_text: 'x', text: { content: 'x' }, ...extra });
  it('flags formatting, colors, links, mentions and equations', () => {
    expect(isRich([t()])).toBe(false);
    expect(isRich([t({ annotations: { bold: false, color: 'default' } })])).toBe(false);
    expect(isRich([t({ annotations: { bold: true } })])).toBe(true);
    expect(isRich([t({ annotations: { color: 'red' } })])).toBe(true);
    expect(isRich([t({ text: { content: 'x', link: { url: 'https://x' } } })])).toBe(true);
    expect(isRich([{ type: 'mention', plain_text: '@Bob' }])).toBe(true);
    expect(isRich([{ type: 'equation', plain_text: 'x' }])).toBe(true);
    expect(isRich([])).toBe(false);
  });
});
