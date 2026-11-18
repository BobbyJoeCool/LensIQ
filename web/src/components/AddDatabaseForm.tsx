import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DatabaseDetail } from '@lensiq/shared';
import { api } from '../api';

export function AddDatabaseForm({ onAdded }: { onAdded: (db: DatabaseDetail) => void }) {
  const [idOrUrl, setIdOrUrl] = useState('');
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: () => api.addDatabase({ idOrUrl: idOrUrl.trim() }),
    onSuccess: (db) => {
      void queryClient.invalidateQueries({ queryKey: ['databases'] });
      setIdOrUrl('');
      onAdded(db);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (idOrUrl.trim()) add.mutate();
  };

  return (
    <section className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-lg font-semibold">Add a Notion database</h2>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-400">
        <li>
          In Notion, open the database, choose <strong>··· → Connections</strong>, and add the LensIQ connection.
        </li>
        <li>Copy the database link (or its ID) and paste it below.</li>
      </ol>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <label htmlFor="db-id" className="sr-only">
          Notion database link or ID
        </label>
        <input
          id="db-id"
          value={idOrUrl}
          onChange={(e) => setIdOrUrl(e.target.value)}
          placeholder="https://www.notion.so/… or database ID"
          autoComplete="off"
          spellCheck={false}
          disabled={add.isPending}
          className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 sm:text-sm dark:border-slate-700 dark:bg-slate-950"
        />
        <button
          type="submit"
          disabled={add.isPending || !idOrUrl.trim()}
          className="min-h-11 rounded-lg bg-sky-600 px-4 font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {add.isPending ? 'Connecting…' : 'Add database'}
        </button>
      </form>
      {add.isPending && (
        <p className="mt-3 text-sm text-slate-500">Reading the schema and every row from Notion. This can take a few seconds.</p>
      )}
      {add.isError && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {add.error.message}
        </p>
      )}
    </section>
  );
}
