import { expect, test, type Page } from '@playwright/test';

const JOB_SEARCH_URL = 'https://www.notion.so/myworkspace/Job-Search-1f2e3d4c5b6a47988796a5b4c3d2e1f0?v=abc';
const UNSHARED_ID = '00000000000000000000000000000bad';

test.beforeEach(async ({ request }) => {
  await request.post('/__e2e/reset');
});

async function addJobSearch(page: Page) {
  await page.goto('/');
  await page.getByLabel('Notion database link or ID').fill(JOB_SEARCH_URL);
  await page.getByRole('button', { name: 'Add database' }).click();
  await expect(page.getByRole('heading', { name: 'Job Search Tracker' })).toBeVisible();
}

test('first visit shows the add-database screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Add a Notion database' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add database' })).toBeDisabled();
});

test('rejects text that is not a Notion link or ID', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Notion database link or ID').fill('not a link');
  await page.getByRole('button', { name: 'Add database' }).click();
  await expect(page.getByRole('alert')).toContainText('doesn’t look like a Notion database');
});

test('explains how to share a database the connection cannot see', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Notion database link or ID').fill(UNSHARED_ID);
  await page.getByRole('button', { name: 'Add database' }).click();
  await expect(page.getByRole('alert')).toContainText('Connections');
});

test('adding a database renders a typed table', async ({ page }) => {
  await addJobSearch(page);

  const table = page.getByRole('table', { name: 'Database rows' });
  // Title column comes first.
  await expect(table.getByRole('columnheader').first()).toHaveText('Company');
  await expect(page.getByTestId('sync-status')).toContainText('2 rows · synced just now');

  const northwind = table.getByRole('row').filter({ hasText: 'Northwind Labs' });
  await expect(northwind).toContainText('Senior Frontend Engineer');
  await expect(northwind).toContainText('Interviewing'); // status chip
  await expect(northwind).toContainText('$145,000.00'); // dollar format
  await expect(northwind).toContainText('Oct 1, 2026'); // date-only, no timezone shift
  await expect(northwind.getByRole('img', { name: 'Checked' })).toBeVisible();
  await expect(northwind.getByRole('link', { name: 'https://jobs.example.com/northwind' })).toHaveAttribute(
    'href',
    'https://jobs.example.com/northwind',
  );
  await expect(northwind).toContainText('47'); // formula result
  await expect(northwind).toContainText('2 linked'); // relation
  await expect(northwind).toContainText('not shown'); // unsupported button column
  await expect(northwind.getByRole('link', { name: 'Open in Notion' })).toHaveAttribute(
    'href',
    /notion\.so\/p1/,
  );

  const contoso = table.getByRole('row').filter({ hasText: 'Contoso Analytics' });
  await expect(contoso.getByRole('img', { name: 'Not checked' })).toBeVisible();
  await expect(contoso).toContainText('Full stack');
});

test('the database appears in the nav and survives a reload from cache', async ({ page }) => {
  await addJobSearch(page);
  await expect(page.getByRole('navigation', { name: 'Databases' }).getByRole('link', { name: 'Job Search Tracker' })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('sync-status')).toContainText('2 rows'); // cache, not a new load
});

test('adding the same database twice is refused', async ({ page }) => {
  await addJobSearch(page);
  await page.getByRole('link', { name: '+ Add database' }).click();
  await page.getByLabel('Notion database link or ID').fill(JOB_SEARCH_URL);
  await page.getByRole('button', { name: 'Add database' }).click();
  await expect(page.getByRole('alert')).toContainText('already connected');
});

test('Refresh reloads rows from Notion', async ({ page, request }) => {
  await addJobSearch(page);
  await request.post('/__e2e/notion/add-row'); // someone adds a row in Notion
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByTestId('sync-status')).toContainText('3 rows');
  await expect(page.getByRole('row').filter({ hasText: 'Fabrikam Health' })).toBeVisible();
});

test('an unknown database link shows an error', async ({ page }) => {
  await page.goto('/#/db/does-not-exist');
  await expect(page.getByRole('alert')).toContainText('No connected database');
});
