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
  /** Relation columns: the data source the relation points at. */
  relatedDataSourceId?: string;
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
  /** Uploaded to Notion: its URL expires after about an hour, so links go through the API for a fresh one. */
  hosted?: boolean;
}

/**
 * A normalized cell value. Every Notion property value is reduced to one of
 * these shapes, so the front end only has to render this small set.
 */
export type CellValue =
  /** `rich` is true when the Notion text has formatting, links, mentions or equations (read-only in LensIQ). */
  | { kind: 'text'; value: string; rich?: boolean }
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

/** Body of `PATCH /api/databases/:id/rows/:pageId`: set one cell. */
export interface UpdateCellRequest {
  columnId: string;
  /** The new value, in the same shape the app displays. */
  value: CellValue;
  /**
   * The value Bob saw before editing. If Notion's current value is different,
   * the API answers 409 with a `ConflictResponse` instead of overwriting.
   */
  expected: CellValue;
  /** Skip the conflict check ("keep mine" in the conflict dialog). */
  force?: boolean;
}

/** 409 body when a cell changed in Notion since Bob loaded it. */
export interface ConflictResponse {
  error: 'conflict';
  message: string;
  columnId: string;
  /** The value now in Notion. */
  current: CellValue;
  /** The whole row as it is now in Notion. */
  row: Row;
}

/** One changed property in an `UpdateRowRequest`. */
export interface CellChange {
  columnId: string;
  value: CellValue;
  /** The value Bob started editing from, for the conflict check. */
  expected: CellValue;
}

/**
 * Body of `PATCH /api/databases/:id/rows/:pageId/cells`: save several
 * properties at once (the row panel's Save, #57). Every change is checked
 * first; if any property changed in Notion, nothing is written and the API
 * answers 409 with a `RowConflictResponse`.
 */
export interface UpdateRowRequest {
  changes: CellChange[];
  /** Skip the conflict check (overwrite with Bob's values). */
  force?: boolean;
}

/** 409 body when one or more of the saved properties changed in Notion. */
export interface RowConflictResponse {
  error: 'conflict';
  message: string;
  /** Each property that changed in Notion, with its value there now. */
  conflicts: { columnId: string; current: CellValue }[];
  /** The whole row as it is now in Notion. */
  row: Row;
}

/** Body of `POST /api/databases/:id/rows`. Cells left out stay empty. */
export interface CreateRowRequest {
  cells: Record<string, CellValue>;
}

/** Sync modes for `GET /api/databases/:id/rows?sync=`. */
export type SyncMode = 'none' | 'changes' | 'full';

export interface ApiError {
  error: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Views and dashboards (Phase 3)
// ---------------------------------------------------------------------------

export type ViewType = 'table' | 'board' | 'chart' | 'calendar';

/**
 * Filter operators. Which ones apply depends on the column's value kind
 * (see web/src/views/query.ts); a filter whose column is gone is ignored and
 * the view is flagged.
 */
export type FilterOp =
  | 'is_empty'
  | 'is_not_empty'
  // text, link
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  // number
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  // select, status, multi-select (value: option IDs)
  | 'any_of'
  | 'none_of'
  // checkbox
  | 'checked'
  | 'unchecked'
  // date (value: ISO date for before/after; a day count for past/next)
  | 'before'
  | 'after'
  | 'on_or_before'
  | 'on_or_after'
  | 'past_days'
  | 'next_days';

export interface Filter {
  id: string;
  /** Column (property) ID, never the name, so renames don't break views. */
  columnId: string;
  op: FilterOp;
  value?: string | number | string[];
}

export interface Sort {
  columnId: string;
  direction: 'asc' | 'desc';
}

interface ViewConfigBase {
  filters: Filter[];
  /** How filters combine. */
  filterMode: 'and' | 'or';
  sorts: Sort[];
}

/** Soft background colors for highlight rules (#51), readable in light and dark mode. */
export type HighlightColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';

/**
 * A table highlight rule (#51): rows matching its conditions (built like
 * filters) get a background color, on the whole row or on one column's cell.
 * A rule with no complete conditions highlights nothing.
 */
export interface HighlightRule {
  id: string;
  filters: Filter[];
  filterMode: 'and' | 'or';
  color: HighlightColor;
  /** The column whose cell is colored, or null for the whole row. */
  columnId: string | null;
}

export interface TableConfig extends ViewConfigBase {
  /** Column IDs hidden in this view. New columns show by default. */
  hidden: string[];
  /** Highlight rules in order; when several match, the first wins (#51). Missing means none. */
  highlights?: HighlightRule[];
  /**
   * A status or select column whose option colors tint each row (#64).
   * Highlight rules win over it. Missing or null means none.
   */
  colorBy?: string | null;
}

export interface BoardConfig extends ViewConfigBase {
  /** A select or status column. Null until chosen. */
  groupBy: string | null;
  /** Columns shown on each card besides the title. */
  cardFields: string[];
  hideEmptyGroups: boolean;
}

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'stat';
export type Aggregation = 'count' | 'sum' | 'avg' | 'min' | 'max';
export type DateGrouping = 'day' | 'week' | 'month' | 'year';

export interface ChartConfig extends ViewConfigBase {
  chartType: ChartType;
  /** Category or time column for the x-axis (or pie slices). Unused by stat. */
  x: string | null;
  dateGrouping: DateGrouping;
  aggregation: Aggregation;
  /** Number column for sum/avg/min/max. Unused by count. */
  y: string | null;
  /** Optional select/status/checkbox column to split bars or lines into series. */
  splitBy: string | null;
  horizontal: boolean;
  stacked: boolean;
  /** Line/area: running total. */
  cumulative: boolean;
  /** Category order for bar and pie: by label (x) or by value, largest first. */
  sortBy: 'x' | 'value';
  /** Bar/pie: hide categories with no rows. */
  hideEmpty: boolean;
  /**
   * Values written on the chart without hovering (#56). Percent is each
   * value's share of the whole chart; it's offered for count and sum on bar
   * and donut charts. Missing means off.
   */
  showValues?: 'off' | 'value' | 'percent' | 'both';
  /**
   * A total (#52): an extra Total bar on bar charts, the total in the middle
   * of a donut, and in the header of line and area charts. Count and sum only.
   */
  showTotal?: boolean;
}

export interface CalendarConfig extends ViewConfigBase {
  /** A date column. Null until chosen. */
  dateColumn: string | null;
  /**
   * A status or select column whose option color colors each event (#55).
   * Null shows every event in the default color. Missing (views saved before
   * v1.2.0) means the first status column, if any.
   */
  colorBy?: string | null;
}

export type ViewConfig = TableConfig | BoardConfig | ChartConfig | CalendarConfig;

/** A page in a relation's target database, for showing titles and picking links. */
export interface RelationOption {
  id: string;
  title: string;
}

/** `GET /api/databases/:id/relations/:columnId`. */
export interface RelationOptionsResponse {
  /** False when the related database isn't shared with the LensIQ connection. */
  available: boolean;
  options: RelationOption[];
}

export interface View {
  id: string;
  /** Data source ID of the database this view shows. */
  databaseId: string;
  name: string;
  type: ViewType;
  config: ViewConfig;
  /** Tab order within the database. */
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateViewRequest {
  databaseId: string;
  name: string;
  type: ViewType;
  config?: ViewConfig;
}

export interface UpdateViewRequest {
  name?: string;
  config?: ViewConfig;
  position?: number;
}

export type TileSize = 'small' | 'medium' | 'large' | 'full';
/** Tile height on desktop: ½, 1 or 2 standard rows (#54). Phones size tiles to their content. */
export type TileHeight = 'short' | 'standard' | 'tall';

export interface DashboardTile {
  id: string;
  viewId: string;
  /** Width. */
  size: TileSize;
  /** Missing on tiles saved before v1.1.0; treated as `standard`. */
  height?: TileHeight;
}

export interface Dashboard {
  id: string;
  name: string;
  /** Order in the sidebar (#50); the first dashboard is where the app opens. */
  position: number;
  /** Tiles in order; the grid flows them left to right, one column on a phone. */
  tiles: DashboardTile[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateDashboardRequest {
  name: string;
}

/** `GET /api/export`: every view and dashboard, for backup or moving servers (Q24). */
export interface ExportFile {
  app: 'lensiq';
  version: 1;
  exportedAt: string;
  views: View[];
  dashboards: Dashboard[];
}

/** `POST /api/import` result. */
export interface ImportResult {
  viewsCreated: number;
  dashboardsCreated: number;
  /** Views skipped because their database isn't connected here. */
  viewsSkipped: number;
}

export interface UpdateDashboardRequest {
  name?: string;
  tiles?: DashboardTile[];
  /** Move to this index in the sidebar order (#50). */
  position?: number;
}
