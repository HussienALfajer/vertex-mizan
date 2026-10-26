import { ar } from '@vertex-mizan/i18n';
import { expect, test } from './test';

const t = ar.designSystem;

test.describe('design-system page', () => {
  test('shows a negative amount left to right, with a minus sign and its own color', async ({
    page,
  }) => {
    await page.goto('/design-system');
    const row = page.getByRole('row').filter({ hasText: t.amounts.negative });
    const amount = row.locator('[data-slot="amount"]');
    await expect(amount).toHaveAttribute('dir', 'ltr');
    await expect(amount).toHaveAttribute('data-negative', 'true');
    await expect(amount).toContainText('1,250,000.50');
  });

  test('stores an expression typed in an amount input as exact minor units', async ({ page }) => {
    await page.goto('/design-system');
    const input = page.getByLabel(t.input.free, { exact: true });
    const stored = page
      .locator('[data-slot="field"]')
      .filter({ has: input })
      .locator('[data-slot="field-description"]');
    await input.fill('=1000*1.125');
    await input.press('Enter');
    await expect(stored).toContainText('112500');

    await input.fill('١٢٥٠٫٥');
    await input.press('Tab');
    await expect(stored).toContainText('125050');
  });

  test('refuses text that is not an amount and keeps the last amount', async ({ page }) => {
    await page.goto('/design-system');
    const input = page.getByLabel(t.input.debit, { exact: true });
    await input.fill('125');
    await input.press('Enter');
    await input.fill('abc');
    await input.press('Enter');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(ar.accounting.amountInput.INVALID)).toBeVisible();

    await input.fill('-5');
    await input.press('Enter');
    await expect(page.getByText(ar.accounting.amountInput.NEGATIVE_NOT_ALLOWED)).toBeVisible();
  });
});
