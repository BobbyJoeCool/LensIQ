import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CellValue, Column } from '@lensiq/shared';
import { Cell } from './Cell';

const col = (over: Partial<Column> = {}): Column => ({ id: 'c', name: 'C', type: 'rich_text', ...over });
const show = (value: CellValue | undefined, column: Column = col()) => render(<Cell value={value} column={column} />);

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

  it('counts relations, marking has_more', () => {
    show({ kind: 'relation', value: ['a', 'b'], hasMore: true });
    expect(screen.getByText('2+ linked')).toBeInTheDocument();
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
