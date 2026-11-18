import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RowsResponse } from '@lensiq/shared';
import { App, parseHash } from './App';

describe('parseHash', () => {
  it('reads the three routes', () => {
    expect(parseHash('')).toEqual({ page: 'home' });
    expect(parseHash('#/add')).toEqual({ page: 'add' });
    expect(parseHash('#/db/abc%2D1')).toEqual({ page: 'db', id: 'abc-1' });
    expect(parseHash('#/db/')).toEqual({ page: 'home' });
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
  });

  it('shows the add form when no databases are connected', async () => {
    mockFetch({ '/api/databases': [] });
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Add a Notion database' })).toBeInTheDocument();
  });

  it('opens the first database and renders its table', async () => {
    mockFetch({
      '/api/databases': [{ id: 'ds1', databaseId: 'db1', name: 'Job Search', lastSyncedAt: null, rowCount: 1 }],
      '/api/databases/ds1/rows': rowsResponse,
    });
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Job Search' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Company' })).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByTestId('sync-status')).toHaveTextContent('1 row · synced just now');
  });

  it('shows API errors', async () => {
    mockFetch({});
    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.');
  });
});
