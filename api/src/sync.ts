import type {
  CellValue,
  CreateRowRequest,
  DatabaseDetail,
  Row,
  RelationOptionsResponse,
  RowsResponse,
  SyncMode,
  UpdateCellRequest,
  UpdateRowRequest,
} from '@lensiq/shared';
import { AppError } from './errors.js';
import type { NotionSource } from './notion/source.js';
import { sameCell, toNotionProperties, toNotionProperty } from './notion/write.js';
import type { Store, StoredRow } from './store.js';

/** Notion rounds last-edited times to the minute, so incremental queries look back further than the cursor. */
const LOOKBACK_MS = 2 * 60_000;
/** Several open tabs polling at once share one incremental sync within this window. */
const CHANGES_COOLDOWN_MS = 15_000;

/**
 * Keeps the SQLite cache in step with Notion and sends edits to Notion.
 *
 * Reads: a full load when a database is added, opened in the app, or
 * refreshed; an incremental sync (rows edited since the last sync) every 60
 * seconds while it stays open.
 *
 * Writes: every edit reads the page from Notion first and compares the edited
 * cell with the value the user started from (Q12). A different value is a
 * conflict; otherwise the edit is written and the cache updated.
 */
export class SyncService {
  /** One in-flight load per database and kind, so parallel requests share it. */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly store: Store,
    private readonly notion: NotionSource,
    private readonly now: () => number = Date.now,
  ) {}

  /** Resolves a pasted ID, registers the database and does its first full load. */
  async addDatabase(idOrUrl: string): Promise<DatabaseDetail> {
    const { dataSourceId, databaseId } = await this.notion.resolve(idOrUrl);
    if (this.store.getDatabase(dataSourceId)) {
      throw new AppError(409, 'already_connected', 'That database is already connected.');
    }
    const { name, schema } = await this.notion.fetchSchema(dataSourceId);
    this.store.addDatabase({ id: dataSourceId, databaseId, name, schema });
    await this.fullLoad(dataSourceId);
    return this.requireDatabase(dataSourceId);
  }

  private once(key: string, work: () => Promise<void>): Promise<void> {
    const running = this.inFlight.get(key);
    if (running) return running;
    const job = work().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, job);
    return job;
  }

  /** Re-reads the schema and every row from Notion and replaces the cache. */
  fullLoad(id: string): Promise<void> {
    return this.once(`full:${id}`, async () => {
      this.requireDatabase(id);
      const startedAt = new Date(this.now()).toISOString();
      const { name, schema } = await this.notion.fetchSchema(id);
      const rows = await this.notion.fetchRows(id);
      this.store.replaceAll(id, name, schema, rows, startedAt);
      await this.refreshTitles(schema.columns.flatMap((c) => (c.relatedDataSourceId ? [c.relatedDataSourceId] : [])));
    });
  }

  /**
   * Re-reads the titles of related data sources (Q20). A source Notion refuses
   * (not shared with the connection) is remembered as unavailable; any other
   * failure keeps the old titles, so a hiccup never fails the sync.
   */
  private async refreshTitles(dataSourceIds: string[]): Promise<void> {
    for (const ds of new Set(dataSourceIds)) {
      try {
        this.store.replaceTitles(ds, await this.notion.fetchTitles(ds), new Date(this.now()).toISOString());
      } catch (err) {
        if (err instanceof AppError && (err.statusCode === 403 || err.statusCode === 404)) {
          this.store.replaceTitles(ds, null, new Date(this.now()).toISOString());
        }
      }
    }
  }

  /** Titles to show for a relation column and pick from. Reads Notion the first time. */
  async relationOptions(id: string, columnId: string): Promise<RelationOptionsResponse> {
    const db = this.requireDatabase(id);
    const column = db.schema.columns.find((c) => c.id === columnId);
    if (!column || column.type !== 'relation') throw new AppError(404, 'unknown_column', 'That relation column no longer exists. Try Refresh.');
    if (!column.relatedDataSourceId) return { available: false, options: [] };
    let cached = this.store.getTitles(column.relatedDataSourceId);
    if (!cached) {
      await this.refreshTitles([column.relatedDataSourceId]);
      cached = this.store.getTitles(column.relatedDataSourceId) ?? { available: false, options: [] };
    }
    return cached;
  }

  /**
   * A fresh URL for a file in a row: Notion-hosted file links expire after
   * about an hour, so the page is read again whenever a file is opened (#31).
   */
  async freshFileUrl(id: string, pageId: string, columnId: string, index: number): Promise<string> {
    this.requireDatabase(id);
    this.requireRow(id, pageId);
    const row = await this.readRow(id, pageId);
    const cell = row.cells[columnId];
    const file = cell?.kind === 'files' ? cell.value[index] : undefined;
    if (!file?.url) throw new AppError(404, 'file_not_found', 'That file is no longer attached in Notion.');
    return file.url;
  }

  /** Fetches rows edited since the last sync. Falls back to a full load if never synced. */
  syncChanges(id: string): Promise<void> {
    const full = this.inFlight.get(`full:${id}`);
    if (full) return full;
    return this.once(`changes:${id}`, async () => {
      this.requireDatabase(id);
      const cursor = this.store.getChangesCursor(id);
      if (!cursor) return this.fullLoad(id);
      if (this.now() - new Date(cursor).getTime() < CHANGES_COOLDOWN_MS) return;
      const startedAt = new Date(this.now()).toISOString();
      const since = new Date(new Date(cursor).getTime() - LOOKBACK_MS).toISOString();
      const { name, schema } = await this.notion.fetchSchema(id);
      const rows = await this.notion.fetchChangedRows(id, since);
      this.store.applyChanges(id, name, schema, rows, startedAt);
    });
  }

  /** Cached rows after the requested sync. A never-loaded database always gets a full load. */
  async getRows(id: string, mode: SyncMode = 'none'): Promise<RowsResponse> {
    const db = this.requireDatabase(id);
    if (mode === 'full' || db.lastSyncedAt === null) await this.fullLoad(id);
    else if (mode === 'changes') await this.syncChanges(id);
    return { database: this.requireDatabase(id), rows: this.store.getRows(id) };
  }

  /** Sets one cell in Notion, with the conflict check unless `force` is set. */
  async updateCell(id: string, pageId: string, req: UpdateCellRequest): Promise<Row> {
    const db = this.requireDatabase(id);
    const cached = this.requireRow(id, pageId);
    const column = db.schema.columns.find((c) => c.id === req.columnId);
    if (!column) throw new AppError(400, 'unknown_column', 'That column no longer exists. Try Refresh.');
    // Validate before touching Notion, so a bad value costs no requests.
    const property = toNotionProperty(column, req.value);

    let base: CellValue | undefined = cached.cells[column.id];
    if (!req.force) {
      const current = await this.readRow(id, pageId);
      base = current.cells[column.id];
      if (!sameCell(base, req.expected)) {
        throw new AppError(409, 'conflict', `"${column.name}" was changed in Notion since you loaded it.`, {
          columnId: column.id,
          current: base ?? { kind: 'empty' },
          row: toPublicRow(current),
        });
      }
      if (sameCell(base, req.value)) return toPublicRow(current); // nothing to write
    }
    if (base?.kind === 'text' && base.rich) {
      throw new AppError(422, 'rich_text', `"${column.name}" has formatting or links. Edit it in Notion so nothing is lost.`);
    }

    const updated = await this.writeRow(id, pageId, { [column.id]: property });
    await this.refreshSchemaIfNewOptions(id, [req.value]);
    return toPublicRow(updated);
  }

  /**
   * Saves several cells of one row in a single Notion update (the row panel's
   * Save, #57). All or nothing: every value is validated and, unless `force`
   * is set, every property is checked against Notion first; one conflict
   * means nothing is written.
   */
  async updateRow(id: string, pageId: string, req: UpdateRowRequest): Promise<Row> {
    const db = this.requireDatabase(id);
    const cached = this.requireRow(id, pageId);
    const ids = new Set<string>();
    const changes = req.changes.map((change) => {
      const column = db.schema.columns.find((c) => c.id === change.columnId);
      if (!column) throw new AppError(400, 'unknown_column', 'A column in this row no longer exists. Try Refresh.');
      if (ids.has(column.id)) throw new AppError(400, 'duplicate_column', `"${column.name}" is listed twice.`);
      ids.add(column.id);
      // Validate before touching Notion, so a bad value costs no requests.
      return { column, change, property: toNotionProperty(column, change.value) };
    });

    let base = cached.cells;
    let current: StoredRow | undefined;
    if (!req.force) {
      current = await this.readRow(id, pageId);
      base = current.cells;
      const conflicts = changes
        .filter(({ column, change }) => !sameCell(base[column.id], change.expected))
        .map(({ column }) => ({ columnId: column.id, current: base[column.id] ?? ({ kind: 'empty' } as CellValue) }));
      if (conflicts.length) {
        const names = conflicts.map((c) => `"${db.schema.columns.find((col) => col.id === c.columnId)!.name}"`).join(', ');
        throw new AppError(409, 'conflict', `${names} ${conflicts.length === 1 ? 'was' : 'were'} changed in Notion since you opened this row.`, {
          conflicts,
          row: toPublicRow(current),
        });
      }
    }
    const toWrite = changes.filter(({ column, change }) => req.force || !sameCell(base[column.id], change.value));
    for (const { column } of toWrite) {
      const b = base[column.id];
      if (b?.kind === 'text' && b.rich) {
        throw new AppError(422, 'rich_text', `"${column.name}" has formatting or links. Edit it in Notion so nothing is lost.`);
      }
    }
    if (!toWrite.length) return toPublicRow(current ?? cached); // nothing to write

    const updated = await this.writeRow(id, pageId, Object.assign({}, ...toWrite.map((w) => ({ [w.column.id]: w.property }))));
    await this.refreshSchemaIfNewOptions(id, toWrite.map((w) => w.change.value));
    return toPublicRow(updated);
  }

  /** Creates a row in Notion from the given cells and caches it. */
  async createRow(id: string, req: CreateRowRequest): Promise<Row> {
    const db = this.requireDatabase(id);
    const properties = toNotionProperties(db.schema.columns, req.cells ?? {});
    const created = await this.notion.createRow(id, properties);
    this.store.upsertRow(id, created);
    await this.refreshSchemaIfNewOptions(id, Object.values(req.cells ?? {}));
    return toPublicRow(created);
  }

  /** Moves a row to Notion's trash and drops it from the cache. */
  async deleteRow(id: string, pageId: string): Promise<void> {
    this.requireDatabase(id);
    this.requireRow(id, pageId);
    try {
      await this.notion.trashRow(pageId);
    } catch (err) {
      // Already gone in Notion: the goal is met.
      if (!(err instanceof AppError && err.statusCode === 410)) throw err;
    }
    this.store.deleteRow(id, pageId);
  }

  requireDatabase(id: string): DatabaseDetail {
    const db = this.store.getDatabase(id);
    if (!db) throw new AppError(404, 'not_found', 'No connected database with that ID.');
    return db;
  }

  private requireRow(id: string, pageId: string): Row {
    const row = this.store.getRow(id, pageId);
    if (!row) throw new AppError(404, 'row_not_found', 'That row isn’t in this database. Try Refresh.');
    return row;
  }

  /** Reads a page from Notion, keeping the cache in step (including deletions). */
  private async readRow(id: string, pageId: string): Promise<StoredRow> {
    try {
      const row = await this.notion.fetchRow(pageId);
      this.store.upsertRow(id, row);
      return row;
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 410) this.store.deleteRow(id, pageId);
      throw err;
    }
  }

  private async writeRow(id: string, pageId: string, properties: Record<string, unknown>): Promise<StoredRow> {
    try {
      const row = await this.notion.updateRow(pageId, properties);
      this.store.upsertRow(id, row);
      return row;
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 410) this.store.deleteRow(id, pageId);
      throw err;
    }
  }

  /** A write that named a new select option made Notion add it; re-read the schema so pickers list it. */
  private async refreshSchemaIfNewOptions(id: string, values: CellValue[]): Promise<void> {
    const db = this.requireDatabase(id);
    const known = new Set(db.schema.columns.flatMap((c) => (c.options ?? []).map((o) => o.id)));
    const named = values.flatMap((v) =>
      v.kind === 'select' && v.value ? [v.value] : v.kind === 'multi_select' ? v.value : [],
    );
    if (!named.some((o) => !known.has(o.id))) return;
    const { name, schema } = await this.notion.fetchSchema(id);
    this.store.updateSchema(id, name, schema);
  }
}

function toPublicRow(row: Row | StoredRow): Row {
  return { id: row.id, url: row.url, lastEditedTime: row.lastEditedTime, cells: row.cells };
}
