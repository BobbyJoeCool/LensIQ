import { Suspense, lazy, useState } from 'react';
import type { BoardConfig, CalendarConfig, CellValue, ChartConfig, Column, TableConfig, View, ViewConfig } from '@lensiq/shared';
import { CellContext } from '../cellContext';
import { ConflictDialog } from '../components/ConflictDialog';
import { DatabaseTable } from '../components/DatabaseTable';
import { RowPanel, type PanelState } from '../components/RowPanel';
import { useDatabaseEditing } from '../editing/useDatabaseEditing';
import { useIsDesktop } from '../hooks';
import { useDatabaseRows } from '../useDatabaseRows';
import { BoardView } from './components/BoardView';
import { CalendarView } from './components/CalendarView';
import { FilterMenu } from './components/FilterMenu';
import { BoardSettings, CalendarSettings, ChartSettings, PropertiesMenu } from './components/SettingsMenus';
import { HighlightMenu } from './components/HighlightMenu';
import { SortMenu } from './components/SortMenu';
import { cleanHighlights, highlightColumns } from './highlight';
import { applyQuery } from './query';
import { useViewActions } from './useViews';

/** Recharts is large: load it only when a chart is on screen. */
const ChartView = lazy(() => import('./components/ChartView').then((m) => ({ default: m.ChartView })));

/** Column IDs a view's own settings point at (beyond filters and sorts). */
export function referencedColumns(view: View): string[] {
  if (view.type === 'board') {
    const c = view.config as BoardConfig;
    return [c.groupBy, ...c.cardFields].filter((x): x is string => !!x);
  }
  if (view.type === 'calendar') {
    const c = view.config as CalendarConfig;
    return [c.dateColumn, c.colorBy].filter((x): x is string => !!x);
  }
  if (view.type === 'table') return highlightColumns((view.config as TableConfig).highlights);
  if (view.type === 'chart') {
    const c = view.config as ChartConfig;
    return [c.chartType !== 'stat' ? c.x : null, c.aggregation !== 'count' ? c.y : null, c.splitBy].filter((x): x is string => !!x);
  }
  return [];
}

/** Removes every reference to columns that no longer exist. */
export function cleanConfig(view: View, columns: Column[]): ViewConfig {
  const ok = new Set(columns.map((c) => c.id));
  const base = {
    ...view.config,
    filters: view.config.filters.filter((f) => ok.has(f.columnId)),
    sorts: view.config.sorts.filter((s) => ok.has(s.columnId)),
  };
  if (view.type === 'table') {
    const c = base as TableConfig;
    return { ...c, hidden: c.hidden.filter((id) => ok.has(id)), ...(c.highlights ? { highlights: cleanHighlights(c.highlights, ok) } : {}) };
  }
  if (view.type === 'board') {
    const c = base as BoardConfig;
    return { ...c, groupBy: c.groupBy && ok.has(c.groupBy) ? c.groupBy : null, cardFields: c.cardFields.filter((id) => ok.has(id)) };
  }
  if (view.type === 'calendar') {
    const c = base as CalendarConfig;
    return { ...c, dateColumn: c.dateColumn && ok.has(c.dateColumn) ? c.dateColumn : null, ...(c.colorBy && !ok.has(c.colorBy) ? { colorBy: null } : {}) };
  }
  const c = base as ChartConfig;
  return {
    ...c,
    x: c.x && ok.has(c.x) ? c.x : null,
    y: c.y && ok.has(c.y) ? c.y : null,
    splitBy: c.splitBy && ok.has(c.splitBy) ? c.splitBy : null,
  };
}

/**
 * One view of one database: toolbar (filter, sort, settings, New), the view
 * itself, the row panel and the conflict dialog. Used on the database page
 * and, in compact form without the toolbar, in dashboard tiles.
 */
export function ViewHost({ view, compact = false }: { view: View; compact?: boolean }) {
  const editing = useDatabaseEditing(view.databaseId);
  const { rows: rowsQuery } = useDatabaseRows(view.databaseId, { paused: editing.saving });
  const actions = useViewActions(view.databaseId);
  const isDesktop = useIsDesktop();
  const [panel, setPanel] = useState<PanelState | null>(null);

  if (rowsQuery.isPending) return <p className="p-4 text-sm text-slate-500">Loading…</p>;
  if (rowsQuery.isError) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
        {rowsQuery.error.message}
      </p>
    );
  }

  const { database, rows: allRows } = rowsQuery.data;
  const columns = database.schema.columns;
  const config = view.config;
  const { rows, missing } = applyQuery(allRows, columns, config);
  const columnIds = new Set(columns.map((c) => c.id));
  const broken = [...new Set([...missing, ...referencedColumns(view).filter((id) => !columnIds.has(id))])];
  const setConfig = (c: ViewConfig) => actions.update(view.id, { config: c });
  const panelRow = panel?.mode === 'edit' ? allRows.find((r) => r.id === panel.rowId) : undefined;
  const openRow = (rowId: string) => setPanel({ mode: 'edit', rowId });
  const create = (initial?: Record<string, CellValue>) => setPanel({ mode: 'create', initial });

  return (
    <CellContext.Provider value={{ dbId: view.databaseId }}>
    <div className={`flex min-h-0 flex-col gap-2 ${compact ? 'md:flex-1' : ''}`}>
      {!compact && (
        <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="View options">
          <FilterMenu columns={columns} rows={allRows} filters={config.filters} filterMode={config.filterMode} onChange={(filters, filterMode) => setConfig({ ...config, filters, filterMode })} />
          {(view.type === 'table' || view.type === 'board') && <SortMenu columns={columns} sorts={config.sorts} onChange={(sorts) => setConfig({ ...config, sorts })} />}
          {view.type === 'table' && <PropertiesMenu columns={columns} config={config as TableConfig} onChange={setConfig} />}
          {view.type === 'table' && (
            <HighlightMenu columns={columns} rows={allRows} rules={(config as TableConfig).highlights ?? []} onChange={(highlights) => setConfig({ ...(config as TableConfig), highlights })} />
          )}
          {view.type === 'board' && <BoardSettings columns={columns} config={config as BoardConfig} onChange={setConfig} />}
          {view.type === 'chart' && <ChartSettings columns={columns} rows={allRows} config={config as ChartConfig} onChange={setConfig} />}
          {view.type === 'calendar' && <CalendarSettings columns={columns} config={config as CalendarConfig} onChange={setConfig} />}
          <span className="ml-auto text-xs text-slate-500" data-testid="view-count">
            {rows.length === allRows.length ? `${rows.length} rows` : `${rows.length} of ${allRows.length} rows`}
          </span>
          {view.type !== 'chart' && (
            <button type="button" onClick={() => create()} className="min-h-9 rounded-lg bg-sky-600 px-3 text-sm font-medium text-white hover:bg-sky-700">
              + New
            </button>
          )}
        </div>
      )}
      {broken.length > 0 && (
        <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span>This view uses a property that was deleted in Notion. Those settings are ignored.</span>
          {!compact && (
            <button type="button" className="rounded px-2 py-1 text-xs font-medium underline" onClick={() => setConfig(cleanConfig(view, columns))}>
              Remove them
            </button>
          )}
        </p>
      )}
      {editing.error && !panel && (
        <p role="alert" className="flex items-start justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          <span>{editing.error}</span>
          <button type="button" aria-label="Dismiss" onClick={editing.clearError} className="shrink-0 px-1">
            ×
          </button>
        </p>
      )}

      {view.type === 'table' && (
        <DatabaseTable
          columns={columns.filter((c) => c.type === 'title' || !(config as TableConfig).hidden.includes(c.id))}
          rows={rows}
          editing={editing}
          inlineEdit={isDesktop}
          onOpenRow={openRow}
          compact={compact}
          highlights={(config as TableConfig).highlights}
          allColumns={columns}
        />
      )}
      {view.type === 'calendar' && <CalendarView columns={columns} rows={rows} config={config as CalendarConfig} editing={editing} onOpenRow={openRow} onCreate={create} compact={compact} />}
      {view.type === 'board' && <BoardView columns={columns} rows={rows} config={config as BoardConfig} editing={editing} onOpenRow={openRow} onCreate={create} compact={compact} />}
      {view.type === 'chart' && (
        <Suspense fallback={<p className="p-4 text-sm text-slate-500">Loading chart…</p>}>
          <ChartView columns={columns} rows={rows} config={config as ChartConfig} compact={compact} />
        </Suspense>
      )}

      {panel && <RowPanel columns={columns} state={panel} row={panelRow} editing={editing} onClose={() => setPanel(null)} />}
      {editing.conflict && <ConflictDialog conflict={editing.conflict} onChoose={(c) => void editing.resolveConflict(c)} />}
    </div>
    </CellContext.Provider>
  );
}
