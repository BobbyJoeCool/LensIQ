/** Shared test data for view engine tests: a small fictional Job Search database. */
import type { CellValue, Column, Row, SelectOption } from '@lensiq/shared';

export const applied = { id: 's1', name: 'Applied', color: 'blue' } as SelectOption;
export const interviewing = { id: 's2', name: 'Interviewing', color: 'yellow' } as SelectOption;
export const offer = { id: 's3', name: 'Offer', color: 'green' } as SelectOption;
export const frontend = { id: 't1', name: 'Frontend', color: 'purple' } as SelectOption;
export const fullstack = { id: 't2', name: 'Full stack', color: 'pink' } as SelectOption;

export const columns: Column[] = [
  { id: 'title', name: 'Company', type: 'title' },
  { id: 'stat', name: 'Status', type: 'status', options: [applied, interviewing, offer] },
  { id: 'sal', name: 'Salary', type: 'number', numberFormat: 'dollar' },
  { id: 'appl', name: 'Applied', type: 'date' },
  { id: 'rem', name: 'Remote', type: 'checkbox' },
  { id: 'tags', name: 'Tags', type: 'multi_select', options: [frontend, fullstack] },
  { id: 'days', name: 'Days', type: 'formula' },
  { id: 'city', name: 'City', type: 'rich_text' },
];

function row(id: string, v: { company: string; status: SelectOption; salary: number | null; applied: string | null; remote: boolean; tags: SelectOption[]; city: string }): Row {
  const cells: Record<string, CellValue> = {
    title: { kind: 'text', value: v.company },
    stat: { kind: 'select', value: v.status },
    sal: { kind: 'number', value: v.salary },
    appl: { kind: 'date', value: v.applied ? { start: v.applied, end: null } : null },
    rem: { kind: 'boolean', value: v.remote },
    tags: { kind: 'multi_select', value: v.tags },
    days: { kind: 'number', value: v.salary ? 10 : null },
    city: { kind: 'text', value: v.city },
  };
  return { id, url: `https://notion.so/${id}`, lastEditedTime: '', cells };
}

export const rows: Row[] = [
  row('a', { company: 'Northwind', status: interviewing, salary: 145000, applied: '2026-10-01', remote: true, tags: [frontend], city: 'Chicago' }),
  row('b', { company: 'Contoso', status: applied, salary: null, applied: '2026-10-12', remote: false, tags: [fullstack, frontend], city: 'Austin' }),
  row('c', { company: 'Fabrikam', status: applied, salary: 120000, applied: '2026-11-15', remote: true, tags: [], city: '' }),
  row('d', { company: 'Adatum', status: offer, salary: 160000, applied: null, remote: false, tags: [fullstack], city: 'chicago' }),
];
