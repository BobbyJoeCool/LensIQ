/**
 * The public demo's "server" (Q22): answers the app's /api calls in the
 * browser from in-memory sample data. Every visitor gets a private copy that
 * resets on reload. It mirrors the real API's responses, but none of its
 * Notion code runs here.
 */
import type {
  CellValue,
  Column,
  CreateRowRequest,
  Dashboard,
  ExportFile,
  ImportResult,
  Row,
  UpdateCellRequest,
  UpdateRowRequest,
  View,
  ViewConfig,
  ViewType,
} from '@lensiq/shared';
import { JOBS_ID, buildSample, computeDays, type DemoDatabase } from './sampleData';

type Json = unknown;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const EDITABLE = new Set(['title', 'rich_text', 'number', 'select', 'status', 'multi_select', 'date', 'checkbox', 'url', 'email', 'phone_number', 'relation']);

function defaultConfig(type: ViewType, columns: Column[]): ViewConfig {
  const base = { filters: [], filterMode: 'and' as const, sorts: [] };
  const first = (...t: string[]) => columns.find((c) => t.includes(c.type))?.id ?? null;
  if (type === 'table') return { ...base, hidden: [] };
  if (type === 'board') return { ...base, groupBy: first('status', 'select'), cardFields: [], hideEmptyGroups: false };
  if (type === 'calendar') return { ...base, dateColumn: first('date'), colorBy: first('status') };
  return { ...base, chartType: 'bar', x: first('status', 'select', 'date'), dateGrouping: 'month', aggregation: 'count', y: null, splitBy: null, horizontal: false, stacked: false, cumulative: false, sortBy: 'x', hideEmpty: false };
}

export class DemoServer {
  private databases: DemoDatabase[];
  private views: View[];
  private dashboards: Dashboard[];
  private seq = 1000;

  constructor(now = new Date()) {
    const s = buildSample(now);
    this.databases = s.databases;
    this.views = s.views;
    this.dashboards = s.dashboards;
  }

  private id(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }

  private db(id: string): DemoDatabase {
    const d = this.databases.find((x) => x.detail.id === id);
    if (!d) throw new HttpError(404, 'not_found', 'No connected database with that ID.');
    return d;
  }

  private rowsResponse(d: DemoDatabase) {
    const rows = d.rows.map(({ createdTime: _c, ...r }) => (d.detail.id === JOBS_ID ? computeDays(r) : r));
    return { database: { ...d.detail, rowCount: rows.length }, rows };
  }

  /** Applies a cell value the way Notion would, creating new select options. */
  private apply(d: DemoDatabase, column: Column, value: CellValue): CellValue {
    if (!EDITABLE.has(column.type)) throw new HttpError(422, 'read_only', `"${column.name}" is calculated or managed by Notion and can't be edited here.`);
    const resolve = (o: { id: string; name: string }) => {
      const found = column.options?.find((x) => x.id === o.id) ?? column.options?.find((x) => x.name === o.name);
      if (found) return found;
      if (column.type === 'status') throw new HttpError(400, 'bad_value', `"${o.name}" isn't one of the status options. New statuses are added in Notion.`);
      const created = { id: this.id('opt'), name: o.name.trim(), color: 'default' as const };
      column.options = [...(column.options ?? []), created];
      return created;
    };
    if (value.kind === 'select') {
      if (!value.value && column.type === 'status') throw new HttpError(400, 'bad_value', `"${column.name}" is a status and can't be empty.`);
      return { kind: 'select', value: value.value ? resolve(value.value) : null };
    }
    if (value.kind === 'multi_select') return { kind: 'multi_select', value: value.value.map(resolve) };
    if (value.kind === 'link') return { ...value, value: value.value?.trim() || null };
    return value;
  }

  handle(method: string, url: URL, body: unknown): { status: number; body: Json } {
    const p = url.pathname.replace(/^.*?\/api\//, '/api/').split('/').filter(Boolean).map(decodeURIComponent); // ['api', ...]
    const [, a, b, c, d2, e] = p;
    const ok = (data: Json, status = 200) => ({ status, body: data });

    if (a === 'health') return ok({ ok: true });

    if (a === 'databases') {
      if (!b) {
        if (method === 'GET') return ok(this.databases.map((d) => ({ ...d.detail, rowCount: d.rows.length, schema: undefined })));
        if (method === 'POST') throw new HttpError(400, 'demo', 'This is a demo with sample data, so it can’t connect real Notion databases.');
      }
      const d = this.db(b!);
      if (!c && method === 'GET') return ok({ ...d.detail, rowCount: d.rows.length });
      if (c === 'refresh' && method === 'POST') {
        d.detail.lastSyncedAt = new Date().toISOString();
        return ok(this.rowsResponse(d));
      }
      if (c === 'relations' && d2 && method === 'GET') {
        const column = d.detail.schema.columns.find((x) => x.id === d2);
        const target = column?.relatedDataSourceId ? this.databases.find((x) => x.detail.id === column.relatedDataSourceId) : undefined;
        if (!target) return ok({ available: false, options: [] });
        const options = target.rows
          .map((r) => ({ id: r.id, title: r.cells.title?.kind === 'text' ? r.cells.title.value : 'Untitled' }))
          .sort((x, y) => x.title.localeCompare(y.title));
        return ok({ available: true, options });
      }
      if (c === 'rows') {
        if (!d2 && method === 'GET') return ok(this.rowsResponse(d));
        if (!d2 && method === 'POST') {
          const req = body as CreateRowRequest;
          const cells: Record<string, CellValue> = {};
          for (const [colId, v] of Object.entries(req.cells ?? {})) {
            const column = d.detail.schema.columns.find((x) => x.id === colId);
            if (!column) throw new HttpError(400, 'unknown_column', 'Unknown column.');
            cells[colId] = this.apply(d, column, v);
          }
          const now = new Date().toISOString();
          const row = { id: this.id('row'), url: 'https://www.notion.so/', lastEditedTime: now, createdTime: now, cells };
          d.rows.push(row);
          const { createdTime: _c, ...pub } = row;
          return ok(d.detail.id === JOBS_ID ? computeDays(pub) : pub, 201);
        }
        const row = d.rows.find((r) => r.id === d2);
        if (!row) throw new HttpError(404, 'row_not_found', 'That row isn’t in this database. Try Refresh.');
        if (method === 'PATCH' && e === 'cells') {
          // Row panel Save (#57): all changes at once. Nobody else edits the demo, so there are no conflicts.
          const req = body as UpdateRowRequest;
          if (!req.changes?.length) throw new HttpError(400, 'bad_request', 'Nothing to save.');
          const next = { ...row.cells };
          for (const change of req.changes) {
            const column = d.detail.schema.columns.find((x) => x.id === change.columnId);
            if (!column) throw new HttpError(400, 'unknown_column', 'A column in this row no longer exists. Try Refresh.');
            next[column.id] = this.apply(d, column, change.value);
          }
          row.cells = next;
          row.lastEditedTime = new Date().toISOString();
          const { createdTime: _c, ...pub } = row;
          return ok(d.detail.id === JOBS_ID ? computeDays(pub as Row) : pub);
        }
        if (method === 'PATCH') {
          const req = body as UpdateCellRequest;
          const column = d.detail.schema.columns.find((x) => x.id === req.columnId);
          if (!column) throw new HttpError(400, 'unknown_column', 'That column no longer exists. Try Refresh.');
          row.cells = { ...row.cells, [column.id]: this.apply(d, column, req.value) };
          row.lastEditedTime = new Date().toISOString();
          const { createdTime: _c, ...pub } = row;
          return ok(d.detail.id === JOBS_ID ? computeDays(pub as Row) : pub);
        }
        if (method === 'DELETE') {
          d.rows = d.rows.filter((r) => r.id !== row.id);
          return ok(null, 204);
        }
      }
    }

    if (a === 'views') {
      if (!b && method === 'GET') {
        const dbId = url.searchParams.get('databaseId');
        if (!dbId) return ok(this.views);
        this.db(dbId);
        let list = this.views.filter((v) => v.databaseId === dbId);
        if (!list.length) {
          this.views.push(this.newView(dbId, 'Table', 'table'));
          list = this.views.filter((v) => v.databaseId === dbId);
        }
        return ok(list.sort((x, y) => x.position - y.position));
      }
      if (!b && method === 'POST') {
        const req = body as { databaseId: string; name: string; type: ViewType; config?: ViewConfig };
        if (!req.name?.trim()) throw new HttpError(400, 'bad_name', 'A view needs a name.');
        const v = this.newView(req.databaseId, req.name.trim(), req.type, req.config);
        this.views.push(v);
        return ok(v, 201);
      }
      const v = this.views.find((x) => x.id === b);
      if (!v) throw new HttpError(404, 'view_not_found', 'That view no longer exists.');
      if (method === 'GET') return ok(v);
      if (method === 'PATCH') {
        const req = body as { name?: string; config?: ViewConfig; position?: number };
        if (req.name !== undefined) v.name = req.name.trim() || v.name;
        if (req.config !== undefined) v.config = req.config;
        if (req.position !== undefined) {
          const siblings = this.views.filter((x) => x.databaseId === v.databaseId && x.id !== v.id).sort((x, y) => x.position - y.position);
          siblings.splice(Math.max(0, Math.min(req.position, siblings.length)), 0, v);
          siblings.forEach((x, i) => (x.position = i));
        }
        v.updatedAt = new Date().toISOString();
        return ok(v);
      }
      if (method === 'DELETE') {
        this.views = this.views.filter((x) => x.id !== v.id);
        for (const dash of this.dashboards) dash.tiles = dash.tiles.filter((t) => t.viewId !== v.id);
        return ok(null, 204);
      }
    }

    if (a === 'dashboards') {
      if (!b && method === 'GET') return ok([...this.dashboards].sort((x, y) => x.position - y.position));
      if (!b && method === 'POST') {
        const name = String((body as { name?: string }).name ?? '').trim();
        if (!name) throw new HttpError(400, 'bad_name', 'A dashboard needs a name.');
        const now = new Date().toISOString();
        const dash: Dashboard = { id: this.id('dash'), name, tiles: [], position: this.dashboards.length, createdAt: now, updatedAt: now };
        this.dashboards.push(dash);
        return ok(dash, 201);
      }
      const dash = this.dashboards.find((x) => x.id === b);
      if (!dash) throw new HttpError(404, 'dashboard_not_found', 'That dashboard no longer exists.');
      if (method === 'GET') return ok(dash);
      if (method === 'PATCH') {
        const req = body as { name?: string; tiles?: Dashboard['tiles']; position?: number };
        if (req.name !== undefined) dash.name = req.name.trim() || dash.name;
        if (req.position !== undefined) {
          const others = this.dashboards.filter((x) => x.id !== dash.id).sort((x, y) => x.position - y.position);
          others.splice(Math.max(0, Math.min(req.position, others.length)), 0, dash);
          others.forEach((x, i) => (x.position = i));
        }
        if (req.tiles) dash.tiles = req.tiles.filter((t) => this.views.some((v) => v.id === t.viewId)).map((t) => ({ ...t, id: t.id || this.id('tile') }));
        dash.updatedAt = new Date().toISOString();
        return ok(dash);
      }
      if (method === 'DELETE') {
        this.dashboards = this.dashboards.filter((x) => x.id !== dash.id);
        this.dashboards.forEach((x, i) => (x.position = i));
        return ok(null, 204);
      }
    }

    if (a === 'export' && method === 'GET') {
      const file: ExportFile = { app: 'lensiq', version: 1, exportedAt: new Date().toISOString(), views: this.views, dashboards: this.dashboards };
      return ok(file as unknown as Json);
    }
    if (a === 'import' && method === 'POST') {
      const file = body as ExportFile;
      if (file?.app !== 'lensiq' || file.version !== 1) throw new HttpError(400, 'bad_import', 'That file isn’t a LensIQ export.');
      const result: ImportResult = { viewsCreated: 0, dashboardsCreated: 0, viewsSkipped: 0 };
      const map = new Map<string, string>();
      for (const v of file.views) {
        if (!this.databases.some((d) => d.detail.id === v.databaseId)) {
          result.viewsSkipped++;
          continue;
        }
        const nv = this.newView(v.databaseId, v.name, v.type, v.config);
        this.views.push(nv);
        map.set(v.id, nv.id);
        result.viewsCreated++;
      }
      for (const dsh of file.dashboards) {
        const now = new Date().toISOString();
        this.dashboards.push({ id: this.id('dash'), name: dsh.name, position: this.dashboards.length, tiles: dsh.tiles.flatMap((t) => (map.has(t.viewId) ? [{ ...t, id: this.id('tile'), viewId: map.get(t.viewId)! }] : [])), createdAt: now, updatedAt: now });
        result.dashboardsCreated++;
      }
      return ok(result as unknown as Json);
    }

    throw new HttpError(404, 'not_found', 'Not found.');
  }

  private newView(databaseId: string, name: string, type: ViewType, config?: ViewConfig): View {
    const d = this.db(databaseId);
    const now = new Date().toISOString();
    const position = Math.max(-1, ...this.views.filter((v) => v.databaseId === databaseId).map((v) => v.position)) + 1;
    return { id: this.id('view'), databaseId, name, type, config: config ?? defaultConfig(type, d.detail.schema.columns), position, createdAt: now, updatedAt: now };
  }
}

/** Replaces fetch for /api/... with the demo server. Other requests go to the network. */
export function installDemoApi(server = new DemoServer()): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    if (!url.pathname.includes('/api/')) return realFetch(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    } catch {
      body = undefined;
    }
    await new Promise((r) => setTimeout(r, 60)); // feel like a network
    try {
      const res = server.handle(method, url, body);
      return res.status === 204 ? new Response(null, { status: 204 }) : new Response(JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      const e = err instanceof HttpError ? err : new HttpError(500, 'internal', 'Something went wrong in the demo.');
      return new Response(JSON.stringify({ error: e.code, message: e.message }), { status: e.status, headers: { 'Content-Type': 'application/json' } });
    }
  };
}
