const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto('http://localhost:80/');
    const button = page.locator('[data-testid="button-open-simulator"]');
    await button.click();
    await page.waitForSelector('role=dialog');
    console.log('Dialog opened');

    const rawBase = await page.getByText('Сырая база (raw)').isVisible();
    const surgeText = await page.getByText('× сёрдж').isVisible();
    const dynMin = await page.getByText('Динамический минимум').isVisible();
    const finalPriceTitle = await page.getByText('Итог · max(минимум, surge)').isVisible();
    console.log('Breakdown table elements:', { rawBase, surgeText, dynMin, finalPriceTitle });

    const finalPriceBefore = await page.locator('[data-testid="text-sim-final"]').innerText();
    console.log('Final price before:', finalPriceBefore);

    const scenarioButtons = page.locator('[data-testid^="button-scenario-"]');
    const count = await scenarioButtons.count();
    console.log('Scenario buttons count:', count);

    const scenario25 = page.locator('[data-testid="button-scenario-2.5"]');
    await scenario25.click();
    
    await page.waitForTimeout(500);
    const finalPriceAfter = await page.locator('[data-testid="text-sim-final"]').innerText();
    console.log('Final price after scenario 2.5:', finalPriceAfter);

    await page.screenshot({ path: '/tmp/sim.png' });
    console.log('Screenshot saved to /tmp/sim.png');
  } catch (e) {
    console.error(e);
  } finally {
    await browser.close();
  }
})()