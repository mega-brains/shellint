import { test } from "@playwright/test";
import { openApp } from "./helpers/open-app";
for (const w of [1440, 1100, 900, 780, 640]) {
  test(`header ${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 700 });
    await openApp(page);
    await page.locator("header.top").screenshot({ path: `test-results/hdr-${w}.png` });
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll("header.top > *")].map((el) => {
        const r = el.getBoundingClientRect();
        return `${el.id || el.className}: x=${Math.round(r.x)} w=${Math.round(r.width)}`;
      }),
    );
    console.log(`W${w}`, JSON.stringify(boxes));
  });
}
