import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardConfig, ChartConfig, TableConfig, View } from '@lensiq/shared';
import type { DatabaseEditing } from '../../editing/useDatabaseEditing';
import { cleanConfig, referencedColumns } from '../ViewHost';
import { applied, columns, rows } from '../fixtures';
import { BoardView } from './BoardView';
import { ChartView } from './ChartView';
import { FilterMenu } from './FilterMenu';
import { HighlightMenu } from './HighlightMenu';

const board: BoardConfig = { filters: [], filterMode: 'and', sorts: [], groupBy: 'stat', cardFields: ['sal'], hideEmptyGroups: false };
const chart: ChartConfig = {
  filters: [],
  filterMode: 'and',
  sorts: [],
  chartType: 'stat',
  x: null,
  dateGrouping: 'month',
  aggregation: 'sum',
  y: 'sal',
  splitBy: null,
  horizontal: false,
  stacked: false,
  cumulative: false,
  sortBy: 'x',
  hideEmpty: false,
};
const editing = { editCell: vi.fn() } as unknown as DatabaseEditing;

describe('BoardView', () => {
  it('groups cards by status in option order, with card fields and counts', () => {
    render(<BoardView columns={columns} rows={rows} config={board} editing={editing} onOpenRow={() => {}} onCreate={() => {}} />);
    const groups = screen.getAllByRole('listitem');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Applied (2)', 'Interviewing (1)', 'Offer (1)']);
    expect(within(groups[0]!).getByRole('article', { name: 'Fabrikam' })).toHaveTextContent('$120,000.00');
  });

  it('hides empty groups when asked and asks for a group-by when none is set', () => {
    const { rerender } = render(
      <BoardView columns={columns} rows={rows.slice(0, 1)} config={{ ...board, hideEmptyGroups: true }} editing={editing} onOpenRow={() => {}} onCreate={() => {}} />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    rerender(<BoardView columns={columns} rows={rows} config={{ ...board, groupBy: null }} editing={editing} onOpenRow={() => {}} onCreate={() => {}} />);
    expect(screen.getByText(/Choose a select or status property/)).toBeInTheDocument();
  });

  it('"+ New" in a group starts a row with that group\'s value; clicking a card opens it', async () => {
    const onCreate = vi.fn();
    const onOpenRow = vi.fn();
    render(<BoardView columns={columns} rows={rows} config={board} editing={editing} onOpenRow={onOpenRow} onCreate={onCreate} />);
    const user = userEvent.setup();
    await user.click(within(screen.getByRole('listitem', { name: 'Applied (2)' })).getByRole('button', { name: '+ New' }));
    expect(onCreate).toHaveBeenCalledWith({ stat: { kind: 'select', value: applied } });
    await user.click(screen.getByRole('article', { name: 'Northwind' }));
    expect(onOpenRow).toHaveBeenCalledWith('a');
  });
});

describe('ChartView', () => {
  it('shows a stat tile with the column format', () => {
    render(<ChartView columns={columns} rows={rows} config={chart} />);
    expect(screen.getByTestId('stat-value')).toHaveTextContent('$425,000.00');
    expect(screen.getByText('Sum of Salary')).toBeInTheDocument();
  });

  it('offers the values as a table (accessibility relief for low-contrast colors)', async () => {
    render(<ChartView columns={columns} rows={rows} config={{ ...chart, chartType: 'bar', x: 'stat', aggregation: 'count' }} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show data' }));
    const table = screen.getByRole('table', { name: 'Chart data' });
    expect(within(table).getByRole('row', { name: /Applied/ })).toHaveTextContent('2');
  });

  it('explains what is missing instead of drawing an empty chart', () => {
    render(<ChartView columns={columns} rows={rows} config={{ ...chart, chartType: 'bar', x: null }} />);
    expect(screen.getByText(/Choose a property for the x-axis/)).toBeInTheDocument();
  });
});

describe('FilterMenu', () => {
  it('adds a filter and changes it to a select condition', async () => {
    const onChange = vi.fn();
    render(<FilterMenu columns={columns} rows={rows} filters={[]} filterMode="and" onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(screen.getByRole('button', { name: '+ Add filter' }));
    const [filters] = onChange.mock.calls[0]!;
    expect(filters[0]).toMatchObject({ columnId: 'title', op: 'contains' });
  });

  it('lets a select filter pick options', async () => {
    const onChange = vi.fn();
    render(<FilterMenu columns={columns} rows={rows} filters={[{ id: 'f1', columnId: 'stat', op: 'any_of', value: [] }]} filterMode="and" onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Filter (1)' }));
    await user.click(screen.getByRole('checkbox', { name: 'Offer' }));
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'f1', columnId: 'stat', op: 'any_of', value: ['s3'] }], 'and');
  });
});

describe('deleted properties', () => {
  const view: View = {
    id: 'v',
    databaseId: 'ds',
    name: 'Chart',
    type: 'chart',
    config: { ...chart, chartType: 'bar', x: 'gone', splitBy: 'stat', filters: [{ id: 'f', columnId: 'gone2', op: 'is_empty' }] },
    position: 0,
    createdAt: '',
    updatedAt: '',
  };
  it('finds references and removes only the missing ones', () => {
    expect(referencedColumns(view)).toEqual(['gone', 'sal', 'stat']);
    const cleaned = cleanConfig(view, columns) as ChartConfig;
    expect(cleaned.x).toBeNull();
    expect(cleaned.splitBy).toBe('stat');
    expect(cleaned.filters).toEqual([]);
  });

  it('flags and clears a deleted Color rows by property on a table (#64)', () => {
    const table: View = { ...view, type: 'table', config: { filters: [], filterMode: 'and', sorts: [], hidden: [], colorBy: 'gone' } satisfies TableConfig };
    expect(referencedColumns(table)).toEqual(['gone']);
    expect((cleanConfig(table, columns) as TableConfig).colorBy).toBeNull();
    const kept: View = { ...table, config: { ...(table.config as TableConfig), colorBy: 'stat' } };
    expect((cleanConfig(kept, columns) as TableConfig).colorBy).toBe('stat');
  });
});

describe('HighlightMenu Color rows by (#64)', () => {
  it('offers status and select properties only, and reports the choice', async () => {
    const onColorBy = vi.fn();
    render(<HighlightMenu columns={columns} rows={rows} rules={[]} onChange={vi.fn()} colorBy={null} onColorBy={onColorBy} />);
    await userEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    const select = screen.getByLabelText('Color rows by');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['None', 'Status']);
    await userEvent.selectOptions(select, 'stat');
    expect(onColorBy).toHaveBeenCalledWith('stat');
  });
});
