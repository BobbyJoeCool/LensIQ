/**
 * Conditional highlighting for table views (#51). Pure, so it's unit-tested.
 * Rules reuse the filter engine: a rule matches a row the way a filter list
 * would, and the first matching rule wins.
 */
import type { Column, HighlightColor, HighlightRule, Row } from '@lensiq/shared';
import { isComplete, matches } from './query';

/** Soft, opaque backgrounds (the pinned title column must hide what scrolls under it) that keep the normal text readable in both modes. */
export const HIGHLIGHT_CLASSES: Record<HighlightColor, string> = {
  red: 'bg-red-100 dark:bg-red-950',
  orange: 'bg-orange-100 dark:bg-orange-950',
  yellow: 'bg-yellow-100 dark:bg-yellow-950',
  green: 'bg-emerald-100 dark:bg-emerald-950',
  blue: 'bg-sky-100 dark:bg-sky-950',
  purple: 'bg-violet-100 dark:bg-violet-950',
  gray: 'bg-slate-200 dark:bg-slate-800',
};

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
  row: HighlightColor | null;
  /** Backgrounds for single cells, by column ID, where a cell rule wins. */
  cells: Record<string, HighlightColor>;
}

/**
 * The highlight for one row. Rules are checked in order and the first match
 * wins: a row rule colors every cell no earlier rule already colored, and a
 * cell rule colors its cell if nothing earlier did.
 */
export function rowHighlight(row: Row, rules: HighlightRule[] | undefined, columns: Column[], today?: string): RowHighlight {
  const out: RowHighlight = { row: null, cells: {} };
  if (!rules?.length) return out;
  const ids = new Set(columns.map((c) => c.id));
  for (const rule of rules) {
    if (out.row) break; // a row rule already colors every remaining cell
    if (rule.columnId && (!ids.has(rule.columnId) || out.cells[rule.columnId])) continue;
    if (!ruleMatches(row, rule, ids, today)) continue;
    if (rule.columnId) out.cells[rule.columnId] = rule.color;
    else out.row = rule.color;
  }
  return out;
}

/** The color a given cell shows: its own cell rule, else the row's. */
export function cellHighlight(h: RowHighlight, columnId: string): HighlightColor | null {
  return h.cells[columnId] ?? h.row;
}

/** Column IDs the rules point at (conditions and highlighted cells). */
export function highlightColumns(rules: HighlightRule[] | undefined): string[] {
  return (rules ?? []).flatMap((r) => [...r.filters.map((f) => f.columnId), ...(r.columnId ? [r.columnId] : [])]);
}

/** Drops conditions on deleted columns, and rules whose highlighted column was deleted. */
export function cleanHighlights(rules: HighlightRule[] | undefined, columnIds: Set<string>): HighlightRule[] | undefined {
  if (!rules) return rules;
  return rules
    .filter((r) => !r.columnId || columnIds.has(r.columnId))
    .map((r) => ({ ...r, filters: r.filters.filter((f) => columnIds.has(f.columnId)) }));
}
