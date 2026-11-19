import { describe, expect, it } from 'vitest';
import { toCell, toSchema } from '../src/notion/normalize.js';

describe('toSchema', () => {
  it('puts the title column first and keeps option colors and number format', () => {
    const schema = toSchema({
      Status: { id: 's', name: 'Status', type: 'select', select: { options: [{ id: 'o1', name: 'Applied', color: 'blue' }] } },
      Salary: { id: 'n', name: 'Salary', type: 'number', number: { format: 'dollar' } },
      Company: { id: 'title', name: 'Company', type: 'title', title: {} },
      Where: { id: 'p', name: 'Where', type: 'place', place: {} },
    });
    expect(schema.columns.map((c) => c.id)).toEqual(['title', 's', 'n', 'p']);
    expect(schema.columns[1]!.options).toEqual([{ id: 'o1', name: 'Applied', color: 'blue' }]);
    expect(schema.columns[2]!.numberFormat).toBe('dollar');
    expect(schema.columns[3]).toMatchObject({ type: 'unsupported', notionType: 'place' });
  });
});

describe('toCell', () => {
  it('joins rich text', () => {
    expect(toCell({ id: 'a', type: 'title', title: [{ plain_text: 'Acme ' }, { plain_text: 'Corp' }] })).toEqual({
      kind: 'text',
      value: 'Acme Corp',
    });
  });

  it('handles empty select and date', () => {
    expect(toCell({ id: 'a', type: 'select', select: null })).toEqual({ kind: 'select', value: null });
    expect(toCell({ id: 'a', type: 'date', date: null })).toEqual({ kind: 'date', value: null });
  });

  it('reads date ranges', () => {
    expect(toCell({ id: 'a', type: 'date', date: { start: '2026-11-01', end: '2026-11-03', time_zone: null } })).toEqual({
      kind: 'date',
      value: { start: '2026-11-01', end: '2026-11-03' },
    });
  });

  it('reads formula results of each type', () => {
    expect(toCell({ id: 'f', type: 'formula', formula: { type: 'number', number: 12 } })).toEqual({ kind: 'number', value: 12 });
    expect(toCell({ id: 'f', type: 'formula', formula: { type: 'string', string: 'ok' } })).toEqual({ kind: 'text', value: 'ok' });
    expect(toCell({ id: 'f', type: 'formula', formula: { type: 'boolean', boolean: true } })).toEqual({ kind: 'boolean', value: true });
  });

  it('flattens rollup arrays into lists', () => {
    const cell = toCell({
      id: 'r',
      type: 'rollup',
      rollup: { type: 'array', function: 'show_original', array: [{ type: 'number', number: 5 }] },
    });
    expect(cell).toEqual({ kind: 'list', value: [{ kind: 'number', value: 5 }] });
  });

  it('keeps relation IDs and the has_more flag', () => {
    expect(toCell({ id: 'x', type: 'relation', relation: [{ id: 'p1' }], has_more: true })).toEqual({
      kind: 'relation',
      value: ['p1'],
      hasMore: true,
    });
  });

  it('formats unique IDs with their prefix', () => {
    expect(toCell({ id: 'u', type: 'unique_id', unique_id: { prefix: 'JOB', number: 7 } })).toEqual({ kind: 'text', value: 'JOB-7' });
  });

  it('reads files from internal and external URLs, marking Notion-hosted ones', () => {
    expect(
      toCell({
        id: 'f',
        type: 'files',
        files: [
          { name: 'bill.pdf', type: 'file', file: { url: 'https://s3/bill.pdf', expiry_time: 'x' } },
          { name: 'link', type: 'external', external: { url: 'https://example.com' } },
        ],
      }),
    ).toEqual({
      kind: 'files',
      value: [
        { name: 'bill.pdf', url: 'https://s3/bill.pdf', hosted: true }, // expires: links go through the API
        { name: 'link', url: 'https://example.com' },
      ],
    });
  });

  it('degrades unknown types to unsupported', () => {
    expect(toCell({ id: 'b', type: 'button', button: {} })).toEqual({ kind: 'unsupported', notionType: 'button' });
  });
});
