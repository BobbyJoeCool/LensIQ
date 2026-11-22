/**
 * Conditional highlighting for table views (#51). Pure, so it's unit-tested.
 * Rules reuse the filter engine: a rule matches a row the way a filter list
 * would, and the first matching rule wins.
 */
import type { Column, HighlightColor, HighlightRule, NotionColor, Row, SelectOption, TableConfig } from '@lensiq/shared';
import { COLOR_BY_TYPES, eventColor } from './calendar';
import { isComplete, matches } from './query';

/** A row or cell background: a rule's color, or an option color from Color rows by (#64), which adds brown and pink. */
export type HighlightTone = HighlightColor | 'brown' | 'pink';

/** Soft, opaque backgrounds (the pinned title column must hide what scrolls under it) that keep the normal text readable in both modes. */
export const HIGHLIGHT_CLASSES: Record<HighlightTone, string> = {
  red: 'bg-red-100 dark:bg-red-950',
  orange: 'bg-orange-100 dark:bg-orange-950',
  yellow: 'bg-yellow-100 dark:bg-yellow-950',
  green: 'bg-emerald-100 dark:bg-emerald-950',
  blue: 'bg-sky-100 dark:bg-sky-950',
  purple: 'bg-violet-100 dark:bg-violet-950',
  gray: 'bg-slate-200 dark:bg-slate-800',
  brown: 'bg-amber-100 dark:bg-amber-950',
  pink: 'bg-pink-100 dark:bg-pink-950',
};

/** Rule colors offered in the Highlight menu (brown and pink come only from option colors). */
export const HIGHLIGHT_LABELS: Record<HighlightColor, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  gray: 'Gray',
};

/** True when the rule's complete conditions on existing columns match the row. No such conditions: no match. */
export function ruleMatches(row: Row, rule: HighlightRule, columnIds: Set<string>, today?: string): boolean {
  const active = rule.filters.filter((f) => columnIds.has(f.columnId) && isComplete(f));
  if (!active.length) return false;
  return rule.filterMode === 'or' ? active.some((f) => matches(row, f, today)) : active.every((f) => matches(row, f, today));
}

export interface RowHighlight {
  /** Background for the whole row. */
  row: HighlightTone | null;
  /** Backgrounds for single cells, by column ID, where a cell rule wins. */
  cells: Record<string, HighlightTone>;
}

/** Notion's Default color means "no color", so it tints nothing (#64). */
export function optionTone(color: NotionColor | null | undefined): HighlightTone | null {
  return color && color !== 'default' ? color : null;
}

/** The Color rows by column (#64): a status or select column that still exists, else undefined. */
export function colorByColumn(columns: Column[], config: Pick<TableConfig, 'colorBy'>): Column | undefined {
  if (!config.colorBy) return undefined;
  const column = columns.find((c) => c.id === config.colorBy);
  return column && COLOR_BY_TYPES.has(column.type) ? column : undefined;
}

/**
 * The highlight for one row. Rules are checked in order and the first match
 * wins: a row rule colors every cell no earlier rule already colored, and a
 * cell rule colors its cell if nothing earlier did. Without a row rule, the
 * row takes its option color from `colorBy` (#64), so rules always win.
 */
export function rowHighlight(row: Row, rules: HighlightRule[] | undefined, columns: Column[], today?: string, colorBy?: Column): RowHighlight {
  const out: RowHighlight = { row: null, cells: {} };
  const ids = new Set(columns.map((c) => c.id));
  for (const rule of rules ?? []) {
    if (out.row) break; // a row rule already colors every remaining cell
    if (rule.columnId && (!ids.has(rule.columnId) || out.cells[rule.columnId])) continue;
    if (!ruleMatches(row, rule, ids, today)) continue;
    if (rule.columnId) out.cells[rule.columnId] = rule.color;
    else out.row = rule.color;
  }
  if (!out.row) out.row = optionTone(eventColor(row, colorBy));
  return out;
}

/** The legend above a table (#64): `column`'s options the rows use, in the column's option order. */
export function legendOptions(rows: Row[], column: Column | undefined): SelectOption[] {
  if (!column) return [];
  const used = new Set<string>();
  for (const r of rows) {
    const v = r.cells[column.id];
    if (v?.kind === 'select' && v.value) used.add(v.value.id);
  }
  return (column.options ?? []).filter((o) => used.has(o.id));
}

/** The color a given cell shows: its own cell rule, else the row's. */
export function cellHighlight(h: RowHighlight, columnId: string): HighlightTone | null {
  return h.cells[columnId] ?? h.row;
}

/** Column IDs the rules (and Color rows by, #64) point at: conditions and highlighted cells. */
export function highlightColumns(rules: HighlightRule[] | undefined, colorBy?: string | null): string[] {
  return [...(rules ?? []).flatMap((r) => [...r.filters.map((f) => f.columnId), ...(r.columnId ? [r.columnId] : [])]), ...(colorBy ? [colorBy] : [])];
}

/** Drops conditions on deleted columns, and rules whose highlighted column was deleted. */
export function cleanHighlights(rules: HighlightRule[] | undefined, columnIds: Set<string>): HighlightRule[] | undefined {
  if (!rules) return rules;
  return rules
    .filter((r) => !r.columnId || columnIds.has(r.columnId))
    .map((r) => ({ ...r, filters: r.filters.filter((f) => columnIds.has(f.columnId)) }));
}
