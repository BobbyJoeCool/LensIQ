import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CellValue, Column } from '@lensiq/shared';
import { CellEditor } from './CellEditor';

function setup(column: Column, value: CellValue) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(<CellEditor column={column} value={value} onCommit={onCommit} onCancel={onCancel} />);
  return { onCommit, onCancel, user: userEvent.setup() };
}

const status: Column = {
  id: 'stat',
  name: 'Status',
  type: 'status',
  options: [
    { id: 's1', name: 'Applied', color: 'blue' },
    { id: 's2', name: 'Offer', color: 'green' },
  ],
};
const tags: Column = { ...status, id: 'tags', name: 'Tags', type: 'multi_select', options: [{ id: 't1', name: 'Frontend', color: 'purple' }] };

describe('CellEditor', () => {
  it('saves text on Enter and cancels on Escape', async () => {
    const col: Column = { id: 't', name: 'Company', type: 'title' };
    const a = setup(col, { kind: 'text', value: 'Acme' });
    await a.user.clear(screen.getByLabelText('Company'));
    await a.user.type(screen.getByLabelText('Company'), 'Globex{Enter}');
    expect(a.onCommit).toHaveBeenCalledWith({ kind: 'text', value: 'Globex' });
    expect(a.onCommit).toHaveBeenCalledTimes(1); // the blur after Enter doesn't save twice
  });

  it('cancels with Escape without saving', async () => {
    const col: Column = { id: 't', name: 'Company', type: 'title' };
    const a = setup(col, { kind: 'text', value: 'Acme' });
    await a.user.type(screen.getByLabelText('Company'), 'zzz{Escape}');
    expect(a.onCancel).toHaveBeenCalled();
    expect(a.onCommit).not.toHaveBeenCalled();
  });

  it('parses numbers and refuses text', async () => {
    const col: Column = { id: 'n', name: 'Salary', type: 'number', numberFormat: 'dollar' };
    const a = setup(col, { kind: 'number', value: null });
    await a.user.type(screen.getByLabelText('Salary'), 'lots{Enter}');
    expect(screen.getByText('Enter a number')).toBeInTheDocument();
    expect(a.onCommit).not.toHaveBeenCalled();
    await a.user.clear(screen.getByLabelText('Salary'));
    await a.user.type(screen.getByLabelText('Salary'), '$120,000{Enter}');
    expect(a.onCommit).toHaveBeenCalledWith({ kind: 'number', value: 120000 });
  });

  it('picks a status but never offers to create one', async () => {
    const a = setup(status, { kind: 'select', value: status.options![0]! });
    await a.user.type(screen.getByLabelText('Status'), 'Ghosted');
    expect(screen.queryByText(/Create/)).not.toBeInTheDocument();
    expect(screen.getByText(/added in Notion/)).toBeInTheDocument();
    await a.user.clear(screen.getByLabelText('Status'));
    await a.user.click(screen.getByRole('option', { name: /Offer/ }));
    expect(a.onCommit).toHaveBeenCalledWith({ kind: 'select', value: status.options![1] });
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('creates a new multi-select option and keeps existing ones (Q18)', async () => {
    const a = setup(tags, { kind: 'multi_select', value: [tags.options![0]!] });
    await a.user.type(screen.getByLabelText('Tags'), 'Remote');
    await a.user.click(screen.getByRole('option', { name: 'Create “Remote”' }));
    await a.user.click(screen.getByRole('button', { name: 'Done' }));
    expect(a.onCommit).toHaveBeenCalledWith({
      kind: 'multi_select',
      value: [tags.options![0], { id: '', name: 'Remote', color: 'default' }],
    });
  });

  it('saves a date range and clears dates', async () => {
    const col: Column = { id: 'd', name: 'Applied', type: 'date' };
    const a = setup(col, { kind: 'date', value: { start: '2026-11-01', end: null } });
    await a.user.click(screen.getByLabelText('End date'));
    const end = screen.getByLabelText('Applied end date');
    await a.user.type(end, '2026-11-05');
    await a.user.click(screen.getByRole('button', { name: 'Save' }));
    expect(a.onCommit).toHaveBeenCalledWith({ kind: 'date', value: { start: '2026-11-01', end: '2026-11-05' } });
    await a.user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(a.onCommit).toHaveBeenLastCalledWith({ kind: 'date', value: null });
  });

  it('refuses an end date before the start', async () => {
    const col: Column = { id: 'd', name: 'Applied', type: 'date' };
    const a = setup(col, { kind: 'date', value: { start: '2026-11-10', end: '2026-11-01' } });
    await a.user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('The end is before the start.')).toBeInTheDocument();
    expect(a.onCommit).not.toHaveBeenCalled();
  });

  it('writes blank links as null', async () => {
    const col: Column = { id: 'u', name: 'Posting', type: 'url' };
    const a = setup(col, { kind: 'link', value: 'https://x.dev', linkType: 'url' });
    await a.user.clear(screen.getByLabelText('Posting'));
    await a.user.keyboard('{Enter}');
    expect(a.onCommit).toHaveBeenCalledWith({ kind: 'link', value: null, linkType: 'url' });
  });
});
