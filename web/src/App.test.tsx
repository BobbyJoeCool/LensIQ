import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RowsResponse } from '@lensiq/shared';
import { App, homeRoute, parseHash } from './App';
import { resetSyncMemory } from './components/DatabaseView';

describe('parseHash', () => {
  it('reads the three routes', () => {
    expect(parseHash('')).toEqual({ page: 'home' });
    expect(parseHash('#/add')).toEqual({ page: 'add' });
    expect(parseHash('#/db/abc%2D1')).toEqual({ page: 'db', id: 'abc-1' });
    expect(parseHash('#/db/')).toEqual({ page: 'home' });
    expect(parseHash('#/db/ds1/v/v%201')).toEqual({ page: 'db', id: 'ds1', viewId: 'v 1' });
    expect(parseHash('#/dash/d1')).toEqual({ page: 'dash', id: 'd1' });
  });
});

describe('homeRoute (#50)', () => {
  it('opens the first dashboard, else the first database, else the add form', () => {
    expect(homeRoute([{ id: 'd1' }, { id: 'd2' }], [{ id: 'db1' }])).toEqual({ page: 'dash', id: 'd1' });
    expect(homeRoute([], [{ id: 'db1' }, { id: 'db2' }])).toEqual({ page: 'db', id: 'db1' });
    expect(homeRoute([], [])).toEqual({ page: 'add' });
  });
});

const rowsResponse: RowsResponse = {
  database: {
    id: 'ds1',
    databaseId: 'db1',
    name: 'Job Search',
    lastSyncedAt: new Date().toISOString(),
    rowCount: 1,
    schema: { columns: [{ id: 'title', name: 'Company', type: 'title' }] },
  },
  rows: [{ id: 'p1', url: 'https://notion.so/p1', lastEditedTime: '', cells: { title: { kind: 'text', value: 'Acme' } } }],
};

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = routes[url];
      return body === undefined
        ? new Response(JSON.stringify({ error: 'not_found', message: 'Not found.' }), { status: 404 })
        : new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = '';
    resetSyncMemory();
  });

  it('shows the add form when no databases are connected', async () => {
    mockFetch({ '/api/databases': [], '/api/dashboards': [] });
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Add a Notion database' })).toBeInTheDocument();
  });

  it('opens the first database and renders its table', async () => {
    mockFetch({
      '/api/databases': [{ id: 'ds1', databaseId: 'db1', name: 'Job Search', lastSyncedAt: null, rowCount: 1 }],
      '/api/databases/ds1/rows?sync=none': rowsResponse,
      '/api/databases/ds1/refresh': rowsResponse,
      '/api/dashboards': [],
      '/api/views?databaseId=ds1': [
        { id: 'v1', databaseId: 'ds1', name: 'Table', type: 'table', config: { filters: [], filterMode: 'and', sorts: [], hidden: [] }, position: 0, createdAt: '', updatedAt: '' },
      ],
    });
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Job Search' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Company' })).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    // Opening the database runs a full sync behind the cached rows (Q15).
    await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent('1 row · synced just now'));
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls;
    expect(calls.some(([url, init]) => url === '/api/databases/ds1/refresh' && init?.method === 'POST')).toBe(true);
  });

  it('shows API errors', async () => {
    mockFetch({});
    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.');
  });
});
