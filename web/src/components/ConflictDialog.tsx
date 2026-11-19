import { useEffect, useRef } from 'react';
import type { Conflict } from '../editing/useDatabaseEditing';
import { Cell } from './cells/Cell';

/** Shown when a cell changed in Notion since Bob loaded it (Q12): pick which value to keep. */
export function ConflictDialog({ conflict, onChoose }: { conflict: Conflict; onChoose: (choice: 'mine' | 'theirs') => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>('button')?.focus(), []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
        aria-describedby="conflict-desc"
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900"
        onKeyDown={(e) => e.key === 'Escape' && onChoose('theirs')}
      >
        <h2 id="conflict-title" className="text-lg font-semibold">
          “{conflict.column.name}” changed in Notion
        </h2>
        <p id="conflict-desc" className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Someone changed this value in Notion after you loaded it. Which one should stay?
        </p>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/40">
            <dt className="text-xs font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-300">Your value</dt>
            <dd className="mt-1 text-sm" data-testid="conflict-mine">
              <Cell value={conflict.mine} column={conflict.column} />
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">In Notion now</dt>
            <dd className="mt-1 text-sm" data-testid="conflict-theirs">
              <Cell value={conflict.current} column={conflict.column} />
            </dd>
          </div>
        </dl>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => onChoose('theirs')} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800">
            Keep Notion’s
          </button>
          <button type="button" onClick={() => onChoose('mine')} className="min-h-11 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700">
            Keep mine
          </button>
        </div>
      </div>
    </div>
  );
}
