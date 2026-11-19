/** Small shared controls: a popover menu, a labeled select and a toggle. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function Popover({
  label,
  children,
  active = false,
  align = 'left',
  buttonClassName,
}: {
  label: ReactNode;
  children: (close: () => void) => ReactNode;
  /** Highlights the button (e.g. when filters are set). */
  active?: boolean;
  align?: 'left' | 'right';
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={
          buttonClassName ??
          `min-h-9 rounded-md px-2.5 text-sm font-medium whitespace-nowrap ${
            active ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100' : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800'
          }`
        }
      >
        {label}
      </button>
      {open && (
        <div
          id={id}
          className={`absolute z-40 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-xl dark:border-slate-700 dark:bg-slate-900 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export const fieldClass =
  'min-h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: { value: T | ''; label: string }[];
  onChange: (v: T | null) => void;
}) {
  return (
    <Field label={label}>
      <select className={fieldClass} value={value ?? ''} onChange={(e) => onChange((e.target.value || null) as T | null)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-9 items-center gap-2">
      <input type="checkbox" className="h-4 w-4 accent-sky-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export const smallButton =
  'min-h-8 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800';
