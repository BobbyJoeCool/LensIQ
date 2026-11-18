/**
 * Converts Notion's property schemas and values into LensIQ's small set of
 * shared shapes. The input is typed loosely on purpose: Notion adds property
 * types over time, and anything unknown must degrade to `unsupported` instead
 * of breaking the table.
 */
import type {
  CellValue,
  Column,
  ColumnType,
  FileValue,
  NotionColor,
  Schema,
  SelectOption,
} from '@lensiq/shared';

/** A Notion property value or schema entry: `{ id, type, [type]: payload }`. */
export type RawProperty = { id: string; type: string; name?: string } & Record<string, any>;

const KNOWN_TYPES = new Set<ColumnType>([
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
  'formula',
  'rollup',
  'created_time',
  'last_edited_time',
  'created_by',
  'last_edited_by',
  'people',
  'relation',
  'files',
  'unique_id',
]);

function toOption(o: any): SelectOption {
  return { id: String(o.id ?? o.name), name: String(o.name ?? ''), color: (o.color ?? 'default') as NotionColor };
}

export function plainText(richText: any[] | null | undefined): string {
  return (richText ?? []).map((t) => t?.plain_text ?? '').join('');
}

/**
 * True when rich text holds anything plain text can't round-trip: formatting,
 * colors, links, mentions or equations. LensIQ won't edit such cells (Q14).
 */
export function isRich(richText: any[] | null | undefined): boolean {
  return (richText ?? []).some((t) => {
    if (!t) return false;
    if (t.type && t.type !== 'text') return true;
    if (t.text?.link || t.href) return true;
    const a = t.annotations;
    if (!a) return false;
    return Boolean(a.bold || a.italic || a.strikethrough || a.underline || a.code) || (a.color && a.color !== 'default');
  });
}

/** Builds the cached schema from a data source's `properties` map. */
export function toSchema(properties: Record<string, RawProperty>): Schema {
  const columns: Column[] = Object.entries(properties).map(([key, p]) => {
    const known = KNOWN_TYPES.has(p.type as ColumnType);
    const column: Column = {
      id: p.id,
      name: p.name ?? key,
      type: known ? (p.type as ColumnType) : 'unsupported',
    };
    if (!known) column.notionType = p.type;
    if (p.type === 'select' || p.type === 'multi_select' || p.type === 'status') {
      column.options = (p[p.type]?.options ?? []).map(toOption);
    }
    if (p.type === 'number' && p.number?.format) column.numberFormat = p.number.format;
    if (p.type === 'relation' && p.relation?.data_source_id) column.relatedDataSourceId = String(p.relation.data_source_id);
    return column;
  });
  // Title first; otherwise keep Notion's order.
  columns.sort((a, b) => Number(b.type === 'title') - Number(a.type === 'title'));
  return { columns };
}

function toDate(d: any): CellValue {
  return d?.start ? { kind: 'date', value: { start: d.start, end: d.end ?? null } } : { kind: 'date', value: null };
}

function userName(u: any): string {
  return u?.name ?? u?.person?.email ?? 'Unknown user';
}

function toFile(f: any): FileValue {
  const file: FileValue = { name: f?.name ?? 'file', url: f?.file?.url ?? f?.external?.url ?? null };
  if (f?.type === 'file' || (f?.file && !f?.external)) file.hosted = true;
  return file;
}

/** Normalizes one Notion property value into a CellValue. */
export function toCell(p: RawProperty | undefined): CellValue {
  if (!p) return { kind: 'empty' };
  const v = p[p.type];
  switch (p.type) {
    case 'title':
    case 'rich_text': {
      const cell: CellValue = { kind: 'text', value: plainText(v) };
      if (isRich(v)) cell.rich = true;
      return cell;
    }
    case 'number':
      return { kind: 'number', value: typeof v === 'number' ? v : null };
    case 'checkbox':
      return { kind: 'boolean', value: Boolean(v) };
    case 'select':
    case 'status':
      return { kind: 'select', value: v ? toOption(v) : null };
    case 'multi_select':
      return { kind: 'multi_select', value: (v ?? []).map(toOption) };
    case 'date':
      return toDate(v);
    case 'created_time':
    case 'last_edited_time':
      return toDate(v ? { start: v } : null);
    case 'url':
    case 'email':
    case 'phone_number':
      return { kind: 'link', value: v ?? null, linkType: p.type };
    case 'people':
      return { kind: 'people', value: (v ?? []).map(userName) };
    case 'created_by':
    case 'last_edited_by':
      return { kind: 'people', value: v ? [userName(v)] : [] };
    case 'relation':
      return { kind: 'relation', value: (v ?? []).map((r: any) => String(r.id)), hasMore: Boolean(p.has_more) };
    case 'files':
      return { kind: 'files', value: (v ?? []).map(toFile) };
    case 'unique_id':
      if (v?.number == null) return { kind: 'text', value: '' };
      return { kind: 'text', value: v.prefix ? `${v.prefix}-${v.number}` : String(v.number) };
    case 'formula':
      return toComputed(v);
    case 'rollup':
      return toComputed(v);
    default:
      return { kind: 'unsupported', notionType: p.type };
  }
}

/**
 * Formula and rollup results: `{ type: 'string' | 'number' | 'boolean' | 'date' | 'array', ... }`.
 * Notion computes these; LensIQ only displays them.
 */
function toComputed(v: any): CellValue {
  if (!v?.type) return { kind: 'empty' };
  switch (v.type) {
    case 'string':
      return { kind: 'text', value: v.string ?? '' };
    case 'number':
      return { kind: 'number', value: typeof v.number === 'number' ? v.number : null };
    case 'boolean':
      return { kind: 'boolean', value: Boolean(v.boolean) };
    case 'date':
      return toDate(v.date);
    case 'array':
      return { kind: 'list', value: (v.array ?? []).map((item: any) => toCell(item)) };
    default:
      return { kind: 'unsupported', notionType: `computed:${v.type}` };
  }
}

/** Normalizes every property of a page, keyed by property ID. */
export function toCells(properties: Record<string, RawProperty>): Record<string, CellValue> {
  const cells: Record<string, CellValue> = {};
  for (const p of Object.values(properties)) cells[p.id] = toCell(p);
  return cells;
}
