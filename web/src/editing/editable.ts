import type { CellValue, Column, ColumnType } from '@lensiq/shared';

/** Column types the app can edit. Mirrors api/src/notion/write.ts. */
const EDITABLE: ReadonlySet<ColumnType> = new Set<ColumnType>([
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

export function isEditableType(column: Column): boolean {
  return EDITABLE.has(column.type);
}

/** Editable for this cell: the type is editable and, for text, it has no formatting (Q14). */
export function canEdit(column: Column, value: CellValue | undefined): boolean {
  if (!isEditableType(column)) return false;
  return !(value?.kind === 'text' && value.rich);
}

/** The value an empty cell of this column has, in the shape its editor works with. */
export function emptyValue(column: Column): CellValue {
  switch (column.type) {
    case 'title':
    case 'rich_text':
      return { kind: 'text', value: '' };
    case 'number':
      return { kind: 'number', value: null };
    case 'checkbox':
      return { kind: 'boolean', value: false };
    case 'select':
    case 'status':
      return { kind: 'select', value: null };
    case 'multi_select':
      return { kind: 'multi_select', value: [] };
    case 'date':
      return { kind: 'date', value: null };
    case 'url':
    case 'email':
    case 'phone_number':
      return { kind: 'link', value: null, linkType: column.type };
    default:
      return { kind: 'empty' };
  }
}

/** A cell's value, or the column's empty value when the row has none. */
export function valueOf(column: Column, cells: Record<string, CellValue>): CellValue {
  const v = cells[column.id];
  return v && v.kind !== 'empty' ? v : emptyValue(column);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm:00±HH:MM` in the browser's time zone, for Notion date-times. */
export function localIso(date: string, time: string, now = new Date(`${date}T${time}`)): string {
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${date}T${time}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Splits a Notion date string into the date and time inputs' values (local time). */
export function splitIso(iso: string): { date: string; time: string | null } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { date: iso, time: null };
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Parses typed number text. Accepts commas, a currency sign and a trailing %. */
export function parseNumber(text: string, format?: string): number | null | 'invalid' {
  const cleaned = text.replace(/[,\s$€£¥₹₩]/g, '').replace(/%$/, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 'invalid';
  // Notion stores percentages as fractions: 25% is 0.25.
  return format === 'percent' ? n / 100 : n;
}

/** The number as the editor shows it (percent as 25, not 0.25). */
export function numberToText(value: number | null, format?: string): string {
  if (value === null) return '';
  return String(format === 'percent' ? Math.round(value * 100 * 1e6) / 1e6 : value);
}
