import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Row, RowsResponse } from '@lensiq/shared';
import { DatabaseView, markSynced, resetSyncMemory } from './DatabaseView';

const applied = { id: 's1', name: 'Applied', color: 'blue' as const };
const offer = { id: 's2', name: 'Offer', color: 'green' as const };

const row: Row = {
  id: 'p1',
  url: 'https://notion.so/p1',
  lastEditedTime: '2026-11-18T12:00:00.000Z',
  cells: {
    title: { kind: 'text', value: 'Acme' },
    role: { kind: 'text', value: 'Engineer' },
    stat: { kind: 'select', value: applied },
    rem: { kind: 'boolean', value: false },
    days: { kind: 'number', value: 4 },
  },
};

const response: RowsResponse = {
  database: {
    id: 'ds1',
    databaseId: 'db1',
    name: 'Job Search',
    lastSyncedAt: new Date().toISOString(),
    rowCount: 1,
    schema: {
      columns: [
        { id: 'title', name: 'Company', type: 'title' },
        { id: 'role', name: 'Role', type: 'rich_text' },
        { id: 'stat', name: 'Status', type: 'status', options: [applied, offer] },
        { id: 'rem', name: 'Remote', type: 'checkbox' },
        { id: 'days', name: 'Days', type: 'formula' },
      ],
    },
  },
  rows: [row],
};

type Handler = (url: string, init: RequestInit | undefined) => Response | undefined;
let handler: Handler;
let calls: { url: string; method: string; body: any }[];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function setDesktop(desktop: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: desktop && q.includes('min-width'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  calls = [];
  handler = () => undefined;
  markSynced('ds1'); // skip the open-time full reload unless a test wants it
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const custom = handler(url, init);
      if (custom) return custom;
      if (url.startsWith('/api/databases/ds1/rows?')) return json(response);
      return json({ error: 'not_found', message: 'Not found.' }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetSyncMemory();
});

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DatabaseView id="ds1" />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const patches = () => calls.filter((c) => c.method === 'PATCH');

describe('DatabaseView editing', () => {
  it('desktop: click a cell, edit inline, and save to the API', async () => {
    setDesktop(true);
    handler = (url, init) =>
      init?.method === 'PATCH' ? json({ ...row, cells: { ...row.cells, role: { kind: 'text', value: 'Lead' } } }) : undefined;
    const user = renderView();
    await user.click(await screen.findByRole('cell', { name: 'Edit Role' }));
    const input = screen.getByLabelText('Role');
    await user.clear(input);
    await user.type(input, 'Lead{Enter}');
    expect(await screen.findByText('Lead')).toBeInTheDocument();
    expect(patches()[0]).toMatchObject({
      url: '/api/databases/ds1/rows/p1',
      body: { columnId: 'role', value: { kind: 'text', value: 'Lead' }, expected: { kind: 'text', value: 'Engineer' }, force: false },
    });
  });

  it('desktop: formula cells are not editable; checkboxes toggle in one click', async () => {
    setDesktop(true);
    handler = (_url, init) => (init?.method === 'PATCH' ? json({ ...row, cells: { ...row.cells, rem: { kind: 'boolean', value: true } } }) : undefined);
    const user = renderView();
    await screen.findByText('Acme');
    expect(screen.queryByRole('cell', { name: 'Edit Days' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('cell', { name: 'Edit Remote' }));
    await waitFor(() => expect(patches()[0]?.body.value).toEqual({ kind: 'boolean', value: true }));
  });

  it('rolls the cell back and shows the error when Notion rejects the edit', async () => {
    setDesktop(true);
    handler = (_url, init) =>
      init?.method === 'PATCH' ? json({ error: 'notion_validation', message: 'Notion rejected the change: nope' }, 400) : undefined;
    const user = renderView();
    await user.click(await screen.findByRole('cell', { name: 'Edit Role' }));
    await user.clear(screen.getByLabelText('Role'));
    await user.type(screen.getByLabelText('Role'), 'Bad{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Notion rejected the change: nope');
    expect(screen.getByText('Engineer')).toBeInTheDocument();
    expect(screen.queryByText('Bad')).not.toBeInTheDocument();
  });

  it('shows a conflict, then "Keep mine" re-sends with force', async () => {
    setDesktop(true);
    const theirs = { kind: 'text', value: 'Changed in Notion' } as const;
    handler = (_url, init) => {
      if (init?.method !== 'PATCH') return undefined;
      const body = JSON.parse(String(init.body));
      if (!body.force) {
        return json(
          { error: 'conflict', message: 'changed', columnId: 'role', current: theirs, row: { ...row, cells: { ...row.cells, role: theirs } } },
          409,
        );
      }
      return json({ ...row, cells: { ...row.cells, role: body.value } });
    };
    const user = renderView();
    await user.click(await screen.findByRole('cell', { name: 'Edit Role' }));
    await user.clear(screen.getByLabelText('Role'));
    await user.type(screen.getByLabelText('Role'), 'Mine{Enter}');
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByTestId('conflict-mine')).toHaveTextContent('Mine');
    expect(within(dialog).getByTestId('conflict-theirs')).toHaveTextContent('Changed in Notion');
    await user.click(within(dialog).getByRole('button', { name: 'Keep mine' }));
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1]!.body).toMatchObject({ force: true, value: { kind: 'text', value: 'Mine' }, expected: theirs });
    expect(await screen.findByText('Mine')).toBeInTheDocument();
  });

  it('"Keep Notion\'s" leaves Notion\'s value on screen and writes nothing', async () => {
    setDesktop(true);
    const theirs = { kind: 'text', value: 'Changed in Notion' } as const;
    handler = (_url, init) =>
      init?.method === 'PATCH'
        ? json({ error: 'conflict', message: 'changed', columnId: 'role', current: theirs, row: { ...row, cells: { ...row.cells, role: theirs } } }, 409)
        : undefined;
    const user = renderView();
    await user.click(await screen.findByRole('cell', { name: 'Edit Role' }));
    await user.type(screen.getByLabelText('Role'), 'x{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Keep Notion’s' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('Changed in Notion')).toBeInTheDocument();
    expect(patches()).toHaveLength(1);
  });

  it('phone: tapping a row opens the panel, where a status can be changed', async () => {
    setDesktop(false);
    handler = (_url, init) => (init?.method === 'PATCH' ? json({ ...row, cells: { ...row.cells, stat: { kind: 'select', value: offer } } }) : undefined);
    const user = renderView();
    await user.click(await screen.findByText('Engineer'));
    const panel = screen.getByRole('dialog', { name: 'Row details' });
    expect(within(panel).getByRole('link', { name: 'Open in Notion ↗' })).toHaveAttribute('href', 'https://notion.so/p1');
    await user.click(within(panel).getByRole('button', { name: 'Status' }));
    await user.click(within(panel).getByRole('option', { name: /Offer/ }));
    await waitFor(() => expect(patches()[0]?.body).toMatchObject({ columnId: 'stat', value: { kind: 'select', value: offer } }));
  });

  it('creates a row from the New form', async () => {
    setDesktop(true);
    const created: Row = { ...row, id: 'p2', cells: { title: { kind: 'text', value: 'Globex' } } };
    let posted = false;
    handler = (url, init) => {
      if (init?.method === 'POST' && url === '/api/databases/ds1/rows') {
        posted = true;
        return json(created, 201);
      }
      // Like the real server, later reads include the new row.
      if (posted && url.startsWith('/api/databases/ds1/rows?')) return json({ ...response, rows: [row, created] });
      return undefined;
    };
    const user = renderView();
    await user.click(await screen.findByRole('button', { name: '+ New' }));
    const panel = screen.getByRole('dialog', { name: 'New row' });
    expect(within(panel).queryByText('Days')).not.toBeInTheDocument(); // read-only columns hidden when creating
    await user.click(within(panel).getByRole('button', { name: 'Company' }));
    await user.type(within(panel).getByLabelText('Company'), 'Globex{Enter}');
    await user.click(within(panel).getByRole('button', { name: 'Create row' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const post = calls.find((c) => c.method === 'POST' && c.url === '/api/databases/ds1/rows');
    expect(post?.body).toEqual({ cells: { title: { kind: 'text', value: 'Globex' } } });
    expect(screen.getByText('Globex')).toBeInTheDocument();
  });

  it('deletes a row after confirming (Q19)', async () => {
    setDesktop(true);
    handler = (_url, init) => (init?.method === 'DELETE' ? new Response(null, { status: 204 }) : undefined);
    const user = renderView();
    await user.click(await screen.findByRole('button', { name: 'Open row' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/restored in Notion for 30 days/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete row' }));
    await waitFor(() => expect(screen.queryByText('Acme')).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/databases/ds1/rows/p1')).toBe(true);
  });

  it('formatted text shows "Edit in Notion" instead of an editor (Q14)', async () => {
    setDesktop(true);
    handler = (url) =>
      url.startsWith('/api/databases/ds1/rows?')
        ? json({ ...response, rows: [{ ...row, cells: { ...row.cells, role: { kind: 'text', value: 'Bold', rich: true } } }] })
        : undefined;
    const user = renderView();
    await screen.findByText('Bold');
    expect(screen.queryByRole('cell', { name: 'Edit Role' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open row' }));
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Edit in Notion' })).toBeInTheDocument();
  });

  it('runs a full sync when the database is opened (Q15)', async () => {
    setDesktop(true);
    resetSyncMemory();
    handler = (url) => (url === '/api/databases/ds1/refresh' ? json(response) : undefined);
    renderView();
    await waitFor(() => expect(calls.some((c) => c.url === '/api/databases/ds1/refresh' && c.method === 'POST')).toBe(true));
  });
});
