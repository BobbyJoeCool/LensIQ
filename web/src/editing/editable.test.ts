import { describe, expect, it } from 'vitest';
import type { Column } from '@lensiq/shared';
import { canEdit, emptyValue, localIso, numberToText, parseNumber, splitIso, valueOf } from './editable';

const col = (type: Column['type']): Column => ({ id: 'c', name: 'C', type });

describe('canEdit', () => {
  it('allows editable types and refuses computed ones', () => {
    expect(canEdit(col('status'), undefined)).toBe(true);
    expect(canEdit(col('formula'), undefined)).toBe(false);
    expect(canEdit(col('people'), undefined)).toBe(false);
    expect(canEdit(col('relation'), { kind: 'relation', value: ['a'], hasMore: false })).toBe(true);
    expect(canEdit(col('relation'), { kind: 'relation', value: ['a'], hasMore: true })).toBe(false); // Notion truncated it
  });
  it('refuses formatted text (Q14)', () => {
    expect(canEdit(col('rich_text'), { kind: 'text', value: 'x' })).toBe(true);
    expect(canEdit(col('rich_text'), { kind: 'text', value: 'x', rich: true })).toBe(false);
  });
});

describe('emptyValue / valueOf', () => {
  it('gives each type its editor shape', () => {
    expect(emptyValue(col('url'))).toEqual({ kind: 'link', value: null, linkType: 'url' });
    expect(emptyValue(col('checkbox'))).toEqual({ kind: 'boolean', value: false });
    expect(emptyValue(col('multi_select'))).toEqual({ kind: 'multi_select', value: [] });
  });
  it('falls back to the empty value for missing or empty cells', () => {
    expect(valueOf(col('number'), {})).toEqual({ kind: 'number', value: null });
    expect(valueOf(col('number'), { c: { kind: 'empty' } })).toEqual({ kind: 'number', value: null });
    expect(valueOf(col('number'), { c: { kind: 'number', value: 3 } })).toEqual({ kind: 'number', value: 3 });
  });
});

describe('numbers', () => {
  it('parses currency, commas and percent', () => {
    expect(parseNumber('$1,250.50')).toBe(1250.5);
    expect(parseNumber('25%', 'percent')).toBe(0.25);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBe('invalid');
  });
  it('shows percent as whole numbers', () => {
    expect(numberToText(0.255, 'percent')).toBe('25.5');
    expect(numberToText(null)).toBe('');
    expect(numberToText(12)).toBe('12');
  });
});

describe('dates', () => {
  it('builds an ISO string with the local offset', () => {
    const iso = localIso('2026-11-18', '09:30');
    expect(iso).toMatch(/^2026-11-18T09:30:00[+-]\d{2}:\d{2}$/);
    expect(splitIso(iso)).toEqual({ date: '2026-11-18', time: '09:30' });
  });
  it('keeps date-only values date-only', () => {
    expect(splitIso('2026-11-01')).toEqual({ date: '2026-11-01', time: null });
  });
});
