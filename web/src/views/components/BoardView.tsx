import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { BoardConfig, CellValue, Column, Row, SelectOption } from '@lensiq/shared';
import { Cell } from '../../components/cells/Cell';
import type { DatabaseEditing } from '../../editing/useDatabaseEditing';
import { isEmptyCell } from '../query';
import { OPTION_COLORS } from '../../format';
import { TILE_FILL } from '../fill';

const NONE = '__none';

interface Props {
  columns: Column[];
  rows: Row[];
  config: BoardConfig;
  editing: DatabaseEditing;
  onOpenRow: (rowId: string) => void;
  onCreate: (initial: Record<string, CellValue>) => void;
  compact?: boolean;
}

/**
 * Cards grouped by a select or status column. Dragging a card to another
 * group writes the new value to Notion through the normal edit path, so it
 * gets the same optimistic update, rollback and conflict check (#21).
 */
export function BoardView({ columns, rows, config, editing, onOpenRow, onCreate, compact }: Props) {
  const group = columns.find((c) => c.id === config.groupBy && (c.type === 'select' || c.type === 'status'));
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // On a phone, press and hold to drag so normal scrolling still works.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  if (!group) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">
        Choose a select or status property to group by in <strong>Board settings</strong>.
      </p>
    );
  }

  const keyOf = (r: Row) => {
    const v = r.cells[group.id];
    return v?.kind === 'select' && v.value ? v.value.id : NONE;
  };
  const options = group.options ?? [];
  const groups: { key: string; option: SelectOption | null; label: string }[] = options.map((o) => ({ key: o.id, option: o, label: o.name }));
  const hasNone = rows.some((r) => keyOf(r) === NONE);
  // Status always has a value in Notion, so its board only shows "No status" for odd old rows.
  if (group.type === 'select' || hasNone) groups.unshift({ key: NONE, option: null, label: `No ${group.name}` });
  const byGroup = new Map<string, Row[]>(groups.map((g) => [g.key, []]));
  for (const r of rows) (byGroup.get(keyOf(r)) ?? byGroup.get(NONE) ?? []).push(r);
  const shown = config.hideEmptyGroups ? groups.filter((g) => byGroup.get(g.key)!.length > 0) : groups;
  const cardFields = config.cardFields.map((id) => columns.find((c) => c.id === id)).filter((c): c is Column => !!c);
  const title = columns.find((c) => c.type === 'title');

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const row = rows.find((r) => r.id === e.active.id);
    const target = e.over?.id as string | undefined;
    if (!row || !target || target === keyOf(row)) return;
    const g = groups.find((x) => x.key === target);
    if (!g) return;
    if (!g.option && group.type === 'status') return; // a status can't be cleared
    void editing.editCell(row, group, { kind: 'select', value: g.option });
  };

  const draggedRow = dragging ? rows.find((r) => r.id === dragging) : undefined;

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setDragging(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className={`flex gap-3 overflow-x-auto pb-2 ${compact ? TILE_FILL : ''}`} role="list" aria-label={`Board grouped by ${group.name}`}>
        {shown.map((g) => (
          <BoardColumn
            key={g.key}
            id={g.key}
            label={g.label}
            option={g.option}
            count={byGroup.get(g.key)!.length}
            onAdd={() => onCreate(g.option ? { [group.id]: { kind: 'select', value: g.option } } : {})}
            canAdd={!!g.option || group.type === 'select'}
          >
            {byGroup.get(g.key)!.map((r) => (
              <Card key={r.id} row={r} title={title} fields={cardFields} onOpen={() => onOpenRow(r.id)} />
            ))}
          </BoardColumn>
        ))}
      </div>
      <DragOverlay>{draggedRow ? <CardBody row={draggedRow} title={title} fields={cardFields} lifted /> : null}</DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  id,
  label,
  option,
  count,
  children,
  onAdd,
  canAdd,
}: {
  id: string;
  label: string;
  option: SelectOption | null;
  count: number;
  children: React.ReactNode;
  onAdd: () => void;
  canAdd: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      role="listitem"
      aria-label={`${label} (${count})`}
      className={`flex min-h-0 w-72 shrink-0 flex-col rounded-lg p-2 ${isOver ? 'bg-sky-100 dark:bg-sky-950/60' : 'bg-slate-100 dark:bg-slate-800/60'}`}
    >
      <header className="mb-2 flex items-center justify-between gap-2 px-1">
        <span className="flex min-w-0 items-center gap-2">
          {option ? (
            <span className={`truncate rounded px-1.5 py-0.5 text-xs font-medium ${OPTION_COLORS[option.color] ?? OPTION_COLORS.default}`}>{label}</span>
          ) : (
            <span className="truncate text-xs font-medium text-slate-500">{label}</span>
          )}
          <span className="text-xs text-slate-500">{count}</span>
        </span>
      </header>
      <div className="flex min-h-12 flex-1 flex-col gap-2 overflow-y-auto">{children}</div>
      {canAdd && (
        <button type="button" onClick={onAdd} className="mt-2 min-h-9 rounded-md px-2 text-left text-sm text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700">
          + New
        </button>
      )}
    </section>
  );
}

function Card({ row, title, fields, onOpen }: { row: Row; title: Column | undefined; fields: Column[]; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={isDragging ? 'opacity-40' : ''}>
      <CardBody row={row} title={title} fields={fields} onOpen={onOpen} />
    </div>
  );
}

function CardBody({ row, title, fields, onOpen, lifted }: { row: Row; title: Column | undefined; fields: Column[]; onOpen?: () => void; lifted?: boolean }) {
  const t = title ? row.cells[title.id] : undefined;
  const text = t?.kind === 'text' && t.value ? t.value : 'Untitled';
  // Like Notion, empty fields are left off the card.
  fields = fields.filter((c) => !isEmptyCell(row.cells[c.id]));
  return (
    <article
      aria-label={text}
      onClick={onOpen}
      className={`cursor-pointer rounded-md border border-slate-200 bg-white p-2.5 text-sm shadow-sm hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 ${lifted ? 'rotate-1 shadow-lg' : ''}`}
    >
      <p className="font-medium break-words">{text}</p>
      {fields.length > 0 && (
        <dl className="mt-1.5 space-y-1">
          {fields.map((c) => (
            <div key={c.id} className="flex min-w-0 gap-2 text-xs">
              <dt className="sr-only">{c.name}</dt>
              <dd className="min-w-0">
                <Cell value={row.cells[c.id]} column={c} rowId={row.id} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}
