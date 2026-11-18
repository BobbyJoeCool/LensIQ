/**
 * Turns LensIQ cell values back into Notion property payloads for writes.
 * This is the one place that decides which column types are editable.
 */
import type { CellValue, Column, ColumnType } from '@lensiq/shared';
import { AppError } from '../errors.js';

/** Column types LensIQ can write. Everything else is computed by Notion or out of scope. */
export const EDITABLE_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  'title',
  'rich_text',
  'number',
  'select',
  'status',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'email',
  'phone_number',
]);

export function isEditable(column: Column): boolean {
  return EDITABLE_TYPES.has(column.type);
}

/** Notion caps one rich text object at 2000 characters. */
const RICH_TEXT_CHUNK = 2000;
const MAX_TEXT = 100 * RICH_TEXT_CHUNK; // Notion allows 100 rich text objects per property.

function richText(value: string): object[] {
  if (value.length > MAX_TEXT) {
    throw new AppError(400, 'too_long', `Text is too long for Notion (limit ${MAX_TEXT.toLocaleString()} characters).`);
  }
  const chunks: object[] = [];
  for (let i = 0; i < value.length; i += RICH_TEXT_CHUNK) {
    chunks.push({ type: 'text', text: { content: value.slice(i, i + RICH_TEXT_CHUNK) } });
  }
  return chunks;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function checkDate(s: string, label: string): string {
  if (!DATE_RE.test(s) || Number.isNaN(new Date(s).getTime())) {
    throw new AppError(400, 'bad_value', `${label} must be a date like 2026-11-18 or 2026-11-18T09:30:00-06:00.`);
  }
  return s;
}

function wrongKind(column: Column, value: CellValue): never {
  throw new AppError(400, 'bad_value', `"${column.name}" can't be set to a ${value.kind} value.`);
}

/**
 * Builds `{ [type]: payload }` for one property. Throws a 400 AppError for a
 * value that doesn't fit the column, and a 422 for read-only columns.
 */
export function toNotionProperty(column: Column, value: CellValue): Record<string, unknown> {
  if (!isEditable(column)) {
    throw new AppError(422, 'read_only', `"${column.name}" is calculated or managed by Notion and can't be edited here.`);
  }
  const empty = value.kind === 'empty';

  switch (column.type) {
    case 'title':
    case 'rich_text': {
      if (empty) return { [column.type]: [] };
      if (value.kind !== 'text') wrongKind(column, value);
      return { [column.type]: richText(value.value) };
    }
    case 'number': {
      if (empty) return { number: null };
      if (value.kind !== 'number') wrongKind(column, value);
      if (value.value !== null && !Number.isFinite(value.value)) {
        throw new AppError(400, 'bad_value', `"${column.name}" must be a number.`);
      }
      return { number: value.value };
    }
    case 'checkbox': {
      if (value.kind !== 'boolean') wrongKind(column, value);
      return { checkbox: value.value };
    }
    case 'select':
    case 'status': {
      if (empty || (value.kind === 'select' && value.value === null)) {
        if (column.type === 'status') {
          // Notion requires a status; clearing isn't allowed.
          throw new AppError(400, 'bad_value', `"${column.name}" is a status and can't be empty.`);
        }
        return { select: null };
      }
      if (value.kind !== 'select' || !value.value) wrongKind(column, value);
      const opt = value.value;
      const existing = column.options?.find((o) => o.id === opt.id) ?? column.options?.find((o) => o.name === opt.name);
      if (existing) return { [column.type]: { id: existing.id } };
      if (column.type === 'status') {
        throw new AppError(400, 'bad_value', `"${opt.name}" isn't one of the status options. New statuses are added in Notion.`);
      }
      const name = opt.name.trim();
      if (!name) throw new AppError(400, 'bad_value', 'An option needs a name.');
      if (name.includes(',')) throw new AppError(400, 'bad_value', 'Notion option names can’t contain commas.');
      return { select: { name: name.slice(0, 100) } }; // Notion creates the option.
    }
    case 'multi_select': {
      if (empty) return { multi_select: [] };
      if (value.kind !== 'multi_select') wrongKind(column, value);
      return {
        multi_select: value.value.map((opt) => {
          const existing =
            column.options?.find((o) => o.id === opt.id) ?? column.options?.find((o) => o.name === opt.name);
          if (existing) return { id: existing.id };
          const name = opt.name.trim();
          if (!name) throw new AppError(400, 'bad_value', 'An option needs a name.');
          if (name.includes(',')) throw new AppError(400, 'bad_value', 'Notion option names can’t contain commas.');
          return { name: name.slice(0, 100) };
        }),
      };
    }
    case 'date': {
      if (empty || (value.kind === 'date' && value.value === null)) return { date: null };
      if (value.kind !== 'date' || !value.value) wrongKind(column, value);
      const start = checkDate(value.value.start, 'Start');
      const end = value.value.end ? checkDate(value.value.end, 'End') : null;
      if (end && new Date(end).getTime() < new Date(start).getTime()) {
        throw new AppError(400, 'bad_value', 'The end date is before the start date.');
      }
      return { date: { start, end } };
    }
    case 'url':
    case 'email':
    case 'phone_number': {
      if (empty) return { [column.type]: null };
      if (value.kind !== 'link' && value.kind !== 'text') wrongKind(column, value);
      const s = (value.value ?? '').trim();
      if (!s) return { [column.type]: null };
      if (column.type === 'email' && !/^[^\s@]+@[^\s@]+$/.test(s)) {
        throw new AppError(400, 'bad_value', `"${s}" doesn’t look like an email address.`);
      }
      if (s.length > 2000) throw new AppError(400, 'too_long', 'That value is too long for Notion.');
      return { [column.type]: s };
    }
    default:
      throw new AppError(422, 'read_only', `"${column.name}" can't be edited here.`);
  }
}

/** Builds a page's `properties` object from several cells (for new rows). */
export function toNotionProperties(columns: Column[], cells: Record<string, CellValue>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [columnId, value] of Object.entries(cells)) {
    const column = columns.find((c) => c.id === columnId);
    if (!column) throw new AppError(400, 'unknown_column', `No column with ID "${columnId}". Try Refresh.`);
    props[columnId] = toNotionProperty(column, value);
  }
  return props;
}

/** Stable JSON for comparing two cell values regardless of key order. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/**
 * True when two cell values mean the same thing. Options compare by ID (a
 * renamed or recolored option is still the same choice), and empty-ish values
 * (empty, '', null, []) are equal to each other.
 */
export function sameCell(a: CellValue | undefined, b: CellValue | undefined): boolean {
  const isBlank = (c: CellValue | undefined) =>
    !c ||
    c.kind === 'empty' ||
    (c.kind === 'text' && c.value === '') ||
    ((c.kind === 'number' || c.kind === 'date' || c.kind === 'select' || c.kind === 'link') && c.value === null) ||
    (c.kind === 'multi_select' && c.value.length === 0);
  if (isBlank(a) && isBlank(b)) return true;
  if (!a || !b) return false;
  if (a.kind === 'select' && b.kind === 'select') return a.value?.id === b.value?.id;
  if (a.kind === 'multi_select' && b.kind === 'multi_select') {
    const ids = (c: typeof a) => c.value.map((o) => o.id).sort().join('\u0000');
    return ids(a) === ids(b);
  }
  if (a.kind === 'text' && b.kind === 'text') return a.value === b.value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
