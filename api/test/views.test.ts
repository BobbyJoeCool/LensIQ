import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BoardConfig, ChartConfig, Dashboard, View } from '@lensiq/shared';
import { buildServer } from '../src/server.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATIONS, Store } from '../src/store.js';
import { defaultConfig } from '../src/views.js';
import { FixtureNotionSource, JOB_SEARCH_DB_ID, JOB_SEARCH_DS_ID } from './fixtures/fixtureSource.js';

const DS = JOB_SEARCH_DS_ID;
let app: FastifyInstance;

beforeEach(async () => {
  app = buildServer({ store: new Store(':memory:'), notion: new FixtureNotionSource(), access: null });
  await app.inject({ method: 'POST', url: '/api/databases', payload: { idOrUrl: JOB_SEARCH_DB_ID } });
});
afterEach(async () => app.close());

const listViews = async () => (await app.inject({ method: 'GET', url: `/api/views?databaseId=${DS}` })).json<View[]>();
const createView = async (payload: object) => app.inject({ method: 'POST', url: '/api/views', payload });

describe('views', () => {
  it('creates a default Table view the first time a database is listed', async () => {
    const first = await listViews();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ name: 'Table', type: 'table', position: 0, config: { hidden: [], filters: [], sorts: [] } });
    expect(await listViews()).toHaveLength(1); // not created twice
  });

  it('creates board and chart views with defaults picked from the schema', async () => {
    const board = (await createView({ databaseId: DS, name: 'Board', type: 'board' })).json<View>();
    expect((board.config as BoardConfig).groupBy).toBe('stat'); // the status column
    const chart = (await createView({ databaseId: DS, name: 'By status', type: 'chart' })).json<View>();
    expect(chart.config as ChartConfig).toMatchObject({ chartType: 'bar', x: 'stat', aggregation: 'count' });
  });

  it('saves settings, renames and reorders tabs', async () => {
    const [table] = await listViews();
    const board = (await createView({ databaseId: DS, name: 'Board', type: 'board' })).json<View>();
    const config = { ...table!.config, hidden: ['role'], sorts: [{ columnId: 'sal', direction: 'desc' }] };
    const res = await app.inject({ method: 'PATCH', url: `/api/views/${table!.id}`, payload: { name: 'All jobs', config } });
    expect(res.json<View>()).toMatchObject({ name: 'All jobs', config: { hidden: ['role'] } });

    await app.inject({ method: 'PATCH', url: `/api/views/${board.id}`, payload: { position: 0 } });
    expect((await listViews()).map((v) => v.name)).toEqual(['Board', 'All jobs']);
  });

  it('rejects bad names, types and settings', async () => {
    expect((await createView({ databaseId: DS, name: '  ', type: 'table' })).statusCode).toBe(400);
    expect((await createView({ databaseId: DS, name: 'x', type: 'gantt' })).statusCode).toBe(400);
    expect((await createView({ databaseId: 'nope', name: 'x', type: 'table' })).statusCode).toBe(404);
    expect((await createView({ databaseId: DS, name: 'x', type: 'chart', config: { filters: [] } })).statusCode).toBe(400);
    const [table] = await listViews();
    const bad = await app.inject({ method: 'PATCH', url: `/api/views/${table!.id}`, payload: { config: { filters: 'x' } } });
    expect(bad.statusCode).toBe(400);
  });

  it('deleting a view removes its dashboard tiles', async () => {
    const chart = (await createView({ databaseId: DS, name: 'Chart', type: 'chart' })).json<View>();
    const dash = (await app.inject({ method: 'POST', url: '/api/dashboards', payload: { name: 'Job Search' } })).json<Dashboard>();
    await app.inject({ method: 'PATCH', url: `/api/dashboards/${dash.id}`, payload: { tiles: [{ viewId: chart.id, size: 'large' }] } });
    expect((await app.inject({ method: 'DELETE', url: `/api/views/${chart.id}` })).statusCode).toBe(204);
    const after = (await app.inject({ method: 'GET', url: `/api/dashboards/${dash.id}` })).json<Dashboard>();
    expect(after.tiles).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/api/views/${chart.id}` })).statusCode).toBe(404);
  });
});

describe('dashboards', () => {
  it('creates, lists, renames, lays out and deletes dashboards', async () => {
    const [table] = await listViews();
    const created = await app.inject({ method: 'POST', url: '/api/dashboards', payload: { name: 'Friday Review' } });
    expect(created.statusCode).toBe(201);
    const dash = created.json<Dashboard>();
    expect(dash.tiles).toEqual([]);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/dashboards/${dash.id}`,
      payload: { name: 'Friday', tiles: [{ viewId: table!.id, size: 'huge' }] },
    });
    const updated = res.json<Dashboard>();
    expect(updated.name).toBe('Friday');
    expect(updated.tiles[0]).toMatchObject({ viewId: table!.id, size: 'medium', height: 'standard' }); // unknown size falls back; height defaults
    expect(updated.tiles[0]!.id).toBeTruthy();

    // Tile height (#54): valid heights are kept, anything else falls back to standard.
    const heights = await app.inject({
      method: 'PATCH',
      url: `/api/dashboards/${dash.id}`,
      payload: { tiles: [{ viewId: table!.id, size: 'small', height: 'short' }, { viewId: table!.id, size: 'small', height: 'tall' }, { viewId: table!.id, size: 'small', height: 'giant' }] },
    });
    expect(heights.json<Dashboard>().tiles.map((t) => t.height)).toEqual(['short', 'tall', 'standard']);

    expect((await app.inject({ method: 'GET', url: '/api/dashboards' })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/dashboards/${dash.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/dashboards/${dash.id}` })).statusCode).toBe(404);
  });

  it('keeps dashboards in sidebar order: new ones go last, and they can be moved (#50)', async () => {
    const make = async (name: string) => (await app.inject({ method: 'POST', url: '/api/dashboards', payload: { name } })).json<Dashboard>();
    const [a, b, c] = [await make('A'), await make('B'), await make('C')];
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);
    const names = async () => (await app.inject({ method: 'GET', url: '/api/dashboards' })).json<Dashboard[]>().map((d) => `${d.name}${d.position}`);

    expect((await app.inject({ method: 'PATCH', url: `/api/dashboards/${c.id}`, payload: { position: 0 } })).statusCode).toBe(200);
    expect(await names()).toEqual(['C0', 'A1', 'B2']);
    await app.inject({ method: 'PATCH', url: `/api/dashboards/${c.id}`, payload: { position: 99 } }); // past the end: last
    expect(await names()).toEqual(['A0', 'B1', 'C2']);
    expect((await app.inject({ method: 'PATCH', url: `/api/dashboards/${a.id}`, payload: { position: -1 } })).statusCode).toBe(400);
  });

  it('gives dashboards from before v1.2.0 their creation order when the database is upgraded (#50)', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lensiq-')), 'old.db');
    const old = new Database(file);
    for (const m of MIGRATIONS.slice(0, 4)) old.exec(m);
    old.pragma('user_version = 4');
    const insert = old.prepare(`INSERT INTO dashboards (id, name, tiles, created_at, updated_at) VALUES (?, ?, '[]', ?, ?)`);
    insert.run('second', 'Second', '2026-11-02T00:00:00Z', '2026-11-02T00:00:00Z');
    insert.run('first', 'First', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z');
    old.close();

    const store = new Store(file);
    const rows = store.db.prepare(`SELECT id, position FROM dashboards ORDER BY position`).all();
    expect(rows).toEqual([{ id: 'first', position: 0 }, { id: 'second', position: 1 }]);
    store.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('refuses tiles for views that do not exist and empty names', async () => {
    const dash = (await app.inject({ method: 'POST', url: '/api/dashboards', payload: { name: 'X' } })).json<Dashboard>();
    const bad = await app.inject({ method: 'PATCH', url: `/api/dashboards/${dash.id}`, payload: { tiles: [{ viewId: 'ghost' }] } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/dashboards', payload: { name: '' } })).statusCode).toBe(400);
  });
});

describe('defaultConfig', () => {
  it('leaves group and axis empty when the schema has no fitting column', () => {
    const schema = { columns: [{ id: 't', name: 'Name', type: 'title' as const }] };
    expect((defaultConfig('board', schema) as BoardConfig).groupBy).toBeNull();
    expect((defaultConfig('chart', schema) as ChartConfig).x).toBeNull();
  });
});

describe('calendar views', () => {
  it('creates a calendar view on the first date column', async () => {
    const res = await createView({ databaseId: DS, name: 'Calendar', type: 'calendar' });
    expect(res.statusCode).toBe(201);
    expect(res.json<View>().config).toMatchObject({ dateColumn: 'appl', colorBy: 'stat' }); // colored by the first status column (#55)
  });
});

describe('export and import (#38)', () => {
  it('round-trips views and dashboards, skipping databases that are not connected', async () => {
    const chart = (await createView({ databaseId: DS, name: 'Weekly', type: 'chart' })).json<View>();
    const dash = (await app.inject({ method: 'POST', url: '/api/dashboards', payload: { name: 'Job Search' } })).json<Dashboard>();
    await app.inject({ method: 'PATCH', url: `/api/dashboards/${dash.id}`, payload: { tiles: [{ viewId: chart.id, size: 'full', height: 'tall' }] } });

    const exported = await app.inject({ method: 'GET', url: '/api/export' });
    expect(exported.headers['content-disposition']).toMatch(/lensiq-views-\d{4}-\d{2}-\d{2}\.json/);
    const file = exported.json();
    expect(file).toMatchObject({ app: 'lensiq', version: 1 });
    expect(file.views.map((v: View) => v.name)).toEqual(['Weekly']);
    // An extra view for a database this server doesn't have.
    file.views.push({ ...file.views[0], id: 'other', databaseId: 'not-connected', name: 'Elsewhere' });

    // Import into a fresh server with the same database connected.
    const app2 = buildServer({ store: new Store(':memory:'), notion: new FixtureNotionSource(), access: null });
    await app2.inject({ method: 'POST', url: '/api/databases', payload: { idOrUrl: JOB_SEARCH_DB_ID } });
    const res = await app2.inject({ method: 'POST', url: '/api/import', payload: file });
    expect(res.json()).toEqual({ viewsCreated: 1, dashboardsCreated: 1, viewsSkipped: 1 });
    const dashes = (await app2.inject({ method: 'GET', url: '/api/dashboards' })).json<Dashboard[]>();
    const views2 = (await app2.inject({ method: 'GET', url: '/api/views' })).json<View[]>();
    expect(dashes[0]!.tiles).toHaveLength(1);
    expect(dashes[0]!.tiles[0]).toMatchObject({ viewId: views2.find((v) => v.name === 'Weekly')!.id, size: 'full', height: 'tall' }); // tile height survives (#54)
    await app2.close();
  });

  it('rejects files that are not LensIQ exports', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/import', payload: { app: 'other', version: 1, views: [], dashboards: [] } });
    expect(res.statusCode).toBe(400);
  });
});
