import { expect, test } from '@playwright/test';

// Runs against the static demo build (npm run build:demo), served under /LensIQ/ like GitHub Pages.

test('the demo opens on its first dashboard with a banner, and its dashboards render', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('demo-banner')).toContainText('made-up sample data');
  await expect(page.getByRole('heading', { name: 'Job Search', exact: true })).toBeVisible(); // opens on the first dashboard (#50)
  await expect(page.getByRole('listitem', { name: /^Interviewing/ })).toBeVisible(); // pipeline board tile
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  await expect(page.getByTestId('stat-value')).toContainText('$');
  await page.getByRole('link', { name: 'Friday Review' }).click();
  await expect(page.getByRole('heading', { name: 'Friday Review' })).toBeVisible();
  await expect(page.getByRole('grid').first()).toBeVisible(); // calendar tile
});

test('visitors can edit, and a reload resets to the sample data', async ({ page }) => {
  await page.goto('./#/db/demo-jobs');
  const row = page.getByRole('table', { name: 'Database rows' }).getByRole('row').filter({ hasText: 'Contoso Analytics' });
  await row.getByRole('cell', { name: 'Edit Role' }).click();
  await page.getByLabel('Role', { exact: true }).fill('Changed in the demo');
  await page.getByLabel('Role', { exact: true }).press('Enter');
  await expect(row).toContainText('Changed in the demo');
  await page.reload();
  await expect(page.getByRole('table', { name: 'Database rows' }).getByRole('row').filter({ hasText: 'Contoso Analytics' })).toContainText('Full Stack Developer');
});

test('the demo explains it cannot connect real Notion databases', async ({ page }) => {
  await page.goto('./#/add');
  await page.getByLabel('Notion database link or ID').fill('1f2e3d4c5b6a47988796a5b4c3d2e1f0');
  await page.getByRole('button', { name: 'Add database' }).click();
  await expect(page.getByRole('alert')).toContainText('demo');
});

test('with many views, "+ Add view" stays fully visible and its menu opens (#46)', async ({ page }) => {
  await page.goto('./#/db/demo-jobs/v/v-jobs-board');
  await expect(page.getByRole('heading', { name: 'Job Search Tracker' })).toBeVisible();
  const add = page.getByRole('button', { name: '+ Add view' });
  await expect(add).toBeInViewport({ ratio: 1 });
  await add.click();
  await page.getByRole('button', { name: /Calendar$/ }).click();
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: /Calendar/ })).toHaveAttribute('aria-current', 'page');
});
