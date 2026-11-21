import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Column, Row } from '@lensiq/shared';
import type { DatabaseEditing, SaveRowResult } from '../editing/useDatabaseEditing';
import { RowPanel } from './RowPanel';

const frontend = { id: 't1', name: 'Frontend', color: 'purple' as const };
const remote = { id: 't2', name: 'Remote-first', color: 'green' as const };
const columns: Column[] = [
  { id: 'title', name: 'Company', type: 'title' },
  { id: 'role', name: 'Role', type: 'rich_text' },
  { id: 'tags', name: 'Tags', type: 'multi_select', options: [frontend, remote] },
  { id: 'next', name: 'Next step', type: 'date' },
];
const row: Row = {
  id: 'p1',
  url: 'https://notion.so/p1',
  lastEditedTime: '',
  cells: {
    title: { kind: 'text', value: 'Acme' },
    role: { kind: 'text', value: 'Engineer' },
    tags: { kind: 'multi_select', value: [frontend] },
    next: { kind: 'date', value: null },
  },
};

function setup(saveRow: (...args: unknown[]) => Promise<SaveRowResult> = async () => ({ ok: true, row })) {
  const editing = { saveRow: vi.fn(saveRow), createRow: vi.fn(), deleteRow: vi.fn(), error: null } as unknown as DatabaseEditing;
  const onClose = vi.fn();
  render(<RowPanel columns={columns} state={{ mode: 'edit', rowId: 'p1' }} row={row} editing={editing} onClose={onClose} />);
  return { editing, onClose, user: userEvent.setup(), panel: screen.getByRole('dialog', { name: 'Row details' }) };
}

describe('RowPanel: an editor still open when saving or closing (#60)', () => {
  it('saves multi-select choices made without pressing Done', async () => {
    const { editing, onClose, user, panel } = setup();
    await user.click(within(panel).getByRole('button', { name: 'Tags' }));
    await user.click(screen.getByRole('option', { name: /Remote-first/ }));
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(editing.saveRow).toHaveBeenCalledTimes(1));
    const [, changes] = (editing.saveRow as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(changes).toEqual([{ columnId: 'tags', value: { kind: 'multi_select', value: [frontend, remote] }, expected: { kind: 'multi_select', value: [frontend] } }]);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('adds an open editor to other changes, and leaves an unchanged one out', async () => {
    const { editing, user, panel } = setup();
    await user.click(within(panel).getByRole('button', { name: 'Role' }));
    await user.clear(screen.getByLabelText('Role'));
    await user.type(screen.getByLabelText('Role'), 'Lead{Enter}');
    await user.click(within(panel).getByRole('button', { name: 'Tags' })); // opened, nothing picked
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(editing.saveRow).toHaveBeenCalledTimes(1));
    const [, changes] = (editing.saveRow as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(changes).toEqual([{ columnId: 'role', value: { kind: 'text', value: 'Lead' }, expected: { kind: 'text', value: 'Engineer' } }]);
  });

  it('asks before closing when the only change is in an open editor', async () => {
    const { onClose, user, panel } = setup();
    await user.click(within(panel).getByRole('button', { name: 'Tags' }));
    await user.click(screen.getByRole('option', { name: /Remote-first/ }));
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('alertdialog', { name: 'Save changes to this row?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the panel open, without saving, when an open date has its end before its start', async () => {
    const { editing, onClose, user, panel } = setup();
    await user.click(within(panel).getByRole('button', { name: 'Next step' }));
    await user.click(screen.getByRole('checkbox', { name: 'End date' }));
    await user.type(screen.getByLabelText('Next step start date'), '2026-11-10');
    await user.type(screen.getByLabelText('Next step end date'), '2026-11-05');
    // The panel's Save in the footer, not the date editor's own Save.
    await user.click(within(panel).getAllByRole('button', { name: 'Save' }).at(-1)!);
    expect(await screen.findByText('The end is before the start.')).toBeInTheDocument();
    expect(editing.saveRow).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('RowPanel: while a save is in flight (#61)', () => {
  it('locks the properties until the request finishes, and unlocks them if it fails', async () => {
    let finish!: (r: SaveRowResult) => void;
    const { user, panel, onClose } = setup(() => new Promise<SaveRowResult>((resolve) => (finish = resolve)));
    await user.click(within(panel).getByRole('button', { name: 'Role' }));
    await user.clear(screen.getByLabelText('Role'));
    await user.type(screen.getByLabelText('Role'), 'Lead{Enter}');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));

    expect(within(panel).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    for (const name of [/^Company/, /^Role/, /^Tags/, /^Next step/]) expect(within(panel).getByRole('button', { name })).toBeDisabled();

    finish({ ok: false }); // the save failed: the edit stays and can be changed again
    // "Role (changed, not saved yet)": the edit is still there.
    await waitFor(() => expect(within(panel).getByRole('button', { name: /^Role/ })).toBeEnabled());
    expect(within(panel).getByRole('button', { name: /^Role/ })).toHaveTextContent('Lead');
    expect(onClose).not.toHaveBeenCalled();
  });
});
