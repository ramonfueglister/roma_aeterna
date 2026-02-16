import { test, expect } from '@playwright/test';

test('app loads without errors', async ({ page }) => {
  await page.goto('/');
  // Wait for canvas to be present (Three.js mounts here)
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 10_000 });
});
