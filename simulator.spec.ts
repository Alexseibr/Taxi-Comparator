import { test, expect } from '@playwright/test';

test('PriceSimulator test', async ({ page }) => {
  await page.goto('http://localhost:80/');
  const button = page.locator('[data-testid="button-open-simulator"]');
  await button.click();
  
  const dialog = page.locator('role=dialog');
  await expect(dialog).toBeVisible();

  // 1) Verify breakdown table
  await expect(page.getByText('Сырая база (raw)')).toBeVisible();
  await expect(page.getByText('× сёрдж')).toBeVisible();
  await expect(page.getByText('Динамический минимум')).toBeVisible();
  await expect(page.getByText('Итог · max(минимум, surge)')).toBeVisible();

  // 2) Verify surge slider / scenarios
  const finalPriceBefore = await page.locator('[data-testid="text-sim-final"]').innerText();
  console.log('Final price before:', finalPriceBefore);

  const scenario25 = page.locator('[data-testid="button-scenario-2.5"]');
  await scenario25.click();
  
  const finalPriceAfter = await page.locator('[data-testid="text-sim-final"]').innerText();
  console.log('Final price after:', finalPriceAfter);
  expect(finalPriceBefore).not.toBe(finalPriceAfter);

  // 3) Verify 5 quick scenario buttons
  const scenarioButtons = page.locator('[data-testid^="button-scenario-"]');
  await expect(scenarioButtons).toHaveCount(5);

  await page.screenshot({ path: '/tmp/sim.png' });
  console.log('Screenshot saved to /tmp/sim.png');
});