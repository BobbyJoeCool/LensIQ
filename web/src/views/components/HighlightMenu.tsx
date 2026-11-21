import type { Column, HighlightColor, HighlightRule, Row } from '@lensiq/shared';
import { Field, Popover, fieldClass, smallButton } from '../../components/ui';
import { HIGHLIGHT_CLASSES, HIGHLIGHT_LABELS } from '../highlight';
import { FilterList, newFilter } from './FilterMenu';

let seq = 0;
const newId = () => `h${Date.now().toString(36)}${(seq++).toString(36)}`;

interface Props {
  columns: Column[];
  rows: Row[];
  rules: HighlightRule[];
  onChange: (rules: HighlightRule[]) => void;
}

/**
 * Table highlight rules (#51): each is a color, a target (the whole row or
 * one column's cell) and conditions built like filters. The first matching
 * rule wins, so rules can be moved up and down.
 */
export function HighlightMenu({ columns, rows, rules, onChange }: Props) {
  const set = (i: number, patch: Partial<HighlightRule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) => {
    const next = [...rules];
    const [r] = next.splice(i, 1);
    next.splice(i + by, 0, r!);
    onChange(next);
  };
  const add = () => {
    const f = newFilter(columns, rows);
    onChange([...rules, { id: newId(), filters: f ? [f] : [], filterMode: 'and', color: 'yellow', columnId: null }]);
  };
  const label = rules.length ? `Highlight (${rules.length})` : 'Highlight';

  return (
    <Popover label={label} active={rules.length > 0}>
      {() => (
        <div className="space-y-3" aria-label="Highlight rules">
          {rules.length === 0 && <p className="text-slate-500">No rules. Color rows or cells that match conditions, like “Status is Rejected”.</p>}
          {rules.length > 1 && <p className="text-xs text-slate-500">When several rules match, the first one wins.</p>}
          {rules.map((rule, i) => (
            <fieldset key={rule.id} className="space-y-2 rounded-md border border-slate-200 p-2 dark:border-slate-700" aria-label={`Rule ${i + 1}`}>
              <legend className="sr-only">Rule {i + 1}</legend>
              <div className="flex items-end gap-1.5">
                <span aria-hidden className={`mb-2 inline-block h-5 w-5 shrink-0 rounded border border-slate-300 dark:border-slate-600 ${HIGHLIGHT_CLASSES[rule.color]}`} />
                <Field label="Color">
                  <select aria-label="Highlight color" className={fieldClass} value={rule.color} onChange={(e) => set(i, { color: e.target.value as HighlightColor })}>
                    {(Object.keys(HIGHLIGHT_LABELS) as HighlightColor[]).map((c) => (
                      <option key={c} value={c}>
                        {HIGHLIGHT_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Color what">
                  <select aria-label="Highlight target" className={fieldClass} value={rule.columnId ?? ''} onChange={(e) => set(i, { columnId: e.target.value || null })}>
                    <option value="">Whole row</option>
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} cell
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <FilterList
                columns={columns}
                rows={rows}
                filters={rule.filters}
                filterMode={rule.filterMode}
                onChange={(filters, filterMode) => set(i, { filters, filterMode })}
                empty="Add a condition: this rule highlights nothing yet."
                matchLabel="Highlight rows that match"
                addLabel="+ Add condition"
                noun="condition"
              />
              <div className="flex justify-end gap-1">
                <button type="button" aria-label="Move rule up" className={smallButton} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" aria-label="Move rule down" className={smallButton} disabled={i === rules.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className={`${smallButton} text-red-700 dark:text-red-400`} onClick={() => onChange(rules.filter((_, j) => j !== i))}>
                  Remove rule
                </button>
              </div>
            </fieldset>
          ))}
          <button type="button" className={smallButton} onClick={add}>
            + Add rule
          </button>
        </div>
      )}
    </Popover>
  );
}
