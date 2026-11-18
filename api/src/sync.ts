import type { DatabaseDetail, RowsResponse } from '@lensiq/shared';
import { AppError } from './errors.js';
import type { NotionSource } from './notion/source.js';
import type { Store } from './store.js';

/**
 * Loads databases from Notion into the cache. Phase 1 does full loads only:
 * on first view and when Refresh is pressed. The 60-second incremental sync is
 * Phase 2 (issue #13).
 */
export class SyncService {
  /** One in-flight load per database, so parallel requests share it. */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly store: Store,
    private readonly notion: NotionSource,
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

  /** Re-reads the schema and every row from Notion and replaces the cache. */
  fullLoad(id: string): Promise<void> {
    const running = this.inFlight.get(id);
    if (running) return running;
    const job = (async () => {
      this.requireDatabase(id);
      const { name, schema } = await this.notion.fetchSchema(id);
      const rows = await this.notion.fetchRows(id);
      this.store.replaceAll(id, name, schema, rows, new Date().toISOString());
    })().finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, job);
    return job;
  }

  /** Cached rows, loading from Notion first if this database was never loaded. */
  async getRows(id: string, { refresh = false } = {}): Promise<RowsResponse> {
    const db = this.requireDatabase(id);
    if (refresh || db.lastSyncedAt === null) await this.fullLoad(id);
    return { database: this.requireDatabase(id), rows: this.store.getRows(id) };
  }

  requireDatabase(id: string): DatabaseDetail {
    const db = this.store.getDatabase(id);
    if (!db) throw new AppError(404, 'not_found', 'No connected database with that ID.');
    return db;
  }
}
