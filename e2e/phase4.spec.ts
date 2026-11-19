import { expect, test, type Page } from '@playwright/test';

const JOB_SEARCH_ID = '1f2e3d4c5b6a47988796a5b4c3d2e1f0';

test.beforeEach(async ({ request }) => {
  await request.post('/__e2e/reset');
});

async function addJobSearch(page: Page) {
  await page.goto('/');
  await page.getByLabel('Notion database link or ID').fill(JOB_SEARCH_ID);
  await page.getByRole('button', { name: 'Add database' }).click();
  await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible();
}

const rowOf = (page: Page, text: string) => page.getByRole('table', { name: 'Database rows' }).getByRole('row').filter({ hasText: text });

test('pick related pages by title (desktop)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'inline editing is desktop-only');
  await addJobSearch(page);
  await rowOf(page, 'Contoso').getByRole('cell', { name: 'Edit Contacts' }).click();
  await page.getByLabel('Contacts', { exact: true }).fill('alan');
  await page.getByRole('option', { name: 'Alan Turing' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(rowOf(page, 'Contoso')).toContainText('Alan Turing');
  await page.reload();
  await expect(rowOf(page, 'Contoso')).toContainText('Alan Turing');
});

test('file links fetch a fresh URL every time', async ({ page, request }) => {
  await addJobSearch(page);
  const link = rowOf(page, 'Northwind').getByRole('link', { name: 'resume.pdf' });
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^\/api\/databases\/.+\/rows\/p-1\/files\/file\/0$/);
  const a = await request.get(href!, { maxRedirects: 0 });
  const b = await request.get(href!, { maxRedirects: 0 });
  expect(a.status()).toBe(302);
  expect(a.headers().location).toMatch(/resume\.pdf\?sig=\d+/);
  expect(b.headers().location).not.toBe(a.headers().location);
});

test('calendar: rows on their dates, drag to move a date, + adds a row on a day (desktop)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'month grid is desktop; phones get the agenda');
  await addJobSearch(page);
  await page.getByRole('button', { name: '+ Add view' }).click();
  await page.getByRole('button', { name: /Calendar$/ }).click();
  // The fixture's dates are in October 2026; step back from the current month.
  for (let i = 0; i < 36 && !(await page.getByRole('heading', { name: 'October 2026' }).isVisible()); i++) {
    await page.getByRole('button', { name: 'Previous month' }).click();
  }
  const oct1 = page.getByRole('gridcell', { name: '2026-10-01' });
  const oct3 = page.getByRole('gridcell', { name: '2026-10-03' });
  await expect(oct1.getByRole('button', { name: 'Northwind Labs' })).toBeVisible();

  const chip = (await oct1.getByRole('button', { name: 'Northwind Labs' }).boundingBox())!;
  const target = (await oct3.boundingBox())!;
  await page.mouse.move(chip.x + 10, chip.y + 5);
  await page.mouse.down();
  await page.mouse.move(chip.x + 30, chip.y + 10, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(oct3.getByRole('button', { name: 'Northwind Labs' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: /Table/ }).click();
  await expect(rowOf(page, 'Northwind')).toContainText('Oct 3, 2026'); // written to Notion

  await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: /Calendar/ }).click();
  await page.getByRole('heading', { level: 3 }).waitFor();
  for (let i = 0; i < 24 && !(await page.getByRole('heading', { name: 'October 2026' }).isVisible()); i++) {
    await page.getByRole('button', { name: 'Previous month' }).click();
  }
  await page.getByRole('gridcell', { name: '2026-10-20' }).hover();
  await page.getByRole('button', { name: 'Add a row on 2026-10-20' }).click();
  await expect(page.getByRole('dialog', { name: 'New row' }).getByRole('button', { name: 'Applied' })).toContainText('Oct 20, 2026');
});

test('calendar on a phone is an agenda list', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  await addJobSearch(page);
  await page.getByRole('button', { name: '+ Add view' }).click();
  await page.getByRole('button', { name: /Calendar$/ }).click();
  for (let i = 0; i < 24 && !(await page.getByRole('heading', { name: 'October 2026' }).isVisible()); i++) {
    await page.getByRole('button', { name: 'Previous month' }).click();
  }
  const agenda = page.getByRole('list', { name: 'October agenda' });
  await expect(agenda.getByRole('button', { name: 'Northwind Labs' })).toBeVisible();
  await agenda.getByRole('button', { name: 'Contoso Analytics' }).click();
  await expect(page.getByRole('dialog', { name: 'Row details' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
