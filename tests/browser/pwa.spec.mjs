import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('Chromium installs the current service worker before the player starts a game', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Safari PWA installation is verified on a physical iPhone.');
  await page.goto('/');
  const registered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    return registration?.active?.scriptURL.endsWith('/sw.js') ?? false;
  });
  expect(registered).toBe(true);
});
