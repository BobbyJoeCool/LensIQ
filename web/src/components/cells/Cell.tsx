/**
 * Read-only cell renderers, one per normalized value kind. The column supplies
 * extra context such as the number format.
 */
import type { CellValue, Column, SelectOption } from '@lensiq/shared';
import { api } from '../../api';
import { useCellContext, useRelationOptions } from '../../cellContext';
import { OPTION_COLORS, formatDate, formatNumber } from '../../format';

const Empty = () => <span className="text-slate-300 dark:text-slate-600">—</span>;

function Chip({ option }: { option: SelectOption }) {
  return (
    <span
      className={`inline-block max-w-full truncate rounded px-1.5 py-0.5 text-xs font-medium ${OPTION_COLORS[option.color] ?? OPTION_COLORS.default}`}
    >
      {option.name}
    </span>
  );
}

function hrefFor(value: string, linkType: 'url' | 'email' | 'phone_number'): string {
  if (linkType === 'email') return `mailto:${value}`;
  if (linkType === 'phone_number') return `tel:${value.replace(/[^\d+]/g, '')}`;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/** Linked page titles as chips; falls back to a count when titles aren't available. */
function RelationCell({ value, column }: { value: Extract<CellValue, { kind: 'relation' }>; column: Column }) {
  const options = useRelationOptions(column);
  if (!value.value.length) return <Empty />;
  const titles = new Map((options.data?.options ?? []).map((o) => [o.id.replace(/-/g, ''), o.title]));
  const named = value.value.map((id) => titles.get(id.replace(/-/g, ''))).filter((t): t is string => !!t);
  if (named.length === 0) {
    return (
      <span className="text-slate-600 dark:text-slate-300" title={options.data && !options.data.available ? 'Share the related database with the LensIQ connection to see titles' : undefined}>
        {value.value.length}
        {value.hasMore ? '+' : ''} linked
      </span>
    );
  }
  const shown = named.slice(0, 3);
  const extra = value.value.length - shown.length;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((t, i) => (
        <span key={i} className="max-w-full truncate rounded border border-slate-200 px-1.5 py-0.5 text-xs dark:border-slate-700">
          ↗ {t}
        </span>
      ))}
      {(extra > 0 || value.hasMore) && <span className="text-xs text-slate-500">+{extra}{value.hasMore ? '+' : ''}</span>}
    </span>
  );
}

export function Cell({ value, column, rowId }: { value: CellValue | undefined; column: Column; rowId?: string }) {
  const ctx = useCellContext();
  if (!value) return <Empty />;
  switch (value.kind) {
    case 'text':
      return value.value ? <span className="whitespace-pre-line">{value.value}</span> : <Empty />;

    case 'number':
      return value.value === null ? (
        <Empty />
      ) : (
        <span className="tabular-nums">{formatNumber(value.value, column.numberFormat)}</span>
      );

    case 'boolean':
      return (
        <span
          role="img"
          aria-label={value.value ? 'Checked' : 'Not checked'}
          className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] leading-none ${
            value.value
              ? 'border-sky-600 bg-sky-600 text-white'
              : 'border-slate-300 dark:border-slate-600'
          }`}
        >
          {value.value ? '✓' : ''}
        </span>
      );

    case 'date':
      return value.value ? <span className="whitespace-nowrap">{formatDate(value.value)}</span> : <Empty />;

    case 'select':
      return value.value ? <Chip option={value.value} /> : <Empty />;

    case 'multi_select':
      return value.value.length ? (
        <span className="flex flex-wrap gap-1">
          {value.value.map((o) => (
            <Chip key={o.id} option={o} />
          ))}
        </span>
      ) : (
        <Empty />
      );

    case 'link':
      return value.value ? (
        <a
          href={hrefFor(value.value, value.linkType)}
          target={value.linkType === 'url' ? '_blank' : undefined}
          rel="noreferrer"
          className="block max-w-xs truncate text-sky-700 underline decoration-sky-300 underline-offset-2 hover:decoration-sky-700 dark:text-sky-400 dark:decoration-sky-700"
        >
          {value.value}
        </a>
      ) : (
        <Empty />
      );

    case 'people':
      return value.value.length ? <span>{value.value.join(', ')}</span> : <Empty />;

    case 'relation':
      return <RelationCell value={value} column={column} />;

    case 'files':
      return value.value.length ? (
        <span className="flex flex-col gap-0.5">
          {value.value.map((f, i) =>
            f.url ? (
              <a
                key={i}
                // Notion-hosted links expire after about an hour: go through the API for a fresh one (#31).
                href={f.hosted && ctx && rowId ? api.fileHref(ctx.dbId, rowId, column.id, i) : f.url}
                onClick={(e) => e.stopPropagation()}
                target="_blank"
                rel="noreferrer"
                className="max-w-xs truncate text-sky-700 underline underline-offset-2 dark:text-sky-400"
              >
                {f.name}
              </a>
            ) : (
              <span key={i}>{f.name}</span>
            ),
          )}
        </span>
      ) : (
        <Empty />
      );

    case 'list':
      return value.value.length ? (
        <span className="flex flex-wrap gap-x-2 gap-y-1">
          {value.value.map((v, i) => (
            <Cell key={i} value={v} column={column} rowId={rowId} />
          ))}
        </span>
      ) : (
        <Empty />
      );

    case 'empty':
      return <Empty />;

    case 'unsupported':
      return (
        <span className="text-xs italic text-slate-400" title={`Notion type "${value.notionType}" isn't shown yet`}>
          not shown
        </span>
      );
  }
}
