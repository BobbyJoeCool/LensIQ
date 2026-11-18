import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExportFile, ImportResult } from '@lensiq/shared';
import { api } from '../api';

/** Backup of views and dashboards (#38, Q24). Row data lives in Notion, so it isn't exported. */
export function SettingsPage() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const exportAll = useMutation({
    mutationFn: api.exportAll,
    onSuccess: (file) => {
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `lensiq-views-${file.exportedAt.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
  });

  const importAll = useMutation({
    mutationFn: async (f: File) => {
      let parsed: ExportFile;
      try {
        parsed = JSON.parse(await f.text()) as ExportFile;
      } catch {
        throw new Error('That file isn’t valid JSON.');
      }
      return api.importAll(parsed);
    },
    onSuccess: (r) => {
      setResult(r);
      void queryClient.invalidateQueries({ queryKey: ['views'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  return (
    <section className="max-w-2xl space-y-6">
      <h2 className="text-xl font-semibold">Settings</h2>
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="font-semibold">Back up views and dashboards</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Download every view and dashboard as one JSON file. Your rows aren’t in it; they stay in Notion. Importing adds the views and dashboards for databases that are connected here, and never changes or removes existing ones.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => exportAll.mutate()} disabled={exportAll.isPending} className="min-h-11 rounded-lg bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
            Export JSON
          </button>
          <button type="button" onClick={() => fileInput.current?.click()} disabled={importAll.isPending} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800">
            {importAll.isPending ? 'Importing…' : 'Import JSON'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            aria-label="Import file"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importAll.mutate(f);
              e.target.value = '';
            }}
          />
        </div>
        {result && (
          <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            Imported {result.viewsCreated} {result.viewsCreated === 1 ? 'view' : 'views'} and {result.dashboardsCreated} {result.dashboardsCreated === 1 ? 'dashboard' : 'dashboards'}
            {result.viewsSkipped ? `; skipped ${result.viewsSkipped} for databases that aren’t connected` : ''}.
          </p>
        )}
        {(exportAll.isError || importAll.isError) && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {(exportAll.error ?? importAll.error)?.message}
          </p>
        )}
      </div>
    </section>
  );
}
