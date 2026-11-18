import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { DatabaseDetail, DatabaseSummary, Row, Schema } from '@lensiq/shared';

/** A row as stored: the shared Row plus the created time used for ordering. */
export interface StoredRow extends Row {
  createdTime: string;
}

export interface NewDatabase {
  id: string;
  databaseId: string | null;
  name: string;
  schema: Schema;
}

const MIGRATIONS: string[] = [
  // v1: row cache and connected databases. Views and dashboards arrive in Phase 3.
  `
  CREATE TABLE databases (
    id             TEXT PRIMARY KEY,           -- Notion data source ID
    database_id    TEXT,                       -- parent Notion database ID
    name           TEXT NOT NULL,
    schema         TEXT NOT NULL,              -- JSON: Schema
    last_synced_at TEXT,                       -- ISO time of last full load
    created_at     TEXT NOT NULL
  );
  CREATE TABLE rows (
    page_id          TEXT PRIMARY KEY,         -- Notion page ID
    data_source_id   TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    url              TEXT NOT NULL,
    created_time     TEXT NOT NULL,
    last_edited_time TEXT NOT NULL,
    cells            TEXT NOT NULL             -- JSON: Record<columnId, CellValue>
  );
  CREATE INDEX rows_by_data_source ON rows (data_source_id, created_time);
  `,
  // v2 (Phase 2): when the last incremental sync started. Its next query asks
  // Notion for rows edited since then.
  `
  ALTER TABLE databases ADD COLUMN changes_checked_at TEXT;
  `,
];

interface DatabaseRecord {
  id: string;
  database_id: string | null;
  name: string;
  schema: string;
  last_synced_at: string | null;
  changes_checked_at: string | null;
  row_count: number;
}

interface RowRecord {
  page_id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  cells: string;
}

/** SQLite cache of connected databases and their rows. */
export class Store {
  readonly db: Database.Database;

  /** @param file Path to the SQLite file, or `:memory:` for tests. */
  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    const current = this.db.pragma('user_version', { simple: true }) as number;
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v]!);
        this.db.pragma(`user_version = ${v + 1}`);
      })();
    }
  }

  close(): void {
    this.db.close();
  }

  private toSummary(r: DatabaseRecord): DatabaseSummary {
    return {
      id: r.id,
      databaseId: r.database_id,
      name: r.name,
      lastSyncedAt: r.last_synced_at,
      rowCount: r.row_count,
    };
  }

  private static readonly SELECT_DATABASE = `
    SELECT d.*, (SELECT COUNT(*) FROM rows r WHERE r.data_source_id = d.id) AS row_count
    FROM databases d`;

  listDatabases(): DatabaseSummary[] {
    const records = this.db
      .prepare(`${Store.SELECT_DATABASE} ORDER BY d.created_at`)
      .all() as DatabaseRecord[];
    return records.map((r) => this.toSummary(r));
  }

  getDatabase(id: string): DatabaseDetail | null {
    const r = this.db.prepare(`${Store.SELECT_DATABASE} WHERE d.id = ?`).get(id) as
      | DatabaseRecord
      | undefined;
    if (!r) return null;
    return { ...this.toSummary(r), schema: JSON.parse(r.schema) as Schema };
  }

  addDatabase(input: NewDatabase): void {
    this.db
      .prepare(
        `INSERT INTO databases (id, database_id, name, schema, last_synced_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
      )
      .run(input.id, input.databaseId, input.name, JSON.stringify(input.schema), new Date().toISOString());
  }

  /**
   * Replaces the cached schema and every cached row for one database in a single
   * transaction, so rows deleted in Notion disappear from the cache too.
   */
  replaceAll(id: string, name: string, schema: Schema, rows: StoredRow[], syncedAt: string): void {
    const updateDb = this.db.prepare(
      `UPDATE databases SET name = ?, schema = ?, last_synced_at = ? WHERE id = ?`,
    );
    const clear = this.db.prepare(`DELETE FROM rows WHERE data_source_id = ?`);
    const insert = this.db.prepare(
      `INSERT INTO rows (page_id, data_source_id, url, created_time, last_edited_time, cells)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      updateDb.run(name, JSON.stringify(schema), syncedAt, id);
      clear.run(id);
      for (const row of rows) {
        insert.run(row.id, id, row.url, row.createdTime, row.lastEditedTime, JSON.stringify(row.cells));
      }
    })();
  }

  /** When the last full load or incremental sync started; null if never synced. */
  getChangesCursor(id: string): string | null {
    const r = this.db.prepare(`SELECT last_synced_at, changes_checked_at FROM databases WHERE id = ?`).get(id) as
      | { last_synced_at: string | null; changes_checked_at: string | null }
      | undefined;
    if (!r) return null;
    const times = [r.last_synced_at, r.changes_checked_at].filter((t): t is string => t !== null).sort();
    return times.at(-1) ?? null;
  }

  /**
   * Applies an incremental sync: updates the name and schema, inserts or
   * replaces the changed rows, and moves the cursor.
   */
  applyChanges(id: string, name: string, schema: Schema, rows: StoredRow[], checkedAt: string): void {
    this.db.transaction(() => {
      this.db
        .prepare(`UPDATE databases SET name = ?, schema = ?, changes_checked_at = ? WHERE id = ?`)
        .run(name, JSON.stringify(schema), checkedAt, id);
      for (const row of rows) this.upsertRow(id, row);
    })();
  }

  /** Inserts or replaces one cached row. */
  upsertRow(dataSourceId: string, row: StoredRow): void {
    this.db
      .prepare(
        `INSERT INTO rows (page_id, data_source_id, url, created_time, last_edited_time, cells)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (page_id) DO UPDATE SET
           url = excluded.url, last_edited_time = excluded.last_edited_time, cells = excluded.cells`,
      )
      .run(row.id, dataSourceId, row.url, row.createdTime, row.lastEditedTime, JSON.stringify(row.cells));
  }

  deleteRow(dataSourceId: string, pageId: string): void {
    this.db.prepare(`DELETE FROM rows WHERE data_source_id = ? AND page_id = ?`).run(dataSourceId, pageId);
  }

  /** Updates a database's name and schema without touching rows or sync times. */
  updateSchema(id: string, name: string, schema: Schema): void {
    this.db.prepare(`UPDATE databases SET name = ?, schema = ? WHERE id = ?`).run(name, JSON.stringify(schema), id);
  }

  getRow(dataSourceId: string, pageId: string): Row | null {
    const r = this.db
      .prepare(
        `SELECT page_id, url, created_time, last_edited_time, cells FROM rows WHERE data_source_id = ? AND page_id = ?`,
      )
      .get(dataSourceId, pageId) as RowRecord | undefined;
    return r ? toRow(r) : null;
  }

  /** True when the page is cached under this database. */
  hasRow(dataSourceId: string, pageId: string): boolean {
    return (
      this.db.prepare(`SELECT 1 FROM rows WHERE data_source_id = ? AND page_id = ?`).get(dataSourceId, pageId) !==
      undefined
    );
  }

  getRows(id: string): Row[] {
    const records = this.db
      .prepare(
        `SELECT page_id, url, created_time, last_edited_time, cells
         FROM rows WHERE data_source_id = ? ORDER BY created_time, page_id`,
      )
      .all(id) as RowRecord[];
    return records.map(toRow);
  }
}

function toRow(r: RowRecord): Row {
  return {
    id: r.page_id,
    url: r.url,
    lastEditedTime: r.last_edited_time,
    cells: JSON.parse(r.cells) as Row['cells'],
  };
}
