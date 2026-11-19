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
}

const rowOf = (page: Page, text: string) => page.getByRole('table', { name: 'Database rows' }).getByRole('row').filter({ hasText: text });

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'inline editing is desktop-only');

  test('edit a text cell inline and it persists', async ({ page }) => {
    await addJobSearch(page);
    await rowOf(page, 'Contoso').getByRole('cell', { name: 'Edit Role' }).click();
    const input = page.getByLabel('Role', { exact: true });
    await input.fill('Staff Engineer');
    await input.press('Enter');
    await expect(rowOf(page, 'Contoso')).toContainText('Staff Engineer');
    await page.reload();
    await expect(rowOf(page, 'Contoso')).toContainText('Staff Engineer'); // came back from Notion (the fixture)
  });

  test('change a status and toggle a checkbox', async ({ page }) => {
    await addJobSearch(page);
    await rowOf(page, 'Contoso').getByRole('cell', { name: 'Edit Status' }).click();
    await page.getByRole('option', { name: /Offer/ }).click();
    await expect(rowOf(page, 'Contoso')).toContainText('Offer');

    await rowOf(page, 'Contoso').getByRole('cell', { name: 'Edit Remote' }).click();
    await expect(rowOf(page, 'Contoso').getByRole('img', { name: 'Checked' })).toBeVisible();
    await page.reload();
    await expect(rowOf(page, 'Contoso').getByRole('img', { name: 'Checked' })).toBeVisible();
    await expect(rowOf(page, 'Contoso')).toContainText('Offer');
  });

  test('create a new tag option from the picker', async ({ page }) => {
    await addJobSearch(page);
    await rowOf(page, 'Northwind').getByRole('cell', { name: 'Edit Tags' }).click();
    await page.getByLabel('Tags', { exact: true }).fill('Remote-first');
    await page.getByRole('option', { name: 'Create “Remote-first”' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(rowOf(page, 'Northwind')).toContainText('Remote-first');
    // The new option is offered on other rows now.
    await rowOf(page, 'Contoso').getByRole('cell', { name: 'Edit Tags' }).click();
    await expect(page.getByRole('option', { name: 'Remote-first' })).toBeVisible();
  });

  test('a value changed in Notion meanwhile raises the conflict dialog', async ({ page, request }) => {
    await addJobSearch(page);
    await request.post('/__e2e/notion/edit', {
      data: { pageId: 'p-2', prop: 'Role', value: [{ text: { content: 'Changed in Notion' } }] },
    });
    await rowOf(page, 'Contoso').getByRole('cell', { name: 'Edit Role' }).click();
    await page.getByLabel('Role', { exact: true }).fill('My edit');
    await page.getByLabel('Role', { exact: true }).press('Enter');

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('“Role” changed in Notion');
    await expect(dialog.getByTestId('conflict-mine')).toHaveText('My edit');
    await expect(dialog.getByTestId('conflict-theirs')).toHaveText('Changed in Notion');
    await dialog.getByRole('button', { name: 'Keep mine' }).click();
    await expect(rowOf(page, 'Contoso')).toContainText('My edit');
    await page.reload();
    await expect(rowOf(page, 'Contoso')).toContainText('My edit');
  });

  test('a change to a different column in Notion does not raise a conflict', async ({ page, request }) => {
    await addJobSearch(page);
    await request.post('/__e2e/notion/edit', { data: { pageId: 'p-2', prop: 'Salary', value: 99000 } });
    await rowOf(page, 'Contoso').getByRole('cell', { name: 'Edit Role' }).click();
    await page.getByLabel('Role', { exact: true }).fill('No conflict');
    await page.getByLabel('Role', { exact: true }).press('Enter');
    await expect(rowOf(page, 'Contoso')).toContainText('No conflict');
    await expect(rowOf(page, 'Contoso')).toContainText('$99,000.00'); // the saved row brings Notion's other change along
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('editing a row that was deleted in Notion shows an error and drops the row', async ({ page, request }) => {
    await addJobSearch(page);
    await request.post('/__e2e/notion/delete', { data: { pageId: 'p-2' } });
    await rowOf(page, 'Contoso').getByRole('cell', { name: 'Edit Role' }).click();
    await page.getByLabel('Role', { exact: true }).fill('Too late');
    await page.getByLabel('Role', { exact: true }).press('Enter');
    await expect(page.getByRole('alert')).toContainText('deleted in Notion');
    await expect(rowOf(page, 'Contoso')).toHaveCount(0);
  });

  test('add a row and delete a row', async ({ page }) => {
    await addJobSearch(page);
    await page.getByRole('button', { name: '+ New', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'New row' });
    await panel.getByRole('button', { name: 'Company' }).click();
    await panel.getByLabel('Company', { exact: true }).fill('Tailspin Toys');
    await panel.getByLabel('Company', { exact: true }).press('Enter');
    await panel.getByRole('button', { name: 'Create row' }).click();
    await expect(rowOf(page, 'Tailspin Toys')).toBeVisible();
    await expect(page.getByTestId('sync-status')).toContainText('3 rows');

    await rowOf(page, 'Tailspin Toys').getByRole('button', { name: 'Open row' }).click();
    await page.getByRole('dialog', { name: 'Row details' }).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete row' }).click();
    await expect(rowOf(page, 'Tailspin Toys')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('sync-status')).toContainText('2 rows');
  });

  test('formatted text is read-only with a link to edit it in Notion', async ({ page, request }) => {
    await addJobSearch(page);
    // Make p-1's role formatted, as if bolded in Notion, then reopen the app.
    await request.post('/__e2e/notion/edit', {
      data: { pageId: 'p-1', prop: 'Role', value: [{ text: { content: 'Bold role' }, annotations: { bold: true } }] },
    });
    await page.reload();
    await expect(rowOf(page, 'Northwind')).toContainText('Bold role');
    await expect(rowOf(page, 'Northwind').getByRole('cell', { name: 'Edit Role' })).toHaveCount(0);
    await expect(rowOf(page, 'Contoso').getByRole('cell', { name: 'Edit Role' })).toHaveCount(1); // plain text stays editable
    await rowOf(page, 'Northwind').getByRole('button', { name: 'Open row' }).click();
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Edit in Notion' })).toHaveAttribute('href', /notion\.so/);
  });
});

test('reopening the app picks up rows added and deleted in Notion', async ({ page, request }) => {
  await addJobSearch(page);
  await request.post('/__e2e/notion/add-row');
  await request.post('/__e2e/notion/delete', { data: { pageId: 'p-1' } });
  await page.reload(); // opening the database does a full sync (Q15)
  await expect(rowOf(page, 'Fabrikam Health')).toBeVisible();
  await expect(rowOf(page, 'Northwind')).toHaveCount(0);
  await expect(page.getByTestId('sync-status')).toContainText('2 rows · synced just now');
});

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout only');

  test('tapping a row opens the panel, where cells are edited', async ({ page }) => {
    await addJobSearch(page);
    await rowOf(page, 'Contoso').click();
    const panel = page.getByRole('dialog', { name: 'Row details' });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Status' }).click();
    await panel.getByRole('option', { name: /Interviewing/ }).click();
    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(rowOf(page, 'Contoso')).toContainText('Interviewing');
    // Panel controls are big enough to tap.
    await rowOf(page, 'Contoso').click();
    const box = await page.getByRole('button', { name: 'Close' }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
