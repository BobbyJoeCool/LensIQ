import { expect, test, type Page } from '@playwright/test';

const JOB_SEARCH_ID = '1f2e3d4c5b6a47988796a5b4c3d2e1f0';

test.beforeEach(async ({ request }) => {
  await request.post('/__e2e/reset');
});

async function addJobSearch(page: Page) {
  await page.goto('/');
  await page.getByLabel('Notion database link or ID').fill(JOB_SEARCH_ID);
  await page.getByRole('button', { name: 'Add database' }).click();
  await expect(page.getByRole('heading', { name: 'Job Search Tracker' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: /Table/ })).toBeVisible();
}

async function addView(page: Page, type: 'Table' | 'Board' | 'Chart') {
  await page.getByRole('button', { name: '+ Add view' }).click();
  await page.getByRole('button', { name: new RegExp(`^\\S*\\s*${type}$`) }).click();
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: new RegExp(type) })).toHaveAttribute('aria-current', 'page');
}

const table = (page: Page) => page.getByRole('table', { name: 'Database rows' });

test('filter, sort and hide properties on a table view, saved across reloads', async ({ page }) => {
  await addJobSearch(page);

  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('button', { name: '+ Add filter' }).click();
  await page.getByLabel('Filter property').selectOption({ label: 'Status' });
  await page.getByRole('checkbox', { name: 'Applied' }).click();
  await expect(page.getByRole('checkbox', { name: 'Applied' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('view-count')).toHaveText('1 of 2 rows');
  await expect(table(page).getByRole('row').filter({ hasText: 'Northwind' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Filter (1)' }).click();
  await page.getByRole('button', { name: 'Remove filter' }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Sort' }).click();
  await page.getByRole('button', { name: '+ Add sort' }).click();
  await page.getByLabel('Sort property').selectOption({ label: 'Company' });
  await page.getByLabel('Sort direction').selectOption('desc');
  await page.keyboard.press('Escape');
  await expect(table(page).getByRole('row').nth(1)).toContainText('Northwind');

  await page.getByRole('button', { name: 'Properties' }).click();
  await page.getByRole('checkbox', { name: 'Role' }).click();
  await expect(page.getByRole('checkbox', { name: 'Role' })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(table(page).getByRole('columnheader', { name: 'Role' })).toHaveCount(0);

  await page.waitForTimeout(700); // settings save after a short pause
  await page.reload();
  await expect(table(page).getByRole('columnheader', { name: 'Role' })).toHaveCount(0);
  await expect(table(page).getByRole('row').nth(1)).toContainText('Northwind');
});

test('a board groups by status, and dragging a card changes the status in Notion', async ({ page, isMobile }) => {
  test.skip(isMobile, 'drag is exercised with a mouse on desktop');
  await addJobSearch(page);
  await addView(page, 'Board');
  const applied = page.getByRole('listitem', { name: /^Applied/ });
  const offer = page.getByRole('listitem', { name: /^Offer/ });
  await expect(applied).toHaveAttribute('aria-label', 'Applied (1)');
  await expect(offer).toHaveAttribute('aria-label', 'Offer (0)');

  const card = applied.getByRole('article', { name: 'Contoso Analytics' });
  const from = (await card.boundingBox())!;
  const to = (await offer.boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 20, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 15 });
  await page.mouse.up();

  await expect(offer).toHaveAttribute('aria-label', 'Offer (1)');
  await page.reload();
  await expect(page.getByRole('listitem', { name: /^Offer/ })).toHaveAttribute('aria-label', 'Offer (1)'); // came back from Notion
});

test('a board card opens the row panel; "+ New" in a group presets its status', async ({ page }) => {
  await addJobSearch(page);
  await addView(page, 'Board');
  await page.getByRole('listitem', { name: /^Interviewing/ }).getByRole('button', { name: '+ New' }).click();
  const panel = page.getByRole('dialog', { name: 'New row' });
  await expect(panel.getByRole('button', { name: 'Status' })).toContainText('Interviewing');
  await panel.getByRole('button', { name: 'Company' }).click();
  await panel.getByLabel('Company', { exact: true }).fill('Litware');
  await panel.getByLabel('Company', { exact: true }).press('Enter');
  await panel.getByRole('button', { name: 'Create row' }).click();
  await expect(page.getByRole('listitem', { name: /^Interviewing/ })).toHaveAttribute('aria-label', 'Interviewing (2)');

  await page.getByRole('article', { name: 'Litware' }).click();
  await expect(page.getByRole('dialog', { name: 'Row details' })).toBeVisible();
});

test('chart views: bar by status with a data table, then a number tile', async ({ page }) => {
  await addJobSearch(page);
  await addView(page, 'Chart');
  await expect(page.locator('.recharts-surface')).toBeVisible();
  await page.getByRole('button', { name: 'Show data' }).click();
  const data = page.getByRole('table', { name: 'Chart data' });
  await expect(data.getByRole('row', { name: /Applied/ })).toContainText('1');
  await expect(data.getByRole('row', { name: /Interviewing/ })).toContainText('1');

  await page.getByRole('button', { name: 'Chart settings' }).click();
  await page.getByRole('radio', { name: 'Number' }).click();
  await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('sum');
  await page.getByRole('combobox', { name: 'Of', exact: true }).selectOption({ label: 'Salary' });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('stat-value')).toHaveText('$145,000.00');

  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByTestId('stat-value')).toHaveText('$145,000.00');
});

test('chart value labels show without hovering, as value, percent or both (#56)', async ({ page }) => {
  await addJobSearch(page);
  await addView(page, 'Chart');
  const labels = page.locator('.chart-value-label');
  await expect(page.locator('.recharts-surface')).toBeVisible();
  await expect(labels).toHaveCount(0); // off by default

  await page.getByRole('button', { name: 'Chart settings' }).click();
  await page.getByRole('combobox', { name: 'Show values' }).selectOption({ label: 'Value and percent' });
  await page.keyboard.press('Escape');
  // Applied 1 and Interviewing 1 of 2 rows.
  await expect(labels).toHaveText(['1 (50%)', '1 (50%)']);

  await page.getByRole('button', { name: 'Chart settings' }).click();
  await page.getByRole('radio', { name: 'Donut' }).click();
  await page.getByRole('combobox', { name: 'Show values' }).selectOption({ label: 'Percent' });
  await page.keyboard.press('Escape');
  await expect(labels).toHaveText(['50%', '50%']);

  await page.waitForTimeout(700); // settings save after a short pause
  await page.reload();
  await expect(labels).toHaveText(['50%', '50%']);
});

test('rename, duplicate and delete views', async ({ page }) => {
  await addJobSearch(page);
  const tabs = page.getByRole('navigation', { name: 'Views' });
  await tabs.getByRole('button', { name: '⋯' }).click();
  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('View name').fill('All applications');
  await page.getByLabel('View name').press('Enter');
  await expect(tabs.getByRole('link', { name: /All applications/ })).toBeVisible();

  await tabs.getByRole('button', { name: '⋯' }).click();
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(tabs.getByRole('link', { name: /All applications copy/ })).toHaveAttribute('aria-current', 'page');

  page.once('dialog', (d) => void d.accept());
  await tabs.getByRole('button', { name: '⋯' }).click();
  await page.getByRole('button', { name: 'Delete view' }).click();
  await expect(tabs.getByRole('link', { name: /copy/ })).toHaveCount(0);
  await page.reload();
  await expect(tabs.getByRole('link')).toHaveCount(1);
});

test('build a dashboard from existing and new views; it stacks to one column on a phone', async ({ page, isMobile }) => {
  await addJobSearch(page);
  await addView(page, 'Board');

  await page.getByRole('button', { name: '+ New dashboard' }).click();
  await page.getByLabel('New dashboard name').fill('Job Search');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Job Search' })).toBeVisible();

  await page.getByRole('button', { name: 'Add views' }).click();
  await page.getByLabel('View to add').selectOption({ label: 'Job Search Tracker · Board' });
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  await page.getByLabel('New view type').selectOption('chart');
  await page.getByRole('button', { name: 'Create and add' }).click();

  const tiles = page.getByRole('article').filter({ has: page.getByRole('link', { name: /Job Search Tracker/ }) });
  await expect(tiles).toHaveCount(2);
  await page.getByLabel('Tile size').first().selectOption('full');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.reload();
  await expect(tiles).toHaveCount(2);
  await expect(page.getByRole('listitem', { name: /^Applied/ })).toBeVisible(); // the board renders inside the tile
  await expect(page.locator('.recharts-surface')).toBeVisible();

  if (isMobile) {
    const boxes = await Promise.all([tiles.nth(0).boundingBox(), tiles.nth(1).boundingBox()]);
    expect(Math.abs(boxes[0]!.x - boxes[1]!.x)).toBeLessThan(2); // stacked, same left edge
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }

  // Deleting the board view removes its tile.
  await page.getByRole('link', { name: /Board · Job Search Tracker/ }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: '⋯' }).click();
  await page.getByRole('button', { name: 'Delete view' }).click();
  await page.getByRole('link', { name: 'Job Search', exact: true }).click();
  await expect(tiles).toHaveCount(1);
});

test('dashboard tiles fill their height, and short tiles stack next to a standard one (#54)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Tile heights apply to the desktop grid; a phone stacks tiles at their content height.');
  await addJobSearch(page);
  await addView(page, 'Board');

  await page.getByRole('button', { name: '+ New dashboard' }).click();
  await page.getByLabel('New dashboard name').fill('Heights');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Add views' }).click();
  await page.getByLabel('View to add').selectOption({ label: 'Job Search Tracker · Board' });
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('New view type').selectOption('chart');
    await page.getByRole('button', { name: 'Create and add' }).click();
  }
  const tiles = page.getByRole('article').filter({ has: page.getByRole('link', { name: /Job Search Tracker/ }) });
  await expect(tiles).toHaveCount(3);

  // The board tile is standard height and its columns reach the bottom of the tile (the bug: they stopped partway).
  const board = tiles.nth(0);
  const list = board.getByRole('list', { name: /Board grouped by/ });
  const [tileBox, listBox] = [await board.boundingBox(), await list.boundingBox()];
  expect(tileBox!.y + tileBox!.height - (listBox!.y + listBox!.height)).toBeLessThan(24);

  // Two ½-height charts stack next to the standard board.
  await page.getByLabel('Tile height').nth(1).selectOption('short');
  await page.getByLabel('Tile height').nth(2).selectOption('short');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await expect(tiles.nth(2)).toHaveAttribute('data-height', 'short');
  const [a, b, c] = [await tiles.nth(0).boundingBox(), await tiles.nth(1).boundingBox(), await tiles.nth(2).boundingBox()];
  expect(Math.abs(b!.y - a!.y)).toBeLessThan(2); // top-aligned with the board
  expect(Math.abs(c!.x - b!.x)).toBeLessThan(2); // the second one sits under the first
  expect(Math.abs(c!.y + c!.height - (a!.y + a!.height))).toBeLessThan(2); // and ends level with the board
});

test('the Add view and view action menus open on top of the page, not clipped by the tab bar (#43)', async ({ page }) => {
  await addJobSearch(page);
  const nav = page.getByRole('navigation', { name: 'Views' });
  expect((await nav.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  const onTop = (name: RegExp) =>
    page.getByRole('button', { name }).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && el.contains(hit);
    });

  await page.getByRole('button', { name: '+ Add view' }).click();
  expect(await onTop(/Board$/)).toBe(true);
  await page.keyboard.press('Escape');

  await nav.getByRole('button', { name: '⋯' }).click();
  expect(await onTop(/^Rename$/)).toBe(true);
});
