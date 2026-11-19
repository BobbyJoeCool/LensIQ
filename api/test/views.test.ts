import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BoardConfig, ChartConfig, Dashboard, View } from '@lensiq/shared';
import { buildServer } from '../src/server.js';
import { Store } from '../src/store.js';
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
    expect(updated.tiles[0]).toMatchObject({ viewId: table!.id, size: 'medium' }); // unknown size falls back
    expect(updated.tiles[0]!.id).toBeTruthy();

    expect((await app.inject({ method: 'GET', url: '/api/dashboards' })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/dashboards/${dash.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/dashboards/${dash.id}` })).statusCode).toBe(404);
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
