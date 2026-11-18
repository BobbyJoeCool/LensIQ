/**
 * NotionApiSource against a fake Notion HTTP API: paging, the incremental
 * filter, title reads, writes, and error mapping (#37).
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { RateLimiter } from '../src/notion/limiter.js';
import { NOTION_VERSION, NotionApiSource } from '../src/notion/source.js';

type Call = { method: string; path: string; body: any; headers: Headers };

const page = (id: string, title: string, extra: object = {}) => ({
  object: 'page',
  id,
  url: `https://www.notion.so/${id}`,
  created_time: '2026-11-01T00:00:00.000Z',
  last_edited_time: '2026-11-02T00:00:00.000Z',
  in_trash: false,
  parent: { type: 'data_source_id', data_source_id: 'ds' },
  properties: { Name: { id: 'title', type: 'title', title: [{ type: 'text', plain_text: title, text: { content: title } }] } },
  ...extra,
});

function fakeNotion(handler: (c: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call = { method: init?.method ?? 'GET', path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) };
    calls.push(call);
    const { status = 200, body } = handler(call);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { source: new NotionApiSource('ntn_test', new RateLimiter(0), fetchImpl), calls };
}

const notFound = { status: 404, body: { object: 'error', status: 404, code: 'object_not_found', message: 'Could not find' } };

describe('NotionApiSource', () => {
  it('sends the pinned API version and pages through every row, skipping trashed pages', async () => {
    const { source, calls } = fakeNotion((c) => {
      if (c.path === '/v1/data_sources/ds/query') {
        return c.body.start_cursor
          ? { body: { object: 'list', results: [page('p3', 'Three'), page('p4', 'Gone', { in_trash: true })], has_more: false, next_cursor: null } }
          : { body: { object: 'list', results: [page('p1', 'One'), page('p2', 'Two')], has_more: true, next_cursor: 'cur2' } };
      }
      return notFound;
    });
    const rows = await source.fetchRows('ds');
    expect(rows.map((r) => r.id)).toEqual(['p1', 'p2', 'p3']);
    expect(rows[0]!.cells.title).toEqual({ kind: 'text', value: 'One' });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body.page_size).toBe(100);
    expect(calls[1]!.body.start_cursor).toBe('cur2');
    expect(calls[0]!.headers.get('notion-version')).toBe(NOTION_VERSION);
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer ntn_test');
  });

  it('asks only for rows edited since the cursor', async () => {
    const { source, calls } = fakeNotion(() => ({ body: { object: 'list', results: [], has_more: false, next_cursor: null } }));
    await source.fetchChangedRows('ds', '2026-11-18T10:00:00.000Z');
    expect(calls[0]!.body.filter).toEqual({ timestamp: 'last_edited_time', last_edited_time: { on_or_after: '2026-11-18T10:00:00.000Z' } });
  });

  it('reads only the title property for relation titles', async () => {
    const { source, calls } = fakeNotion((c) => {
      if (c.method === 'GET' && c.path === '/v1/data_sources/rel') return { body: { object: 'data_source', id: 'rel', title: [], properties: { Name: { id: 'title', name: 'Name', type: 'title', title: {} } } } };
      return { body: { object: 'list', results: [page('a', 'Ada')], has_more: false, next_cursor: null } };
    });
    expect(await source.fetchTitles('rel')).toEqual([{ id: 'a', title: 'Ada' }]);
    const query = calls.find((c) => c.path.endsWith('/query'))!;
    expect(query.path).toMatch(/\/v1\/data_sources\/rel\/query/);
  });

  it('writes properties and returns the updated row', async () => {
    const { source, calls } = fakeNotion((c) => (c.method === 'PATCH' ? { body: page('p1', 'Renamed') } : notFound));
    const row = await source.updateRow('p1', { title: { title: [{ type: 'text', text: { content: 'Renamed' } }] } });
    expect(row.cells.title).toEqual({ kind: 'text', value: 'Renamed' });
    expect(calls[0]!).toMatchObject({ method: 'PATCH', path: '/v1/pages/p1' });
  });

  it('maps Notion errors to readable app errors', async () => {
    const cases: [object, number, RegExp][] = [
      [notFound.body, 404, /couldn't find that database/],
      [{ object: 'error', status: 401, code: 'unauthorized', message: 'bad token' }, 502, /NOTION_TOKEN/],
      [{ object: 'error', status: 400, code: 'validation_error', message: 'body failed validation' }, 400, /rejected the change/],
    ];
    for (const [body, status, text] of cases) {
      const { source } = fakeNotion(() => ({ status: (body as { status: number }).status, body }));
      const err = await source.fetchSchema('ds').catch((e) => e);
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(status);
      expect(err.message).toMatch(text);
    }
  });

  it('treats a missing page as a deleted row (410), not an unshared database', async () => {
    const { source } = fakeNotion(() => notFound);
    await expect(source.fetchRow('p9')).rejects.toMatchObject({ statusCode: 410, code: 'row_gone' });
  });

  it('resolves a database ID to its first data source', async () => {
    const { source } = fakeNotion((c) => {
      if (c.path.startsWith('/v1/data_sources/')) return notFound;
      if (c.path.replace(/-/g, '') === '/v1/databases/1f2e3d4c5b6a47988796a5b4c3d2e1f0') {
        return { body: { object: 'database', id: '1f2e3d4c-5b6a-4798-8796-a5b4c3d2e1f0', data_sources: [{ id: 'ds-1', name: 'Main' }] } };
      }
      return notFound;
    });
    expect(await source.resolve('https://www.notion.so/ws/Jobs-1f2e3d4c5b6a47988796a5b4c3d2e1f0?v=1')).toEqual({
      dataSourceId: 'ds-1',
      databaseId: '1f2e3d4c-5b6a-4798-8796-a5b4c3d2e1f0',
    });
    await expect(source.resolve('not a link')).rejects.toMatchObject({ statusCode: 400 });
  });
});
