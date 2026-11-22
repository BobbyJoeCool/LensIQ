import { describe, expect, it } from 'vitest';
import type { Column, HighlightRule, Row } from '@lensiq/shared';
import { cellHighlight, cleanHighlights, colorByColumn, highlightColumns, legendOptions, optionTone, rowHighlight, ruleMatches } from './highlight';
import { applied, columns, interviewing, offer, rows } from './fixtures';

const ids = new Set(columns.map((c) => c.id));
const rule = (r: Partial<HighlightRule>): HighlightRule => ({ id: 'r', filters: [], filterMode: 'and', color: 'yellow', columnId: null, ...r });
const status = (...opts: { id: string }[]) => ({ id: 'f', columnId: 'stat', op: 'any_of' as const, value: opts.map((o) => o.id) });
const [northwind, contoso, fabrikam, adatum] = rows as [(typeof rows)[0], (typeof rows)[0], (typeof rows)[0], (typeof rows)[0]];

describe('highlight rules (#51)', () => {
  it('match like filters, with and/or', () => {
    expect(ruleMatches(adatum, rule({ filters: [status(offer)] }), ids)).toBe(true);
    expect(ruleMatches(northwind, rule({ filters: [status(offer)] }), ids)).toBe(false);
    const remoteApplied = [status(applied), { id: 'g', columnId: 'rem', op: 'checked' as const }];
    expect(ruleMatches(fabrikam, rule({ filters: remoteApplied }), ids)).toBe(true); // applied and remote
    expect(ruleMatches(contoso, rule({ filters: remoteApplied }), ids)).toBe(false); // applied, not remote
    expect(ruleMatches(northwind, rule({ filters: remoteApplied, filterMode: 'or' }), ids)).toBe(true); // remote
  });

  it('highlight nothing without a complete condition on an existing column', () => {
    expect(ruleMatches(adatum, rule({}), ids)).toBe(false);
    expect(ruleMatches(adatum, rule({ filters: [{ id: 'f', columnId: 'stat', op: 'any_of', value: [] }] }), ids)).toBe(false);
    expect(ruleMatches(adatum, rule({ filters: [{ id: 'f', columnId: 'gone', op: 'is_not_empty' }] }), ids)).toBe(false);
  });

  it('color the whole row or one cell', () => {
    expect(rowHighlight(adatum, [rule({ filters: [status(offer)], color: 'green' })], columns)).toEqual({ row: 'green', cells: {} });
    const h = rowHighlight(adatum, [rule({ filters: [status(offer)], color: 'green', columnId: 'stat' })], columns);
    expect(h).toEqual({ row: null, cells: { stat: 'green' } });
    expect(cellHighlight(h, 'stat')).toBe('green');
    expect(cellHighlight(h, 'title')).toBeNull();
  });

  it('let the first matching rule win', () => {
    const red = rule({ id: 'a', filters: [status(offer)], color: 'red' });
    const green = rule({ id: 'b', filters: [status(offer)], color: 'green' });
    expect(rowHighlight(adatum, [red, green], columns).row).toBe('red');
    expect(rowHighlight(adatum, [green, red], columns).row).toBe('green');

    // An earlier cell rule keeps its cell; a later row rule colors the rest.
    const cell = rule({ id: 'c', filters: [status(offer)], color: 'blue', columnId: 'sal' });
    const h = rowHighlight(adatum, [cell, red], columns);
    expect(cellHighlight(h, 'sal')).toBe('blue');
    expect(cellHighlight(h, 'title')).toBe('red');
    // An earlier row rule beats a later cell rule.
    expect(cellHighlight(rowHighlight(adatum, [red, cell], columns), 'sal')).toBe('red');
  });

  it('skip a rule whose highlighted column was deleted, and have no effect without rules', () => {
    expect(rowHighlight(adatum, [rule({ filters: [status(offer)], columnId: 'gone' })], columns)).toEqual({ row: null, cells: {} });
    expect(rowHighlight(adatum, undefined, columns)).toEqual({ row: null, cells: {} });
    expect(rowHighlight(northwind, [rule({ filters: [status(interviewing)] })], columns).row).toBe('yellow');
  });

  it('report and clean up references to deleted columns', () => {
    const rules = [rule({ id: 'a', filters: [status(offer), { id: 'g', columnId: 'gone', op: 'is_empty' }] }), rule({ id: 'b', filters: [status(offer)], columnId: 'gone2' })];
    expect(highlightColumns(rules)).toEqual(['stat', 'gone', 'stat', 'gone2']);
    const cleaned = cleanHighlights(rules, ids)!;
    expect(cleaned).toHaveLength(1); // the rule coloring a deleted column is dropped
    expect(cleaned[0]!.filters.map((f) => f.columnId)).toEqual(['stat']);
    expect(cleanHighlights(undefined, ids)).toBeUndefined();
  });
});

describe('Color rows by (#64)', () => {
  const stat = columns.find((c) => c.id === 'stat')!;
  const withStatus = (status: Row['cells'][string]): Row => ({ ...adatum, cells: { ...adatum.cells, stat: status } });

  it('uses a status or select column that still exists, and nothing else', () => {
    expect(colorByColumn(columns, { colorBy: 'stat' })).toBe(stat);
    expect(colorByColumn(columns, { colorBy: null })).toBeUndefined();
    expect(colorByColumn(columns, {})).toBeUndefined(); // older views: none
    expect(colorByColumn(columns, { colorBy: 'gone' })).toBeUndefined();
    expect(colorByColumn(columns, { colorBy: 'tags' })).toBeUndefined(); // multi-select isn't offered
    const select: Column = { id: 'cat', name: 'Category', type: 'select', options: [] };
    expect(colorByColumn([...columns, select], { colorBy: 'cat' })).toBe(select);
  });

  it("tints each row with its option's color", () => {
    expect(rowHighlight(northwind, undefined, columns, undefined, stat)).toEqual({ row: 'yellow', cells: {} });
    expect(rowHighlight(adatum, [], columns, undefined, stat).row).toBe('green');
    expect(rowHighlight(adatum, [], columns).row).toBeNull(); // off
  });

  it("prefers the schema's current option color (recolored in Notion)", () => {
    const recolored: Column = { ...stat, options: stat.options!.map((o) => (o.id === offer.id ? { ...o, color: 'pink' } : o)) };
    expect(rowHighlight(adatum, [], columns, undefined, recolored).row).toBe('pink');
  });

  it('leaves rows with no value, or a Default-colored option, untinted', () => {
    expect(rowHighlight(withStatus({ kind: 'select', value: null }), [], columns, undefined, stat).row).toBeNull();
    const plain = { id: 'sx', name: 'Plain', color: 'default' as const };
    const col: Column = { ...stat, options: [...stat.options!, plain] };
    expect(rowHighlight(withStatus({ kind: 'select', value: plain }), [], columns, undefined, col).row).toBeNull();
    expect(optionTone('default')).toBeNull();
    expect(optionTone('brown')).toBe('brown');
    expect(optionTone(null)).toBeNull();
  });

  it('lets highlight rules win: a row rule replaces the color, a cell rule keeps its cell', () => {
    const red = rule({ filters: [status(offer)], color: 'red' });
    expect(rowHighlight(adatum, [red], columns, undefined, stat).row).toBe('red');
    const cell = rule({ filters: [status(offer)], color: 'blue', columnId: 'sal' });
    const h = rowHighlight(adatum, [cell], columns, undefined, stat);
    expect(cellHighlight(h, 'sal')).toBe('blue');
    expect(cellHighlight(h, 'title')).toBe('green');
  });

  it("lists the options the rows use, in the column's order, for the legend", () => {
    expect(legendOptions([adatum, northwind, contoso, fabrikam], stat).map((o) => o.name)).toEqual(['Applied', 'Interviewing', 'Offer']);
    expect(legendOptions([adatum], stat).map((o) => o.name)).toEqual(['Offer']);
    expect(legendOptions([withStatus({ kind: 'select', value: null })], stat)).toEqual([]);
    expect(legendOptions(rows, undefined)).toEqual([]);
  });

  it('counts as a referenced column', () => {
    expect(highlightColumns(undefined, 'stat')).toEqual(['stat']);
    expect(highlightColumns([rule({ filters: [status(offer)] })], null)).toEqual(['stat']);
  });
});
