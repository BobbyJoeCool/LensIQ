import { useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import type { CalendarConfig, CellValue, Column, NotionColor, Row } from '@lensiq/shared';
import type { DatabaseEditing } from '../../editing/useDatabaseEditing';
import { useIsDesktop } from '../../hooks';
import { OPTION_COLORS } from '../../format';
import { colorColumn, daysBetween, eventColor, monthGrid, rowsByDay, shiftDate } from '../calendar';
import { dayOf } from '../query';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_CHIPS = 3;
const DEFAULT_CHIP = 'bg-sky-100 text-sky-950 hover:bg-sky-200 dark:bg-sky-900/60 dark:text-sky-50';
const AGENDA_DEFAULT = 'bg-slate-100 dark:bg-slate-800';

interface Props {
  columns: Column[];
  rows: Row[];
  config: CalendarConfig;
  editing: DatabaseEditing;
  onOpenRow: (rowId: string) => void;
  onCreate: (initial: Record<string, CellValue>) => void;
  compact?: boolean;
}

/** Rows on a month grid by a date column (#33, Q21); an agenda list on a phone. */
export function CalendarView({ columns, rows, config, editing, onOpenRow, onCreate, compact }: Props) {
  const isDesktop = useIsDesktop();
  const today = dayOf(new Date());
  const [ym, setYm] = useState(() => ({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 }));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const column = columns.find((c) => c.id === config.dateColumn);
  if (!column) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
        Choose a date property in <strong>Calendar settings</strong>.
      </p>
    );
  }
  const editable = column.type === 'date';
  const colorBy = colorColumn(columns, config);
  /** Event colors (#55): the option's Notion color, or the default blue when there's no value. */
  const chipColor = (r: Row) => {
    const color = eventColor(r, colorBy);
    return color ? `${OPTION_COLORS[color] ?? OPTION_COLORS.default} hover:brightness-95` : DEFAULT_CHIP;
  };
  const title = columns.find((c) => c.type === 'title');
  const titleOf = (r: Row) => {
    const t = title ? r.cells[title.id] : undefined;
    return t?.kind === 'text' && t.value ? t.value : 'Untitled';
  };
  const weeks = monthGrid(ym.y, ym.m);
  const monthStart = `${ym.y}-${String(ym.m).padStart(2, '0')}-01`;
  const monthEnd = dayOf(new Date(ym.y, ym.m, 0));
  const { byDay, undated } = rowsByDay(rows, column.id, isDesktop ? weeks[0]![0]! : monthStart, isDesktop ? weeks.at(-1)![6]! : monthEnd);
  const step = (by: number) => setYm(({ y, m }) => ({ y: m + by > 12 ? y + 1 : m + by < 1 ? y - 1 : y, m: ((m + by + 11) % 12) + 1 }));
  const add = (day: string) => onCreate({ [column.id]: { kind: 'date', value: { start: day, end: null } } });

  const onDragEnd = (e: DragEndEvent) => {
    const [rowId, fromDay] = String(e.active.id).split('|') as [string, string];
    const toDay = e.over?.id as string | undefined;
    const row = rows.find((r) => r.id === rowId);
    const v = row?.cells[column.id];
    if (!row || !toDay || toDay === fromDay || v?.kind !== 'date' || !v.value) return;
    void editing.editCell(row, column, { kind: 'date', value: shiftDate(v.value, daysBetween(fromDay, toDay)) });
  };

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-base font-semibold" aria-live="polite">
        {MONTHS[ym.m - 1]} {ym.y}
      </h3>
      <div className="flex gap-1">
        <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="min-h-9 min-w-9 rounded-md border border-slate-300 dark:border-slate-600">
          ‹
        </button>
        <button type="button" onClick={() => setYm({ y: new Date().getFullYear(), m: new Date().getMonth() + 1 })} className="min-h-9 rounded-md border border-slate-300 px-3 text-sm dark:border-slate-600">
          Today
        </button>
        <button type="button" aria-label="Next month" onClick={() => step(1)} className="min-h-9 min-w-9 rounded-md border border-slate-300 dark:border-slate-600">
          ›
        </button>
      </div>
    </div>
  );
  const undatedNote = undated > 0 && (
    <p className="text-xs text-slate-500">
      {undated} {undated === 1 ? 'row has' : 'rows have'} no {column.name}.
    </p>
  );

  if (!isDesktop) {
    const days = [...byDay.keys()].sort();
    return (
      <div className="flex flex-col gap-2">
        {header}
        {days.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">Nothing this month.</p>}
        <ol className="flex flex-col gap-2" aria-label={`${MONTHS[ym.m - 1]} agenda`}>
          {days.map((d) => (
            <li key={d} className="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
              <p className={`mb-1 text-xs font-semibold ${d === today ? 'text-sky-700 dark:text-sky-400' : 'text-slate-500'}`}>
                {new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </p>
              <ul className="flex flex-col gap-1">
                {byDay.get(d)!.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => onOpenRow(r.id)} data-color={eventColor(r, colorBy) ?? undefined} className={`min-h-11 w-full rounded-md px-2 text-left text-sm ${eventColor(r, colorBy) ? OPTION_COLORS[eventColor(r, colorBy) as NotionColor] : AGENDA_DEFAULT}`}>
                      {titleOf(r)}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        {undatedNote}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className={`flex flex-col gap-2 ${compact ? 'md:min-h-0 md:flex-1 md:overflow-auto' : ''}`}>
        {header}
        <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-sm dark:border-slate-800 dark:bg-slate-800" role="grid" aria-label={`${MONTHS[ym.m - 1]} ${ym.y}`}>
          {WEEKDAYS.map((w) => (
            <div key={w} role="columnheader" className="bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              {w}
            </div>
          ))}
          {weeks.flat().map((d) => (
            <Day key={d} day={d} inMonth={d >= monthStart && d <= monthEnd} isToday={d === today} compact={compact} onAdd={editable ? () => add(d) : undefined}>
              {(byDay.get(d) ?? []).slice(0, MAX_CHIPS).map((r) => (
                <Chip key={r.id} id={`${r.id}|${d}`} label={titleOf(r)} color={eventColor(r, colorBy)} colorClass={chipColor(r)} draggable={editable} onOpen={() => onOpenRow(r.id)} />
              ))}
              {(byDay.get(d)?.length ?? 0) > MAX_CHIPS && <span className="px-1 text-xs text-slate-500">+{byDay.get(d)!.length - MAX_CHIPS} more</span>}
            </Day>
          ))}
        </div>
        {undatedNote}
      </div>
    </DndContext>
  );
}

function Day({ day, inMonth, isToday, compact, onAdd, children }: { day: string; inMonth: boolean; isToday: boolean; compact?: boolean; onAdd?: () => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: day });
  const n = Number(day.slice(8));
  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={day}
      className={`group flex flex-col gap-0.5 p-1 ${compact ? 'min-h-16' : 'min-h-24'} ${isOver ? 'bg-sky-50 dark:bg-sky-950' : inMonth ? 'bg-white dark:bg-slate-900' : 'bg-slate-50 text-slate-400 dark:bg-slate-950'}`}
    >
      <div className="flex items-center justify-between">
        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs ${isToday ? 'bg-sky-600 font-semibold text-white' : ''}`}>{n}</span>
        {onAdd && (
          <button type="button" aria-label={`Add a row on ${day}`} onClick={onAdd} className="rounded px-1 text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700">
            +
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Chip({ id, label, color, colorClass, draggable, onOpen }: { id: string; label: string; color: NotionColor | null; colorClass: string; draggable: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({ id, disabled: !draggable });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={onOpen}
      data-color={color ?? undefined}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50, position: 'relative' } : undefined}
      className={`truncate rounded px-1.5 py-0.5 text-left text-xs ${colorClass} ${isDragging ? 'opacity-70 shadow-lg' : ''}`}
    >
      {label}
    </button>
  );
}
