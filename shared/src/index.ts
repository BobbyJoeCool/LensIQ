/**
 * Types shared by the API and the web app.
 *
 * This package is type-only: nothing here exists at runtime, so the API's
 * compiled output never imports it.
 */

/** Notion's named colors for select, multi-select and status options. */
export type NotionColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red';

/** Column types LensIQ understands. Anything else is shown as `unsupported`. */
export type ColumnType =
  | 'title'
  | 'rich_text'
  | 'number'
  | 'select'
  | 'status'
  | 'multi_select'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone_number'
  | 'formula'
  | 'rollup'
  | 'created_time'
  | 'last_edited_time'
  | 'created_by'
  | 'last_edited_by'
  | 'people'
  | 'relation'
  | 'files'
  | 'unique_id'
  | 'unsupported';

export interface SelectOption {
  id: string;
  name: string;
  color: NotionColor;
}

/** One column of a Notion data source, as cached in the schema. */
export interface Column {
  /** Notion's stable property ID. Saved views refer to columns by this, never by name. */
  id: string;
  name: string;
  type: ColumnType;
  /** The raw Notion type when `type` is `unsupported`, for display and debugging. */
  notionType?: string;
  /** Options for select, multi-select and status columns. */
  options?: SelectOption[];
  /** Notion number format, e.g. `dollar`, `percent`, `number`. */
  numberFormat?: string;
}

export interface Schema {
  /** Columns in display order: the title column first, then Notion's order. */
  columns: Column[];
}

export interface DateValue {
  start: string;
  end: string | null;
}

export interface FileValue {
  name: string;
  url: string | null;
}

/**
 * A normalized cell value. Every Notion property value is reduced to one of
 * these shapes, so the front end only has to render this small set.
 */
export type CellValue =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number | null }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; value: DateValue | null }
  | { kind: 'select'; value: SelectOption | null }
  | { kind: 'multi_select'; value: SelectOption[] }
  | { kind: 'link'; value: string | null; linkType: 'url' | 'email' | 'phone_number' }
  | { kind: 'people'; value: string[] }
  | { kind: 'relation'; value: string[]; hasMore: boolean }
  | { kind: 'files'; value: FileValue[] }
  | { kind: 'list'; value: CellValue[] }
  | { kind: 'empty' }
  | { kind: 'unsupported'; notionType: string };

export interface Row {
  /** Notion page ID. */
  id: string;
  /** Link to open the page in Notion. */
  url: string;
  lastEditedTime: string;
  /** Cell values keyed by column (property) ID. */
  cells: Record<string, CellValue>;
}

/** A Notion data source connected to LensIQ. */
export interface DatabaseSummary {
  /** Notion data source ID. LensIQ's primary key for a database. */
  id: string;
  /** The Notion database that contains this data source. */
  databaseId: string | null;
  name: string;
  /** ISO time of the last full load from Notion, or null if never loaded. */
  lastSyncedAt: string | null;
  rowCount: number;
}

export interface DatabaseDetail extends DatabaseSummary {
  schema: Schema;
}

export interface RowsResponse {
  database: DatabaseDetail;
  rows: Row[];
}

export interface AddDatabaseRequest {
  /** A Notion database URL, database ID, or data source ID. */
  idOrUrl: string;
}

export interface ApiError {
  error: string;
  message: string;
}
