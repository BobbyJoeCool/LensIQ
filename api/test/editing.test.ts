import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CellValue, ConflictResponse, Row, RowsResponse } from '@lensiq/shared';
import { buildServer } from '../src/server.js';
import { Store } from '../src/store.js';
import { SyncService } from '../src/sync.js';
import { FixtureNotionSource, JOB_SEARCH_DB_ID, JOB_SEARCH_DS_ID } from './fixtures/fixtureSource.js';

const DS = JOB_SEARCH_DS_ID;
const text = (value: string): CellValue => ({ kind: 'text', value });
const applied = { id: 's1', name: 'Applied', color: 'blue' as const };
const offer = { id: 's3', name: 'Offer', color: 'green' as const };

let app: FastifyInstance;
let notion: FixtureNotionSource;
let store: Store;

beforeEach(async () => {
  notion = new FixtureNotionSource();
  store = new Store(':memory:');
  app = buildServer({ store, notion, access: null });
  const add = await app.inject({ method: 'POST', url: '/api/databases', payload: { idOrUrl: JOB_SEARCH_DB_ID } });
  expect(add.statusCode).toBe(201);
});
afterEach(async () => app.close());

const rows = async (sync = 'none') =>
  (await app.inject({ method: 'GET', url: `/api/databases/${DS}/rows?sync=${sync}` })).json<RowsResponse>().rows;
const patch = (pageId: string, payload: object) =>
  app.inject({ method: 'PATCH', url: `/api/databases/${DS}/rows/${pageId}`, payload });

describe('PATCH a cell', () => {
  it('writes to Notion, updates the cache and returns the new row', async () => {
    const res = await patch('p-2', { columnId: 'role', value: text('Staff Engineer'), expected: text('Full Stack Developer') });
    expect(res.statusCode).toBe(200);
    expect(res.json<Row>().cells.role).toEqual(text('Staff Engineer'));
    expect((await notion.fetchRow('p-2')).cells.role).toEqual(text('Staff Engineer'));
    expect((await rows()).find((r) => r.id === 'p-2')?.cells.role).toEqual(text('Staff Engineer'));
  });

  it('saves when another column changed in Notion (Q12)', async () => {
    notion.externalEdit('p-2', 'Salary', 99000);
    const res = await patch('p-2', { columnId: 'stat', value: { kind: 'select', value: offer }, expected: { kind: 'select', value: applied } });
    expect(res.statusCode).toBe(200);
    expect(res.json<Row>().cells.sal).toEqual({ kind: 'number', value: 99000 });
  });

  it('returns 409 with the current value when the same cell changed in Notion', async () => {
    notion.externalEdit('p-2', 'Role', [{ text: { content: 'Changed in Notion' } }]);
    const res = await patch('p-2', { columnId: 'role', value: text('Mine'), expected: text('Full Stack Developer') });
    expect(res.statusCode).toBe(409);
    const body = res.json<ConflictResponse>();
    expect(body).toMatchObject({ error: 'conflict', columnId: 'role', current: text('Changed in Notion') });
    expect(body.row.cells.role).toEqual(text('Changed in Notion'));
    expect((await notion.fetchRow('p-2')).cells.role).toEqual(text('Changed in Notion')); // not overwritten
    expect((await rows()).find((r) => r.id === 'p-2')?.cells.role).toEqual(text('Changed in Notion')); // cache refreshed
  });

  it('overwrites with force ("keep mine")', async () => {
    notion.externalEdit('p-2', 'Role', [{ text: { content: 'Changed in Notion' } }]);
    const res = await patch('p-2', { columnId: 'role', value: text('Mine'), expected: text('Full Stack Developer'), force: true });
    expect(res.statusCode).toBe(200);
    expect((await notion.fetchRow('p-2')).cells.role).toEqual(text('Mine'));
  });

  it('creates a new select option and refreshes the schema so pickers list it', async () => {
    const res = await patch('p-1', {
      columnId: 'tags',
      value: { kind: 'multi_select', value: [{ id: 't1', name: 'Frontend', color: 'purple' }, { id: '', name: 'Remote', color: 'default' }] },
      expected: { kind: 'multi_select', value: [{ id: 't1', name: 'Frontend', color: 'purple' }] },
    });
    expect(res.statusCode).toBe(200);
    const db = (await app.inject({ method: 'GET', url: `/api/databases/${DS}` })).json();
    const tags = db.schema.columns.find((c: { id: string }) => c.id === 'tags');
    expect(tags.options.map((o: { name: string }) => o.name)).toContain('Remote');
  });

  it('refuses formatted text, read-only columns, bad values and unknown rows', async () => {
    notion.externalEdit('p-1', 'Role', [{ text: { content: 'Bold role' }, annotations: { bold: true } }]);
    // externalEdit stores plain text; make it rich directly through the fixture's raw page.
    const raw = (notion as unknown as { pages: { id: string; properties: Record<string, any> }[] }).pages.find((p) => p.id === 'p-1')!;
    raw.properties.Role.rich_text[0].annotations = { bold: true };
    const rich = await patch('p-1', { columnId: 'role', value: text('x'), expected: text('Bold role') });
    expect(rich.statusCode).toBe(422);
    expect(rich.json().error).toBe('rich_text');

    const formula = await patch('p-1', { columnId: 'days', value: { kind: 'number', value: 1 }, expected: { kind: 'number', value: 47 } });
    expect(formula.statusCode).toBe(422);

    const bad = await patch('p-1', { columnId: 'sal', value: text('lots'), expected: { kind: 'number', value: 145000 } });
    expect(bad.statusCode).toBe(400);

    const missing = await patch('p-nope', { columnId: 'role', value: text('x'), expected: text('') });
    expect(missing.statusCode).toBe(404);

    const shape = await patch('p-1', { columnId: 'role' });
    expect(shape.statusCode).toBe(400);
  });

  it('answers 410 and drops the row when it was deleted in Notion', async () => {
    notion.externalDelete('p-2');
    const res = await patch('p-2', { columnId: 'role', value: text('x'), expected: text('Full Stack Developer') });
    expect(res.statusCode).toBe(410);
    expect((await rows()).map((r) => r.id)).toEqual(['p-1']);
  });
});

describe('create and delete rows', () => {
  it('creates a row in Notion with typed cells', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/databases/${DS}/rows`,
      payload: { cells: { title: text('Tailspin Toys'), rem: { kind: 'boolean', value: true }, stat: { kind: 'select', value: offer } } },
    });
    expect(res.statusCode).toBe(201);
    const row = res.json<Row>();
    expect(row.cells.title).toEqual(text('Tailspin Toys'));
    expect(row.cells.rem).toEqual({ kind: 'boolean', value: true });
    expect((await rows()).map((r) => r.cells.title)).toContainEqual(text('Tailspin Toys'));
    expect((await notion.fetchRows()).length).toBe(3);
  });

  it('rejects a new row with an invalid value before calling Notion', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/databases/${DS}/rows`,
      payload: { cells: { sal: text('lots') } },
    });
    expect(res.statusCode).toBe(400);
    expect((await notion.fetchRows()).length).toBe(2);
  });

  it('moves a row to the trash and removes it from the cache', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/databases/${DS}/rows/p-1` });
    expect(res.statusCode).toBe(204);
    expect((await rows()).map((r) => r.id)).toEqual(['p-2']);
    expect((await notion.fetchRows()).map((r) => r.id)).toEqual(['p-2']);
  });

  it('treats deleting a row already gone in Notion as success', async () => {
    notion.externalDelete('p-1');
    const res = await app.inject({ method: 'DELETE', url: `/api/databases/${DS}/rows/p-1` });
    expect(res.statusCode).toBe(204);
  });
});

describe('sync modes', () => {
  it('full sync picks up added and deleted rows', async () => {
    notion.addLaterRow();
    notion.externalDelete('p-1');
    expect((await rows('none')).map((r) => r.id)).toEqual(['p-1', 'p-2']); // cache only
    expect((await rows('full')).map((r) => r.id)).toEqual(['p-2', 'p-3']);
  });

  it('rejects an unknown sync mode', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/databases/${DS}/rows?sync=sometimes` });
    expect(res.statusCode).toBe(400);
  });
});

describe('SyncService.syncChanges', () => {
  it('fetches only rows edited since the cursor, with a cooldown', async () => {
    let now = Date.parse('2026-11-18T12:00:00Z');
    const n = new FixtureNotionSource();
    const s = new Store(':memory:');
    const sync = new SyncService(s, n, () => now);
    await sync.addDatabase(JOB_SEARCH_DB_ID);

    let changedCalls = 0;
    const original = n.fetchChangedRows.bind(n);
    n.fetchChangedRows = async (ds, since) => {
      changedCalls++;
      return original(ds, since);
    };

    now += 5_000;
    await sync.syncChanges(DS); // within the 15 s cooldown
    expect(changedCalls).toBe(0);

    now += 60_000;
    n.externalEdit('p-1', 'Role', [{ text: { content: 'Edited in Notion' } }]);
    n.addLaterRow();
    await sync.syncChanges(DS);
    expect(changedCalls).toBe(1);
    const cached = s.getRows(DS);
    expect(cached.map((r) => r.id)).toEqual(['p-1', 'p-2', 'p-3']);
    expect(cached[0]!.cells.role).toEqual(text('Edited in Notion'));
  });

  it('falls back to a full load for a database that was never synced', async () => {
    const n = new FixtureNotionSource();
    const s = new Store(':memory:');
    s.addDatabase({ id: DS, databaseId: null, name: 'x', schema: { columns: [] } });
    await new SyncService(s, n).syncChanges(DS);
    expect(s.getRows(DS)).toHaveLength(2);
    expect(s.getDatabase(DS)?.lastSyncedAt).not.toBeNull();
  });
});

describe('relations and files (Phase 4)', () => {
  it('serves related titles read during the full sync, and edits links', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/databases/${DS}/relations/rel` });
    expect(res.json()).toEqual({
      available: true,
      options: [
        { id: 'c0', title: 'Ada Lovelace' },
        { id: 'c2', title: 'Alan Turing' },
        { id: 'c1', title: 'Grace Hopper' },
      ],
    });
    const edit = await patch('p-2', {
      columnId: 'rel',
      value: { kind: 'relation', value: ['c2'], hasMore: false },
      expected: { kind: 'relation', value: [], hasMore: false },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json<Row>().cells.rel).toEqual({ kind: 'relation', value: ['c2'], hasMore: false });
  });

  it('reports a related database that is not shared', async () => {
    const s = new Store(':memory:');
    const sync = new SyncService(s, notion);
    s.addDatabase({
      id: 'x',
      databaseId: null,
      name: 'x',
      schema: { columns: [{ id: 'r', name: 'Link', type: 'relation', relatedDataSourceId: 'unshared' }] },
    });
    expect(await sync.relationOptions('x', 'r')).toEqual({ available: false, options: [] });
    await expect(sync.relationOptions('x', 'nope')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('redirects file links to a freshly signed URL on every open', async () => {
    const url = `/api/databases/${DS}/rows/p-1/files/file/0`;
    const first = await app.inject({ method: 'GET', url });
    const second = await app.inject({ method: 'GET', url });
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toMatch(/resume\.pdf\?sig=\d+/);
    expect(second.headers.location).not.toBe(first.headers.location);
    expect((await app.inject({ method: 'GET', url: `/api/databases/${DS}/rows/p-1/files/file/5` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/databases/${DS}/rows/p-1/files/file/x` })).statusCode).toBe(400);
  });
});
