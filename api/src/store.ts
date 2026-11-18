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
];

interface DatabaseRecord {
  id: string;
  database_id: string | null;
  name: string;
  schema: string;
  last_synced_at: string | null;
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

  getRows(id: string): Row[] {
    const records = this.db
      .prepare(
        `SELECT page_id, url, created_time, last_edited_time, cells
         FROM rows WHERE data_source_id = ? ORDER BY created_time, page_id`,
      )
      .all(id) as RowRecord[];
    return records.map((r) => ({
      id: r.page_id,
      url: r.url,
      lastEditedTime: r.last_edited_time,
      cells: JSON.parse(r.cells) as Row['cells'],
    }));
  }
}
