/**
 * A fake NotionSource for E2E tests. It returns raw, Notion-shaped property
 * data and runs it through the real normalizer, so E2E covers the same code
 * path as production minus the network. All data is fictional.
 */
import { extractNotionId } from '@notionhq/client';
import { AppError } from '../../src/errors.js';
import type { NotionSource, ResolvedSource, SourceSnapshot } from '../../src/notion/source.js';
import { toCells, toSchema, type RawProperty } from '../../src/notion/normalize.js';
import type { StoredRow } from '../../src/store.js';

export const JOB_SEARCH_DB_ID = '1f2e3d4c5b6a47988796a5b4c3d2e1f0';
export const JOB_SEARCH_DS_ID = 'aaaabbbb-cccc-4ddd-8eee-ffff00001111';
/** A valid-looking ID the integration "can't see". */
export const UNSHARED_DB_ID = '00000000000000000000000000000bad';

const statusOptions = [
  { id: 's1', name: 'Applied', color: 'blue' },
  { id: 's2', name: 'Interviewing', color: 'yellow' },
  { id: 's3', name: 'Offer', color: 'green' },
  { id: 's4', name: 'Rejected', color: 'red' },
];

const properties: Record<string, RawProperty> = {
  Status: { id: 'stat', name: 'Status', type: 'status', status: { options: statusOptions } },
  Company: { id: 'title', name: 'Company', type: 'title', title: {} },
  Role: { id: 'role', name: 'Role', type: 'rich_text', rich_text: {} },
  Salary: { id: 'sal', name: 'Salary', type: 'number', number: { format: 'dollar' } },
  Applied: { id: 'appl', name: 'Applied', type: 'date', date: {} },
  Remote: { id: 'rem', name: 'Remote', type: 'checkbox', checkbox: {} },
  Posting: { id: 'url', name: 'Posting', type: 'url', url: {} },
  Tags: {
    id: 'tags',
    name: 'Tags',
    type: 'multi_select',
    multi_select: { options: [{ id: 't1', name: 'Frontend', color: 'purple' }, { id: 't2', name: 'Full stack', color: 'pink' }] },
  },
  'Days Since Applied': { id: 'days', name: 'Days Since Applied', type: 'formula', formula: { expression: '' } },
  Contacts: { id: 'rel', name: 'Contacts', type: 'relation', relation: {} },
  Action: { id: 'btn', name: 'Action', type: 'button', button: {} },
};

const text = (s: string) => [{ type: 'text', plain_text: s, text: { content: s } }];

function page(
  id: string,
  created: string,
  v: { company: string; role: string; status: string; salary: number | null; applied: string; remote: boolean; url: string | null; tags: string[]; days: number; contacts: number },
) {
  const opt = statusOptions.find((o) => o.name === v.status)!;
  const props: Record<string, RawProperty> = {
    Company: { id: 'title', type: 'title', title: text(v.company) },
    Role: { id: 'role', type: 'rich_text', rich_text: text(v.role) },
    Status: { id: 'stat', type: 'status', status: opt },
    Salary: { id: 'sal', type: 'number', number: v.salary },
    Applied: { id: 'appl', type: 'date', date: { start: v.applied, end: null, time_zone: null } },
    Remote: { id: 'rem', type: 'checkbox', checkbox: v.remote },
    Posting: { id: 'url', type: 'url', url: v.url },
    Tags: {
      id: 'tags',
      type: 'multi_select',
      multi_select: v.tags.map((t) => (t === 'Frontend' ? { id: 't1', name: t, color: 'purple' } : { id: 't2', name: t, color: 'pink' })),
    },
    'Days Since Applied': { id: 'days', type: 'formula', formula: { type: 'number', number: v.days } },
    Contacts: { id: 'rel', type: 'relation', relation: Array.from({ length: v.contacts }, (_, i) => ({ id: `c${i}` })), has_more: false },
    Action: { id: 'btn', type: 'button', button: {} },
  };
  return { id, url: `https://www.notion.so/${id.replace(/-/g, '')}`, created_time: created, last_edited_time: created, properties: props };
}

const BASE_PAGES = [
  page('p-1', '2026-10-01T15:00:00.000Z', {
    company: 'Northwind Labs', role: 'Senior Frontend Engineer', status: 'Interviewing', salary: 145000,
    applied: '2026-10-01', remote: true, url: 'https://jobs.example.com/northwind', tags: ['Frontend'], days: 47, contacts: 2,
  }),
  page('p-2', '2026-10-12T15:00:00.000Z', {
    company: 'Contoso Analytics', role: 'Full Stack Developer', status: 'Applied', salary: null,
    applied: '2026-10-12', remote: false, url: null, tags: ['Full stack', 'Frontend'], days: 36, contacts: 0,
  }),
];

const LATER_PAGE = page('p-3', '2026-11-15T15:00:00.000Z', {
  company: 'Fabrikam Health', role: 'Software Engineer II', status: 'Applied', salary: 120000,
  applied: '2026-11-15', remote: true, url: 'https://jobs.example.com/fabrikam', tags: [], days: 2, contacts: 1,
});

/**
 * The first full load returns two rows. Every later load also returns a third
 * row, which simulates an edit made in Notion and lets E2E test Refresh.
 */
export class FixtureNotionSource implements NotionSource {
  private loads = 0;

  reset(): void {
    this.loads = 0;
  }

  async resolve(idOrUrl: string): Promise<ResolvedSource> {
    const id = extractNotionId(idOrUrl.trim());
    if (!id) throw new AppError(400, 'invalid_id', 'That doesn’t look like a Notion database link or ID.');
    if (id.replace(/-/g, '') === JOB_SEARCH_DB_ID) return { dataSourceId: JOB_SEARCH_DS_ID, databaseId: JOB_SEARCH_DB_ID };
    throw new AppError(
      404,
      'notion_not_found',
      'Notion couldn\'t find that database. Check the ID, and make sure the database is shared with the LensIQ connection in Notion (··· menu → Connections).',
    );
  }

  async fetchSchema(): Promise<SourceSnapshot> {
    return { name: 'Job Search Tracker', schema: toSchema(properties) };
  }

  async fetchRows(): Promise<StoredRow[]> {
    const pages = this.loads++ === 0 ? BASE_PAGES : [...BASE_PAGES, LATER_PAGE];
    return pages.map((p) => ({
      id: p.id,
      url: p.url,
      createdTime: p.created_time,
      lastEditedTime: p.last_edited_time,
      cells: toCells(p.properties),
    }));
  }
}
