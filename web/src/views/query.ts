/**
 * Filtering and sorting for every view type (table, board, chart). Works on
 * cached rows in the browser; Notion is never queried per view.
 */
import type { CellValue, Column, Filter, FilterOp, Row, Sort } from '@lensiq/shared';

/** How a column's values behave for filtering, sorting and charts. */
export type ValueKind = 'text' | 'number' | 'select' | 'multi' | 'checkbox' | 'date' | 'other';

const TYPE_KIND: Partial<Record<Column['type'], ValueKind>> = {
  title: 'text',
  rich_text: 'text',
  url: 'text',
  email: 'text',
  phone_number: 'text',
  unique_id: 'text',
  people: 'text',
  created_by: 'text',
  last_edited_by: 'text',
  number: 'number',
  select: 'select',
  status: 'select',
  multi_select: 'multi',
  checkbox: 'checkbox',
  date: 'date',
  created_time: 'date',
  last_edited_time: 'date',
};

/** The value kind of a column. Formulas and rollups take the kind of their first non-empty value. */
export function columnKind(column: Column, rows: Row[] = []): ValueKind {
  const known = TYPE_KIND[column.type];
  if (known) return known;
  if (column.type === 'formula' || column.type === 'rollup') {
    for (const r of rows) {
      const k = cellKind(r.cells[column.id]);
      if (k) return k;
    }
  }
  return 'other';
}

function cellKind(v: CellValue | undefined): ValueKind | null {
  switch (v?.kind) {
    case 'text':
      return v.value ? 'text' : null;
    case 'number':
      return v.value === null ? null : 'number';
    case 'boolean':
      return 'checkbox';
    case 'date':
      return v.value ? 'date' : null;
    default:
      return null;
  }
}

export const OPS_BY_KIND: Record<ValueKind, FilterOp[]> = {
  text: ['contains', 'not_contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
  select: ['any_of', 'none_of', 'is_empty', 'is_not_empty'],
  multi: ['any_of', 'none_of', 'is_empty', 'is_not_empty'],
  checkbox: ['checked', 'unchecked'],
  date: ['before', 'after', 'on_or_before', 'on_or_after', 'past_days', 'next_days', 'is_empty', 'is_not_empty'],
  other: ['is_empty', 'is_not_empty'],
};

export const OP_LABELS: Record<FilterOp, string> = {
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  contains: 'contains',
  not_contains: 'does not contain',
  equals: 'is',
  not_equals: 'is not',
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  any_of: 'is any of',
  none_of: 'is none of',
  checked: 'is checked',
  unchecked: 'is not checked',
  before: 'is before',
  after: 'is after',
  on_or_before: 'is on or before',
  on_or_after: 'is on or after',
  past_days: 'is within the past (days)',
  next_days: 'is within the next (days)',
};

/** Operators that need no value. */
export const NO_VALUE_OPS = new Set<FilterOp>(['is_empty', 'is_not_empty', 'checked', 'unchecked']);

/** Plain text for a cell, used by text filters, text sorting and chart categories. */
export function cellText(v: CellValue | undefined): string {
  if (!v) return '';
  switch (v.kind) {
    case 'text':
      return v.value;
    case 'link':
      return v.value ?? '';
    case 'number':
      return v.value === null ? '' : String(v.value);
    case 'boolean':
      return v.value ? 'Checked' : 'Unchecked';
    case 'date':
      return v.value?.start ?? '';
    case 'select':
      return v.value?.name ?? '';
    case 'multi_select':
      return v.value.map((o) => o.name).join(', ');
    case 'people':
      return v.value.join(', ');
    case 'files':
      return v.value.map((f) => f.name).join(', ');
    case 'relation':
      return v.value.length ? String(v.value.length) : '';
    case 'list':
      return v.value.map(cellText).join(', ');
    default:
      return '';
  }
}

export function cellNumber(v: CellValue | undefined): number | null {
  if (v?.kind === 'number') return v.value;
  if (v?.kind === 'list') {
    // Rollup "show original" of numbers: total them, as Notion's sum would.
    const nums = v.value.map(cellNumber).filter((n): n is number => n !== null);
    return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  }
  return null;
}

/** Local calendar day (YYYY-MM-DD) of a date cell's start, or null. */
export function cellDay(v: CellValue | undefined): string | null {
  if (v?.kind !== 'date' || !v.value) return null;
  return toDay(v.value.start);
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Calendar day in local time; date-only strings stay as they are. */
export function toDay(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : dayOf(new Date(iso));
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return dayOf(new Date(y, m - 1, d + n));
}

export function isEmptyCell(v: CellValue | undefined): boolean {
  if (!v || v.kind === 'empty') return true;
  switch (v.kind) {
    case 'text':
      return v.value === '';
    case 'number':
    case 'date':
    case 'select':
    case 'link':
      return v.value === null || v.value === '';
    case 'multi_select':
    case 'people':
    case 'relation':
    case 'files':
    case 'list':
      return v.value.length === 0;
    case 'boolean':
      return false;
    default:
      return true;
  }
}

function optionIds(v: CellValue | undefined): string[] {
  if (v?.kind === 'select') return v.value ? [v.value.id] : [];
  if (v?.kind === 'multi_select') return v.value.map((o) => o.id);
  return [];
}

/** True when a filter has what it needs to apply. Incomplete filters are skipped, as in Notion. */
export function isComplete(f: Filter): boolean {
  if (NO_VALUE_OPS.has(f.op)) return true;
  if (Array.isArray(f.value)) return f.value.length > 0;
  return f.value !== undefined && f.value !== '' && !(typeof f.value === 'number' && Number.isNaN(f.value));
}

export function matches(row: Row, filter: Filter, today = dayOf(new Date())): boolean {
  const v = row.cells[filter.columnId];
  const { op, value } = filter;
  switch (op) {
    case 'is_empty':
      return isEmptyCell(v);
    case 'is_not_empty':
      return !isEmptyCell(v);
    case 'contains':
      return cellText(v).toLowerCase().includes(String(value).toLowerCase());
    case 'not_contains':
      return !cellText(v).toLowerCase().includes(String(value).toLowerCase());
    case 'equals':
      return cellText(v).toLowerCase() === String(value).toLowerCase();
    case 'not_equals':
      return cellText(v).toLowerCase() !== String(value).toLowerCase();
    case 'checked':
      return v?.kind === 'boolean' && v.value;
    case 'unchecked':
      return !(v?.kind === 'boolean' && v.value);
    case 'any_of': {
      const want = new Set(value as string[]);
      return optionIds(v).some((id) => want.has(id));
    }
    case 'none_of': {
      const avoid = new Set(value as string[]);
      return !optionIds(v).some((id) => avoid.has(id));
    }
  }
  if (op === 'eq' || op === 'neq' || op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
    const n = cellNumber(v);
    const target = Number(value);
    if (n === null) return op === 'neq';
    return op === 'eq' ? n === target : op === 'neq' ? n !== target : op === 'gt' ? n > target : op === 'gte' ? n >= target : op === 'lt' ? n < target : n <= target;
  }
  const day = cellDay(v);
  if (day === null) return false;
  switch (op) {
    case 'before':
      return day < String(value);
    case 'after':
      return day > String(value);
    case 'on_or_before':
      return day <= String(value);
    case 'on_or_after':
      return day >= String(value);
    case 'past_days':
      return day <= today && day >= addDays(today, -Number(value));
    case 'next_days':
      return day >= today && day <= addDays(today, Number(value));
  }
  return true;
}

export interface QueryResult {
  rows: Row[];
  /** Column IDs the view refers to that no longer exist in the schema. */
  missing: string[];
}

/** Applies filters (and/or) and sorts. Parts that point at a missing column are skipped and reported. */
export function applyQuery(
  rows: Row[],
  columns: Column[],
  { filters, filterMode, sorts }: { filters: Filter[]; filterMode: 'and' | 'or'; sorts: Sort[] },
  today?: string,
): QueryResult {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const missing = new Set<string>();
  const active = filters.filter((f) => {
    if (!byId.has(f.columnId)) {
      missing.add(f.columnId);
      return false;
    }
    return isComplete(f);
  });
  let out = rows;
  if (active.length) {
    out = rows.filter((r) =>
      filterMode === 'or' ? active.some((f) => matches(r, f, today)) : active.every((f) => matches(r, f, today)),
    );
  }
  const activeSorts = sorts.filter((s) => {
    if (!byId.has(s.columnId)) {
      missing.add(s.columnId);
      return false;
    }
    return true;
  });
  if (activeSorts.length) {
    const comparators = activeSorts.map((s) => {
      const column = byId.get(s.columnId)!;
      const cmp = comparator(column, rows);
      const sign = s.direction === 'desc' ? -1 : 1;
      return (a: Row, b: Row) => {
        const va = a.cells[column.id];
        const vb = b.cells[column.id];
        // Empty values always go last, whatever the direction.
        const ea = isEmptyCell(va);
        const eb = isEmptyCell(vb);
        if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
        return sign * cmp(va, vb);
      };
    });
    out = [...out].sort((a, b) => {
      for (const c of comparators) {
        const r = c(a, b);
        if (r !== 0) return r;
      }
      return 0;
    });
  }
  return { rows: out, missing: [...missing] };
}

function comparator(column: Column, rows: Row[]): (a: CellValue | undefined, b: CellValue | undefined) => number {
  const kind = columnKind(column, rows);
  if (kind === 'number') return (a, b) => (cellNumber(a) ?? 0) - (cellNumber(b) ?? 0);
  if (kind === 'date') return (a, b) => dateValue(a) - dateValue(b);
  if (kind === 'checkbox') return (a, b) => Number(a?.kind === 'boolean' && a.value) - Number(b?.kind === 'boolean' && b.value);
  if (kind === 'select' || kind === 'multi') {
    // Notion sorts options by their order in the column, not alphabetically.
    const order = new Map((column.options ?? []).map((o, i) => [o.id, i]));
    const rank = (v: CellValue | undefined) => {
      const id = optionIds(v)[0];
      return id === undefined ? Number.MAX_SAFE_INTEGER : (order.get(id) ?? Number.MAX_SAFE_INTEGER - 1);
    };
    return (a, b) => rank(a) - rank(b);
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return (a, b) => collator.compare(cellText(a), cellText(b));
}

function dateValue(v: CellValue | undefined): number {
  if (v?.kind !== 'date' || !v.value) return 0;
  const s = v.value.start;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d).getTime();
  }
  return new Date(s).getTime();
}
