/**
 * Edit controls for every editable column type. Each calls `onCommit` with a
 * new CellValue, or `onCancel` (Escape). Used inline in the table on desktop
 * and inside the row panel.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CellValue, Column, SelectOption } from '@lensiq/shared';
import { OPTION_COLORS } from '../../format';
import { localIso, numberToText, parseNumber, splitIso } from '../../editing/editable';

export interface EditorProps {
  column: Column;
  value: CellValue;
  onCommit: (value: CellValue) => void;
  onCancel: () => void;
}

const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 dark:border-slate-600 dark:bg-slate-900 dark:focus:ring-sky-900';

export function CellEditor(props: EditorProps) {
  switch (props.column.type) {
    case 'title':
    case 'rich_text':
      return <TextEditor {...props} />;
    case 'number':
      return <NumberEditor {...props} />;
    case 'url':
    case 'email':
    case 'phone_number':
      return <LinkEditor {...props} />;
    case 'select':
    case 'status':
      return <OptionEditor {...props} multi={false} />;
    case 'multi_select':
      return <OptionEditor {...props} multi />;
    case 'date':
      return <DateEditor {...props} />;
    case 'checkbox':
      return <CheckboxEditor {...props} />;
    default:
      return null;
  }
}

/** Shared keys for single-field editors: Enter saves, Escape cancels. */
function commitKeys(commit: () => void, onCancel: () => void, multiline = false) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Enter' && (!multiline || !e.shiftKey)) {
      e.preventDefault();
      commit();
    }
  };
}

function TextEditor({ column, value, onCommit, onCancel }: EditorProps) {
  const [text, setText] = useState(value.kind === 'text' ? value.value : '');
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit({ kind: 'text', value: text });
  };
  const cancel = () => {
    done.current = true;
    onCancel();
  };
  const onKeyDown = commitKeys(commit, cancel, column.type === 'rich_text');
  return column.type === 'rich_text' ? (
    <textarea
      aria-label={column.name}
      autoFocus
      rows={Math.min(8, Math.max(2, text.split('\n').length))}
      className={inputClass}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
    />
  ) : (
    <input aria-label={column.name} autoFocus className={inputClass} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} onBlur={commit} />
  );
}

function NumberEditor({ column, value, onCommit, onCancel }: EditorProps) {
  const [text, setText] = useState(numberToText(value.kind === 'number' ? value.value : null, column.numberFormat));
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    const n = parseNumber(text, column.numberFormat);
    if (n === 'invalid') {
      setError('Enter a number');
      return;
    }
    done.current = true;
    onCommit({ kind: 'number', value: n });
  };
  const cancel = () => {
    done.current = true;
    onCancel();
  };
  return (
    <div>
      <input
        aria-label={column.name}
        aria-invalid={error ? true : undefined}
        autoFocus
        inputMode="decimal"
        className={inputClass}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={commitKeys(commit, cancel)}
        onBlur={commit}
      />
      {column.numberFormat === 'percent' && <p className="mt-1 text-xs text-slate-500">Percent: type 25 for 25%</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function LinkEditor({ column, value, onCommit, onCancel }: EditorProps) {
  const linkType = column.type as 'url' | 'email' | 'phone_number';
  const [text, setText] = useState(value.kind === 'link' ? (value.value ?? '') : '');
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const trimmed = text.trim();
    onCommit({ kind: 'link', value: trimmed || null, linkType });
  };
  const cancel = () => {
    done.current = true;
    onCancel();
  };
  return (
    <input
      aria-label={column.name}
      autoFocus
      type={linkType === 'url' ? 'url' : linkType === 'email' ? 'email' : 'tel'}
      className={inputClass}
      value={text}
      placeholder={linkType === 'url' ? 'https://' : ''}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={commitKeys(commit, cancel)}
      onBlur={commit}
    />
  );
}

function CheckboxEditor({ column, value, onCommit }: EditorProps) {
  const checked = value.kind === 'boolean' && value.value;
  return (
    <label className="inline-flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" className="h-5 w-5 accent-sky-600" checked={checked} onChange={(e) => onCommit({ kind: 'boolean', value: e.target.checked })} />
      {column.name}
    </label>
  );
}

function Chip({ option, onRemove }: { option: SelectOption; onRemove?: () => void }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${OPTION_COLORS[option.color] ?? OPTION_COLORS.default}`}>
      <span className="truncate">{option.name}</span>
      {onRemove && (
        <button type="button" aria-label={`Remove ${option.name}`} onClick={onRemove} className="rounded px-0.5 hover:bg-black/10">
          ×
        </button>
      )}
    </span>
  );
}

/** Select, status and multi-select: a searchable list of options, with "Create" for select and multi-select (Q18). */
function OptionEditor({ column, value, onCommit, onCancel, multi }: EditorProps & { multi: boolean }) {
  const options = useMemo(() => column.options ?? [], [column.options]);
  const initial: SelectOption[] =
    value.kind === 'multi_select' ? value.value : value.kind === 'select' && value.value ? [value.value] : [];
  const [chosen, setChosen] = useState<SelectOption[]>(initial);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const canCreate = column.type !== 'status';
  const isStatus = column.type === 'status';

  const q = query.trim().toLowerCase();
  const filtered = options.filter((o) => o.name.toLowerCase().includes(q));
  const exact = options.some((o) => o.name.toLowerCase() === q);
  const createName = canCreate && q && !exact && !query.includes(',') ? query.trim() : null;
  const items: ({ type: 'option'; option: SelectOption } | { type: 'create'; name: string })[] = [
    ...filtered.map((option) => ({ type: 'option' as const, option })),
    ...(createName ? [{ type: 'create' as const, name: createName }] : []),
  ];

  const commitMulti = (next: SelectOption[]) => onCommit({ kind: 'multi_select', value: next });
  const pick = (opt: SelectOption) => {
    if (!multi) {
      onCommit({ kind: 'select', value: opt });
      return;
    }
    const has = chosen.some((c) => c.id === opt.id && c.name === opt.name);
    setChosen(has ? chosen.filter((c) => !(c.id === opt.id && c.name === opt.name)) : [...chosen, opt]);
    setQuery('');
  };
  const choose = (i: number) => {
    const item = items[i];
    if (!item) return;
    pick(item.type === 'option' ? item.option : { id: '', name: item.name, color: 'default' });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items.length) choose(active);
      else if (multi) commitMulti(chosen);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (multi) commitMulti(chosen);
      else onCancel();
    } else if (e.key === 'Backspace' && multi && query === '' && chosen.length) {
      setChosen(chosen.slice(0, -1));
    }
  };

  return (
    <div className="w-64 max-w-full rounded-md border border-slate-300 bg-white p-2 shadow-lg dark:border-slate-600 dark:bg-slate-900">
      {multi && chosen.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1" aria-label="Selected options">
          {chosen.map((o) => (
            <Chip key={o.id || o.name} option={o} onRemove={() => setChosen(chosen.filter((c) => c !== o))} />
          ))}
        </div>
      )}
      <input
        aria-label={column.name}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        autoFocus
        className={inputClass}
        placeholder={canCreate ? 'Search or create…' : 'Search…'}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" aria-label={`${column.name} options`} className="mt-1 max-h-56 overflow-auto">
        {items.map((item, i) => {
          const selected = item.type === 'option' && chosen.some((c) => c.id === item.option.id);
          return (
            <li key={item.type === 'option' ? item.option.id : `create:${item.name}`}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                className={`flex min-h-10 w-full items-center justify-between gap-2 rounded px-2 text-left text-sm ${i === active ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
              >
                {item.type === 'option' ? <Chip option={item.option} /> : <span>Create “{item.name}”</span>}
                {selected && <span aria-hidden>✓</span>}
              </button>
            </li>
          );
        })}
        {items.length === 0 && <li className="px-2 py-2 text-sm text-slate-500">{isStatus ? 'No matching status. New statuses are added in Notion.' : 'No options'}</li>}
      </ul>
      <div className="mt-2 flex justify-between gap-2">
        {!isStatus ? (
          <button type="button" className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" onClick={() => (multi ? commitMulti([]) : onCommit({ kind: 'select', value: null }))}>
            Clear
          </button>
        ) : (
          <span />
        )}
        {multi && (
          <button type="button" className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-700" onClick={() => commitMulti(chosen)}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}

function DateEditor({ column, value, onCommit, onCancel }: EditorProps) {
  const current = value.kind === 'date' ? value.value : null;
  const start = current ? splitIso(current.start) : null;
  const end = current?.end ? splitIso(current.end) : null;
  const [startDate, setStartDate] = useState(start?.date ?? '');
  const [startTime, setStartTime] = useState(start?.time ?? '09:00');
  const [endDate, setEndDate] = useState(end?.date ?? '');
  const [endTime, setEndTime] = useState(end?.time ?? '17:00');
  const [withTime, setWithTime] = useState(Boolean(start?.time));
  const [withEnd, setWithEnd] = useState(Boolean(end));
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const save = () => {
    if (!startDate) {
      onCommit({ kind: 'date', value: null });
      return;
    }
    const s = withTime ? localIso(startDate, startTime) : startDate;
    const e = withEnd && endDate ? (withTime ? localIso(endDate, endTime) : endDate) : null;
    if (e && new Date(e).getTime() < new Date(s).getTime()) {
      setError('The end is before the start.');
      return;
    }
    onCommit({ kind: 'date', value: { start: s, end: e } });
  };

  return (
    <div
      className="w-72 max-w-full space-y-2 rounded-md border border-slate-300 bg-white p-3 text-sm shadow-lg dark:border-slate-600 dark:bg-slate-900"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          save();
        }
      }}
    >
      <div className="flex gap-2">
        <input ref={first} type="date" aria-label={`${column.name} start date`} className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        {withTime && <input type="time" aria-label={`${column.name} start time`} className={`${inputClass} w-28`} value={startTime} onChange={(e) => setStartTime(e.target.value)} />}
      </div>
      {withEnd && (
        <div className="flex gap-2">
          <input type="date" aria-label={`${column.name} end date`} className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          {withTime && <input type="time" aria-label={`${column.name} end time`} className={`${inputClass} w-28`} value={endTime} onChange={(e) => setEndTime(e.target.value)} />}
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={withEnd} onChange={(e) => setWithEnd(e.target.checked)} /> End date
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} /> Include time
        </label>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-between gap-2">
        <button type="button" className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" onClick={() => onCommit({ kind: 'date', value: null })}>
          Clear
        </button>
        <div className="flex gap-2">
          <button type="button" className="rounded px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-700" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
