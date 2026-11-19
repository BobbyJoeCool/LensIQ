/**
 * Saved views and dashboards. Views store column IDs, never names, so a
 * renamed column keeps working; a view pointing at a deleted column is
 * flagged by the web app rather than rejected here.
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  BoardConfig,
  CalendarConfig,
  ChartConfig,
  Dashboard,
  DashboardTile,
  Schema,
  TableConfig,
  View,
  ViewConfig,
  ViewType,
} from '@lensiq/shared';
import { AppError } from './errors.js';

const MAX_CONFIG_BYTES = 64 * 1024;

/** Sensible starting settings for a new view, using the schema to pick columns. */
export function defaultConfig(type: ViewType, schema: Schema): ViewConfig {
  const base = { filters: [], filterMode: 'and' as const, sorts: [] };
  const firstOf = (...types: string[]) => schema.columns.find((c) => types.includes(c.type))?.id ?? null;
  if (type === 'table') return { ...base, hidden: [] } satisfies TableConfig;
  if (type === 'calendar') return { ...base, dateColumn: firstOf('date', 'created_time', 'last_edited_time') } satisfies CalendarConfig;
  if (type === 'board') {
    return { ...base, groupBy: firstOf('status', 'select'), cardFields: [], hideEmptyGroups: false } satisfies BoardConfig;
  }
  return {
    ...base,
    chartType: 'bar',
    x: firstOf('status', 'select', 'date', 'checkbox'),
    dateGrouping: 'month',
    aggregation: 'count',
    y: null,
    splitBy: null,
    horizontal: false,
    stacked: false,
    cumulative: false,
    sortBy: 'x',
    hideEmpty: false,
  } satisfies ChartConfig;
}

/** Shallow structural check; the web app ignores parts that reference missing columns. */
export function checkConfig(type: ViewType, config: unknown): ViewConfig {
  const fail = (why: string): never => {
    throw new AppError(400, 'bad_view', `Invalid ${type} view settings: ${why}.`);
  };
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('expected an object');
  const c = config as Record<string, unknown>;
  if (!Array.isArray(c.filters)) fail('filters must be a list');
  if (!Array.isArray(c.sorts)) fail('sorts must be a list');
  if (c.filterMode !== 'and' && c.filterMode !== 'or') fail('filterMode must be "and" or "or"');
  if (type === 'table' && !Array.isArray(c.hidden)) fail('hidden must be a list');
  if (type === 'board' && !Array.isArray(c.cardFields)) fail('cardFields must be a list');
  if (type === 'chart' && !['bar', 'line', 'area', 'pie', 'stat'].includes(c.chartType as string)) fail('unknown chart type');
  if (JSON.stringify(c).length > MAX_CONFIG_BYTES) fail('too large');
  return c as unknown as ViewConfig;
}

interface ViewRecord {
  id: string;
  data_source_id: string;
  name: string;
  type: ViewType;
  config: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface DashboardRecord {
  id: string;
  name: string;
  tiles: string;
  created_at: string;
  updated_at: string;
}

const toView = (r: ViewRecord): View => ({
  id: r.id,
  databaseId: r.data_source_id,
  name: r.name,
  type: r.type,
  config: JSON.parse(r.config) as ViewConfig,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toDashboard = (r: DashboardRecord): Dashboard => ({
  id: r.id,
  name: r.name,
  tiles: JSON.parse(r.tiles) as DashboardTile[],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function cleanName(name: unknown, what: string): string {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n) throw new AppError(400, 'bad_name', `A ${what} needs a name.`);
  if (n.length > 100) throw new AppError(400, 'bad_name', `${what[0]!.toUpperCase()}${what.slice(1)} names can be up to 100 characters.`);
  return n;
}

export class ViewRepo {
  constructor(private readonly db: Database.Database) {}

  list(databaseId?: string): View[] {
    const rows = databaseId
      ? this.db.prepare(`SELECT * FROM views WHERE data_source_id = ? ORDER BY position, created_at`).all(databaseId)
      : this.db.prepare(`SELECT * FROM views ORDER BY data_source_id, position, created_at`).all();
    return (rows as ViewRecord[]).map(toView);
  }

  get(id: string): View {
    const r = this.db.prepare(`SELECT * FROM views WHERE id = ?`).get(id) as ViewRecord | undefined;
    if (!r) throw new AppError(404, 'view_not_found', 'That view no longer exists.');
    return toView(r);
  }

  create(input: { databaseId: string; name: string; type: ViewType; config: ViewConfig }): View {
    if (!['table', 'board', 'chart', 'calendar'].includes(input.type)) throw new AppError(400, 'bad_view', 'Unknown view type.');
    const name = cleanName(input.name, 'view');
    const config = checkConfig(input.type, input.config);
    const now = new Date().toISOString();
    const max = this.db.prepare(`SELECT MAX(position) AS m FROM views WHERE data_source_id = ?`).get(input.databaseId) as {
      m: number | null;
    };
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO views (id, data_source_id, name, type, config, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.databaseId, name, input.type, JSON.stringify(config), (max.m ?? -1) + 1, now, now);
    return this.get(id);
  }

  update(id: string, patch: { name?: string; config?: ViewConfig; position?: number }): View {
    const view = this.get(id);
    const name = patch.name !== undefined ? cleanName(patch.name, 'view') : view.name;
    const config = patch.config !== undefined ? checkConfig(view.type, patch.config) : view.config;
    this.db.transaction(() => {
      if (patch.position !== undefined && patch.position !== view.position) this.move(view, patch.position);
      this.db
        .prepare(`UPDATE views SET name = ?, config = ?, updated_at = ? WHERE id = ?`)
        .run(name, JSON.stringify(config), new Date().toISOString(), id);
    })();
    return this.get(id);
  }

  /** Moves a view to a new tab index and renumbers its siblings. */
  private move(view: View, to: number): void {
    const siblings = this.list(view.databaseId).filter((v) => v.id !== view.id);
    const index = Math.max(0, Math.min(Math.trunc(to), siblings.length));
    siblings.splice(index, 0, view);
    const set = this.db.prepare(`UPDATE views SET position = ? WHERE id = ?`);
    siblings.forEach((v, i) => set.run(i, v.id));
  }

  /** Deletes a view and removes it from every dashboard. */
  delete(id: string, dashboards: DashboardRepo): void {
    this.get(id);
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM views WHERE id = ?`).run(id);
      dashboards.removeView(id);
    })();
  }
}

const TILE_SIZES = new Set(['small', 'medium', 'large', 'full']);

export class DashboardRepo {
  constructor(private readonly db: Database.Database) {}

  list(): Dashboard[] {
    return (this.db.prepare(`SELECT * FROM dashboards ORDER BY created_at`).all() as DashboardRecord[]).map(toDashboard);
  }

  get(id: string): Dashboard {
    const r = this.db.prepare(`SELECT * FROM dashboards WHERE id = ?`).get(id) as DashboardRecord | undefined;
    if (!r) throw new AppError(404, 'dashboard_not_found', 'That dashboard no longer exists.');
    return toDashboard(r);
  }

  create(name: string): Dashboard {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO dashboards (id, name, tiles, created_at, updated_at) VALUES (?, ?, '[]', ?, ?)`)
      .run(id, cleanName(name, 'dashboard'), now, now);
    return this.get(id);
  }

  update(id: string, patch: { name?: string; tiles?: DashboardTile[] }, viewExists: (viewId: string) => boolean): Dashboard {
    const d = this.get(id);
    const name = patch.name !== undefined ? cleanName(patch.name, 'dashboard') : d.name;
    let tiles = d.tiles;
    if (patch.tiles !== undefined) {
      if (!Array.isArray(patch.tiles) || patch.tiles.length > 100) throw new AppError(400, 'bad_tiles', 'Tiles must be a list of up to 100.');
      tiles = patch.tiles.map((t) => {
        if (!t || typeof t.viewId !== 'string' || !viewExists(t.viewId)) {
          throw new AppError(400, 'bad_tiles', 'A tile points at a view that doesn’t exist.');
        }
        return { id: typeof t.id === 'string' && t.id ? t.id : randomUUID(), viewId: t.viewId, size: TILE_SIZES.has(t.size) ? t.size : 'medium' };
      });
    }
    this.db
      .prepare(`UPDATE dashboards SET name = ?, tiles = ?, updated_at = ? WHERE id = ?`)
      .run(name, JSON.stringify(tiles), new Date().toISOString(), id);
    return this.get(id);
  }

  delete(id: string): void {
    this.get(id);
    this.db.prepare(`DELETE FROM dashboards WHERE id = ?`).run(id);
  }

  /** Drops tiles for a deleted view (or views of a removed database). */
  removeView(viewId: string): void {
    for (const d of this.list()) {
      const tiles = d.tiles.filter((t) => t.viewId !== viewId);
      if (tiles.length !== d.tiles.length) {
        this.db.prepare(`UPDATE dashboards SET tiles = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(tiles), new Date().toISOString(), d.id);
      }
    }
  }
}
