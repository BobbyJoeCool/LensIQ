import { describe, expect, it } from 'vitest';
import type { Dashboard, Row, RowsResponse, View } from '@lensiq/shared';
import { DemoServer } from './demoApi';
import { BILLS_ID, JOBS_ID } from './sampleData';

const now = new Date('2026-11-18T12:00:00');
const call = (s: DemoServer, method: string, path: string, body?: unknown) => s.handle(method, new URL(`https://x.github.io/LensIQ${path}`), body);

describe('DemoServer', () => {
  it('lists sample databases, rows, views and dashboards', () => {
    const s = new DemoServer(now);
    expect((call(s, 'GET', '/api/databases').body as { name: string }[]).map((d) => d.name)).toEqual(['Job Search Tracker', 'Household Bills', 'Contacts']);
    const rows = call(s, 'GET', `/api/databases/${JOBS_ID}/rows?sync=none`).body as RowsResponse;
    expect(rows.rows.length).toBeGreaterThan(10);
    expect(rows.rows[0]!.cells.days).toMatchObject({ kind: 'number' }); // computed formula
    expect((call(s, 'GET', `/api/views?databaseId=${BILLS_ID}`).body as View[]).map((v) => v.type)).toContain('calendar');
    expect((call(s, 'GET', '/api/dashboards').body as Dashboard[]).map((d) => d.name)).toEqual(['Job Search', 'Friday Review']);
  });

  it('edits cells, creates select options, refuses read-only columns and empty statuses', () => {
    const s = new DemoServer(now);
    const first = (call(s, 'GET', `/api/databases/${JOBS_ID}/rows`).body as RowsResponse).rows[0]!;
    const edited = call(s, 'PATCH', `/api/databases/${JOBS_ID}/rows/${first.id}`, {
      columnId: 'tags',
      value: { kind: 'multi_select', value: [{ id: '', name: 'Contract', color: 'default' }] },
      expected: first.cells.tags,
    });
    expect((edited.body as Row).cells.tags).toMatchObject({ value: [{ name: 'Contract' }] });
    const schema = (call(s, 'GET', `/api/databases/${JOBS_ID}`).body as RowsResponse['database']).schema;
    expect(schema.columns.find((c) => c.id === 'tags')!.options!.map((o) => o.name)).toContain('Contract');
    expect(() => call(s, 'PATCH', `/api/databases/${JOBS_ID}/rows/${first.id}`, { columnId: 'days', value: { kind: 'number', value: 1 }, expected: {} })).toThrow(/calculated/);
    expect(() => call(s, 'PATCH', `/api/databases/${JOBS_ID}/rows/${first.id}`, { columnId: 'status', value: { kind: 'select', value: null }, expected: {} })).toThrow(/can't be empty/);
  });

  it('saves several cells of a row at once (row panel Save, #57)', () => {
    const s = new DemoServer(now);
    const first = (call(s, 'GET', `/api/databases/${JOBS_ID}/rows`).body as RowsResponse).rows[0]!;
    const saved = call(s, 'PATCH', `/api/databases/${JOBS_ID}/rows/${first.id}/cells`, {
      changes: [
        { columnId: 'title', value: { kind: 'text', value: 'Renamed' }, expected: first.cells.title },
        { columnId: 'tags', value: { kind: 'multi_select', value: [{ id: '', name: 'Contract', color: 'default' }] }, expected: first.cells.tags },
      ],
    });
    expect((saved.body as Row).cells.title).toEqual({ kind: 'text', value: 'Renamed' });
    expect((saved.body as Row).cells.tags).toMatchObject({ value: [{ name: 'Contract' }] });
    expect(() => call(s, 'PATCH', `/api/databases/${JOBS_ID}/rows/${first.id}/cells`, { changes: [] })).toThrow(/Nothing to save/);
  });

  it('creates and deletes rows; relations resolve to titles', () => {
    const s = new DemoServer(now);
    const created = call(s, 'POST', `/api/databases/${BILLS_ID}/rows`, { cells: { title: { kind: 'text', value: 'Gym' } } });
    expect(created.status).toBe(201);
    const id = (created.body as Row).id;
    expect(call(s, 'DELETE', `/api/databases/${BILLS_ID}/rows/${id}`).status).toBe(204);
    const rel = call(s, 'GET', `/api/databases/${JOBS_ID}/relations/contacts`).body as { available: boolean; options: { title: string }[] };
    expect(rel.available).toBe(true);
    expect(rel.options.map((o) => o.title)).toContain('Priya Raman');
  });

  it('refuses to connect real Notion databases', () => {
    expect(() => call(new DemoServer(now), 'POST', '/api/databases', { idOrUrl: 'x' })).toThrow(/demo/);
  });

  it('manages views and dashboards, and round-trips export/import', () => {
    const s = new DemoServer(now);
    const v = call(s, 'POST', '/api/views', { databaseId: JOBS_ID, name: 'Mine', type: 'chart' }).body as View;
    const d = call(s, 'POST', '/api/dashboards', { name: 'Mine' }).body as Dashboard;
    call(s, 'PATCH', `/api/dashboards/${d.id}`, { tiles: [{ id: '', viewId: v.id, size: 'full' }] });
    call(s, 'DELETE', `/api/views/${v.id}`);
    expect((call(s, 'GET', `/api/dashboards/${d.id}`).body as Dashboard).tiles).toEqual([]);
    const file = call(s, 'GET', '/api/export').body;
    const fresh = new DemoServer(now);
    expect(call(fresh, 'POST', '/api/import', file).body).toMatchObject({ viewsSkipped: 0, dashboardsCreated: 3 });
  });
});
