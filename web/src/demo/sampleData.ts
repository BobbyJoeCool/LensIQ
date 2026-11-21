/**
 * Fictional sample data for the public demo (Q22). Dates are relative to
 * today so the demo always looks current. No real data, no Notion.
 */
import type { CellValue, Column, Dashboard, DatabaseDetail, Row, SelectOption, View } from '@lensiq/shared';
import { addDays, dayOf } from '../views/query';

export interface DemoDatabase {
  detail: DatabaseDetail;
  rows: (Row & { createdTime: string })[];
}

const opt = (id: string, name: string, color: SelectOption['color']): SelectOption => ({ id, name, color });
const text = (value: string): CellValue => ({ kind: 'text', value });
const date = (start: string | null, end: string | null = null): CellValue => ({ kind: 'date', value: start ? { start, end } : null });

export const JOBS_ID = 'demo-jobs';
export const CONTACTS_ID = 'demo-contacts';
export const BILLS_ID = 'demo-bills';

const status = {
  wish: opt('st-wish', 'Wishlist', 'gray'),
  applied: opt('st-applied', 'Applied', 'blue'),
  screen: opt('st-screen', 'Phone screen', 'purple'),
  interview: opt('st-interview', 'Interviewing', 'yellow'),
  offer: opt('st-offer', 'Offer', 'green'),
  rejected: opt('st-rejected', 'Rejected', 'red'),
};
const tags = {
  frontend: opt('tg-fe', 'Frontend', 'purple'),
  fullstack: opt('tg-fs', 'Full stack', 'pink'),
  remote: opt('tg-remote', 'Remote-first', 'green'),
  startup: opt('tg-startup', 'Startup', 'orange'),
};
const category = {
  utilities: opt('cat-util', 'Utilities', 'blue'),
  housing: opt('cat-house', 'Housing', 'orange'),
  subscriptions: opt('cat-subs', 'Subscriptions', 'purple'),
  insurance: opt('cat-ins', 'Insurance', 'green'),
  transport: opt('cat-car', 'Transport', 'yellow'),
};

const jobColumns: Column[] = [
  { id: 'title', name: 'Company', type: 'title' },
  { id: 'status', name: 'Status', type: 'status', options: Object.values(status) },
  { id: 'role', name: 'Role', type: 'rich_text' },
  { id: 'salary', name: 'Salary', type: 'number', numberFormat: 'dollar' },
  { id: 'applied', name: 'Applied', type: 'date' },
  { id: 'next', name: 'Next step', type: 'date' },
  { id: 'remote', name: 'Remote', type: 'checkbox' },
  { id: 'tags', name: 'Tags', type: 'multi_select', options: Object.values(tags) },
  { id: 'posting', name: 'Posting', type: 'url' },
  { id: 'days', name: 'Days since applied', type: 'formula' },
  { id: 'contacts', name: 'Contacts', type: 'relation', relatedDataSourceId: CONTACTS_ID },
];

const contactColumns: Column[] = [
  { id: 'title', name: 'Name', type: 'title' },
  { id: 'company', name: 'Company', type: 'rich_text' },
  { id: 'email', name: 'Email', type: 'email' },
];

const billColumns: Column[] = [
  { id: 'title', name: 'Bill', type: 'title' },
  { id: 'category', name: 'Category', type: 'select', options: Object.values(category) },
  { id: 'amount', name: 'Amount', type: 'number', numberFormat: 'dollar' },
  { id: 'due', name: 'Due', type: 'date' },
  { id: 'paid', name: 'Paid', type: 'checkbox' },
  { id: 'autopay', name: 'Autopay', type: 'checkbox' },
];

/** "Days since applied" is a Notion formula; the demo computes it. */
export function computeDays(row: Row, today = dayOf(new Date())): Row {
  const a = row.cells.applied;
  if (a?.kind !== 'date' || !a.value) return { ...row, cells: { ...row.cells, days: { kind: 'number', value: null } } };
  const [y, m, d] = a.value.start.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86_400_000);
  return { ...row, cells: { ...row.cells, days: { kind: 'number', value: days } } };
}

export function buildSample(now = new Date()): { databases: DemoDatabase[]; views: View[]; dashboards: Dashboard[] } {
  const today = dayOf(now);
  const ago = (n: number) => addDays(today, -n);
  const ahead = (n: number) => addDays(today, n);
  const iso = now.toISOString();
  let seq = 0;
  const mkRow = (prefix: string, created: string, cells: Record<string, CellValue>) => ({
    id: `${prefix}-${++seq}`,
    url: 'https://www.notion.so/',
    lastEditedTime: iso,
    createdTime: `${created}T12:00:00.000Z`,
    cells,
  });

  const contacts = [
    ['Priya Raman', 'Northwind Labs', 'priya@northwind.example'],
    ['Marcus Chen', 'Contoso Analytics', 'marcus@contoso.example'],
    ['Sofia Alvarez', 'Fabrikam Health', 'sofia@fabrikam.example'],
    ['Jordan Blake', 'Tailspin Toys', 'jordan@tailspin.example'],
    ['Amara Okafor', 'Litware', 'amara@litware.example'],
  ].map(([n, c, e]) => mkRow('c', ago(60), { title: text(n!), company: text(c!), email: { kind: 'link', value: e!, linkType: 'email' } }));
  const contactId = (company: string) => contacts.find((c) => (c.cells.company as { value: string }).value === company)?.id;

  type J = [string, keyof typeof status, string, number | null, number, number | null, boolean, (keyof typeof tags)[]];
  const jobs: J[] = [
    ['Northwind Labs', 'interview', 'Senior Frontend Engineer', 145000, 34, 2, true, ['frontend', 'remote']],
    ['Contoso Analytics', 'applied', 'Full Stack Developer', null, 9, null, false, ['fullstack']],
    ['Fabrikam Health', 'screen', 'Software Engineer II', 120000, 16, 4, true, ['fullstack', 'remote']],
    ['Tailspin Toys', 'offer', 'React Developer', 132000, 41, 1, true, ['frontend', 'startup']],
    ['Litware', 'rejected', 'UI Engineer', 118000, 52, null, false, ['frontend']],
    ['Adatum Corp', 'applied', 'Platform Engineer', 150000, 5, null, true, ['remote']],
    ['Woodgrove Bank', 'interview', 'Frontend Lead', 165000, 23, 6, false, ['frontend']],
    ['Proseware', 'applied', 'Full Stack Engineer', 128000, 12, null, true, ['fullstack', 'startup']],
    ['Lucerne Publishing', 'rejected', 'Web Developer', 98000, 47, null, false, []],
    ['Coho Winery', 'wish', 'Developer Advocate', null, 0, null, true, ['remote']],
    ['Alpine Ski House', 'screen', 'TypeScript Engineer', 125000, 19, 3, true, ['fullstack']],
    ['Trey Research', 'applied', 'Data Viz Engineer', 140000, 3, null, true, ['frontend', 'remote']],
    ['Wingtip Toys', 'rejected', 'Junior Frontend Dev', 85000, 38, null, false, ['frontend']],
    ['Margie’s Travel', 'applied', 'Software Engineer', 115000, 27, null, false, ['fullstack']],
    ['Humongous Insurance', 'interview', 'Senior Engineer', 155000, 30, 8, true, ['fullstack', 'remote']],
    ['Blue Yonder Airlines', 'applied', 'Frontend Engineer', 122000, 14, null, true, ['frontend']],
    ['Fourth Coffee', 'wish', 'Product Engineer', null, 0, null, false, ['startup']],
  ];
  const jobRows = jobs.map(([company, st, role, salary, daysAgo, nextIn, remote, tg]) =>
    computeDays(
      mkRow('j', ago(daysAgo || 1), {
        title: text(company),
        status: { kind: 'select', value: status[st] },
        role: text(role),
        salary: { kind: 'number', value: salary },
        applied: date(st === 'wish' ? null : ago(daysAgo)),
        next: date(nextIn === null ? null : ahead(nextIn)),
        remote: { kind: 'boolean', value: remote },
        tags: { kind: 'multi_select', value: tg.map((t) => tags[t]) },
        posting: { kind: 'link', value: `https://jobs.example.com/${company.toLowerCase().replace(/[^a-z]+/g, '-')}`, linkType: 'url' },
        contacts: { kind: 'relation', value: contactId(company) ? [contactId(company)!] : [], hasMore: false },
      }),
      today,
    ) as Row & { createdTime: string },
  );

  type B = [string, keyof typeof category, number, number, boolean, boolean];
  const bills: B[] = [
    ['Rent', 'housing', 1650, 2, false, true],
    ['Electric', 'utilities', 94.12, 5, false, false],
    ['Water & sewer', 'utilities', 48.3, 9, false, false],
    ['Internet', 'utilities', 70, -3, true, true],
    ['Streaming bundle', 'subscriptions', 22.99, 1, false, true],
    ['Music', 'subscriptions', 10.99, 12, false, true],
    ['Car insurance', 'insurance', 132.5, 6, false, false],
    ['Renters insurance', 'insurance', 18, 15, false, true],
    ['Car payment', 'transport', 289, -1, true, false],
    ['Transit pass', 'transport', 75, 20, false, false],
    ['Phone', 'utilities', 55, -8, true, true],
    ['Cloud storage', 'subscriptions', 2.99, 24, false, true],
  ];
  const billRows = bills.map(([name, cat, amount, dueIn, paid, autopay]) =>
    mkRow('b', ago(45), {
      title: text(name),
      category: { kind: 'select', value: category[cat] },
      amount: { kind: 'number', value: amount },
      due: date(ahead(dueIn)),
      paid: { kind: 'boolean', value: paid },
      autopay: { kind: 'boolean', value: autopay },
    }),
  );

  const db = (id: string, name: string, columns: Column[], rows: DemoDatabase['rows']): DemoDatabase => ({
    detail: { id, databaseId: id, name, lastSyncedAt: iso, rowCount: rows.length, schema: { columns } },
    rows,
  });

  const base = { filters: [], filterMode: 'and' as const, sorts: [] };
  const chartBase = { ...base, x: null, dateGrouping: 'month' as const, aggregation: 'count' as const, y: null, splitBy: null, horizontal: false, stacked: false, cumulative: false, sortBy: 'x' as const, hideEmpty: false };
  let vpos = 0;
  const view = (id: string, databaseId: string, name: string, type: View['type'], config: View['config']): View => ({
    id,
    databaseId,
    name,
    type,
    config,
    position: vpos++,
    createdAt: iso,
    updatedAt: iso,
  });
  const views: View[] = [
    view('v-jobs-table', JOBS_ID, 'All applications', 'table', { ...base, sorts: [{ columnId: 'applied', direction: 'desc' }], hidden: ['posting'] }),
    view('v-jobs-board', JOBS_ID, 'Pipeline', 'board', { ...base, groupBy: 'status', cardFields: ['role', 'next'], hideEmptyGroups: false }),
    view('v-jobs-weekly', JOBS_ID, 'Applications per week', 'chart', { ...chartBase, chartType: 'bar', x: 'applied', dateGrouping: 'week', splitBy: 'remote', stacked: true }),
    view('v-jobs-status', JOBS_ID, 'By status', 'chart', { ...chartBase, chartType: 'pie', x: 'status' }),
    view('v-jobs-salary', JOBS_ID, 'Average salary', 'chart', { ...chartBase, chartType: 'stat', aggregation: 'avg', y: 'salary', filters: [{ id: 'f1', columnId: 'status', op: 'none_of', value: ['st-rejected', 'st-wish'] }] }),
    view('v-jobs-next', JOBS_ID, 'Next step this week', 'table', { ...base, filters: [{ id: 'f2', columnId: 'next', op: 'next_days', value: 7 }], sorts: [{ columnId: 'next', direction: 'asc' }], hidden: ['posting', 'tags', 'contacts', 'salary', 'days', 'remote'] }),
    view('v-jobs-cal', JOBS_ID, 'Next steps', 'calendar', { ...base, dateColumn: 'next', colorBy: 'status' }),
    view('v-contacts', CONTACTS_ID, 'Contacts', 'table', { ...base, hidden: [] }),
    view('v-bills-table', BILLS_ID, 'All bills', 'table', { ...base, sorts: [{ columnId: 'due', direction: 'asc' }], hidden: [] }),
    view('v-bills-due', BILLS_ID, 'Due in 7 days', 'table', { ...base, filters: [{ id: 'f3', columnId: 'due', op: 'next_days', value: 7 }, { id: 'f4', columnId: 'paid', op: 'unchecked' }], sorts: [{ columnId: 'due', direction: 'asc' }], hidden: ['autopay'] }),
    view('v-bills-cal', BILLS_ID, 'Calendar', 'calendar', { ...base, dateColumn: 'due', colorBy: 'category' }),
    view('v-bills-cat', BILLS_ID, 'Spend by category', 'chart', { ...chartBase, chartType: 'bar', x: 'category', aggregation: 'sum', y: 'amount', sortBy: 'value', horizontal: true }),
    view('v-bills-total', BILLS_ID, 'Unpaid total', 'chart', { ...chartBase, chartType: 'stat', aggregation: 'sum', y: 'amount', filters: [{ id: 'f5', columnId: 'paid', op: 'unchecked' }] }),
  ];
  const dashboards: Dashboard[] = [
    {
      id: 'd-jobs',
      name: 'Job Search',
      tiles: [
        { id: 't1', viewId: 'v-jobs-board', size: 'full' },
        { id: 't2', viewId: 'v-jobs-weekly', size: 'large' },
        { id: 't3', viewId: 'v-jobs-salary', size: 'small' },
        { id: 't4', viewId: 'v-jobs-status', size: 'medium' },
        { id: 't5', viewId: 'v-jobs-next', size: 'medium' },
      ],
      createdAt: iso,
      updatedAt: iso,
    },
    {
      id: 'd-friday',
      name: 'Friday Review',
      tiles: [
        { id: 't6', viewId: 'v-bills-due', size: 'large' },
        { id: 't7', viewId: 'v-bills-total', size: 'small' },
        { id: 't8', viewId: 'v-bills-cat', size: 'medium' },
        { id: 't9', viewId: 'v-bills-cal', size: 'medium' },
      ],
      createdAt: iso,
      updatedAt: iso,
    },
  ];
  return {
    databases: [db(JOBS_ID, 'Job Search Tracker', jobColumns, jobRows), db(BILLS_ID, 'Household Bills', billColumns, billRows), db(CONTACTS_ID, 'Contacts', contactColumns, contacts)],
    views,
    dashboards,
  };
}
