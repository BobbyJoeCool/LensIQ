/** Small shared controls: a popover menu, a labeled select and a toggle. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // The panel is portalled to <body> with fixed positioning, so a parent that
  // scrolls or clips (like the sideways-scrolling view tab bar, #43) can't hide it.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = ref.current?.getBoundingClientRect();
      if (!button) return;
      const vw = document.documentElement.clientWidth;
      const width = Math.min(352, vw - 32);
      const wanted = align === 'right' ? button.right - width : button.left;
      setPos({ top: button.bottom + 4, left: Math.max(16, Math.min(wanted, vw - width - 16)), width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
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
    <div ref={ref} className="relative shrink-0">
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
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            style={pos ? { top: pos.top, left: pos.left, width: pos.width } : { visibility: 'hidden' }}
            className="fixed z-40 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-xl dark:border-slate-700 dark:bg-slate-900"
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
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
