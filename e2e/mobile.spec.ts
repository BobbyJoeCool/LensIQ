import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('/__e2e/reset');
});

test('on a phone the table scrolls sideways and the page does not', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile layout check');
  await page.goto('/');
  await page.getByLabel('Notion database link or ID').fill('1f2e3d4c5b6a47988796a5b4c3d2e1f0');
  await page.getByRole('button', { name: 'Add database' }).click();
  await expect(page.getByRole('heading', { name: 'Job Search Tracker' })).toBeVisible();

  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(pageOverflow).toBeLessThanOrEqual(0);

  const table = page.getByRole('table', { name: 'Database rows' });
  const scroller = table.locator('xpath=..');
  const canScroll = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(canScroll).toBe(true);

  // The title column stays pinned while scrolling sideways.
  await scroller.evaluate((el) => (el.scrollLeft = 400));
  await expect(table.getByRole('row').filter({ hasText: 'Northwind Labs' }).getByRole('cell').first()).toBeInViewport();
});

test('tap targets in the nav and the Refresh button are at least 44px tall', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile layout check');
  await page.goto('/');
  await page.getByLabel('Notion database link or ID').fill('1f2e3d4c5b6a47988796a5b4c3d2e1f0');
  await page.getByRole('button', { name: 'Add database' }).click();
  for (const target of [page.getByRole('button', { name: 'Refresh' }), page.getByRole('link', { name: '+ Add database' })]) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
