import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CellValue, Column } from '@lensiq/shared';
import { CellContext } from '../../cellContext';
import { Cell } from './Cell';

const col = (over: Partial<Column> = {}): Column => ({ id: 'c', name: 'C', type: 'rich_text', ...over });
const wrap = (node: ReactNode, dbId?: string) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {dbId ? <CellContext.Provider value={{ dbId }}>{node}</CellContext.Provider> : node}
  </QueryClientProvider>
);
const show = (value: CellValue | undefined, column: Column = col(), rowId?: string, dbId?: string) =>
  render(wrap(<Cell value={value} column={column} rowId={rowId} />, dbId));

afterEach(() => vi.unstubAllGlobals());

describe('Cell', () => {
  it('shows a dash for empty values', () => {
    show({ kind: 'text', value: '' });
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('formats numbers with the column format', () => {
    show({ kind: 'number', value: 12 }, col({ type: 'number', numberFormat: 'dollar' }));
    expect(screen.getByText(/\$12\.00/)).toBeInTheDocument();
  });

  it('renders select options as chips', () => {
    show({ kind: 'multi_select', value: [{ id: '1', name: 'Remote', color: 'green' }, { id: '2', name: 'Senior', color: 'red' }] });
    expect(screen.getByText('Remote')).toBeInTheDocument();
    expect(screen.getByText('Senior')).toBeInTheDocument();
  });

  it('labels checkboxes for screen readers', () => {
    show({ kind: 'boolean', value: true });
    expect(screen.getByRole('img', { name: 'Checked' })).toBeInTheDocument();
  });

  it('builds safe hrefs for links', () => {
    show({ kind: 'link', value: 'example.com/jobs', linkType: 'url' });
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com/jobs');
  });

  it('links emails with mailto', () => {
    show({ kind: 'link', value: 'a@b.co', linkType: 'email' });
    expect(screen.getByRole('link')).toHaveAttribute('href', 'mailto:a@b.co');
  });

  it('counts relations when titles are not available, marking has_more', () => {
    show({ kind: 'relation', value: ['a', 'b'], hasMore: true }, col({ type: 'relation' }));
    expect(screen.getByText('2+ linked')).toBeInTheDocument();
  });

  it('shows linked page titles from the related database (#30)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ available: true, options: [{ id: 'a-1', title: 'Ada Lovelace' }, { id: 'b', title: 'Grace Hopper' }] }))),
    );
    show({ kind: 'relation', value: ['a1', 'b'], hasMore: false }, col({ type: 'relation', id: 'rel' }), 'p1', 'ds1');
    expect(await screen.findByText('↗ Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('↗ Grace Hopper')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/databases/ds1/relations/rel', expect.anything());
  });

  it('links Notion-hosted files through the API for a fresh URL (#31)', () => {
    const files: CellValue = { kind: 'files', value: [{ name: 'bill.pdf', url: 'https://s3/old', hosted: true }, { name: 'site', url: 'https://x.dev' }] };
    show(files, col({ type: 'files', id: 'f' }), 'p1', 'ds1');
    expect(screen.getByRole('link', { name: 'bill.pdf' })).toHaveAttribute('href', '/api/databases/ds1/rows/p1/files/f/0');
    expect(screen.getByRole('link', { name: 'site' })).toHaveAttribute('href', 'https://x.dev'); // external links don't expire
  });

  it('renders rollup lists', () => {
    show({ kind: 'list', value: [{ kind: 'number', value: 3 }, { kind: 'text', value: 'x' }] });
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('x')).toBeInTheDocument();
  });

  it('marks unsupported types', () => {
    show({ kind: 'unsupported', notionType: 'button' });
    expect(screen.getByText('not shown')).toHaveAttribute('title', expect.stringContaining('button'));
  });
});
