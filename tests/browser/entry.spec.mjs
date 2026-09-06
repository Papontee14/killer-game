import { test, expect } from '@playwright/test';

test('entry menus, browser history and recovery preserve form values', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.entry-menu')).toBeVisible();
  await expect(page.getByLabel('รหัสห้อง', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'เข้าร่วมเกม', exact: true }).click();
  await page.getByLabel('รหัสห้อง', { exact: true }).fill('K9P2MX');
  await page.getByLabel('ชื่อผู้เล่น', { exact: true }).fill('มะนาว');
  await page.getByRole('button', { name: 'เคยเข้าร่วมแล้ว? กู้คืนตัวละคร' }).click();
  await page.getByLabel('รหัสกู้คืน', { exact: true }).fill('private-recovery-token');
  await expect(page.getByRole('button', { name: 'กู้คืนตัวละคร', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.locator('.entry-menu')).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel('ชื่อผู้เล่น', { exact: true })).toHaveValue('มะนาว');
  await expect(page.getByLabel('รหัสห้อง', { exact: true })).toHaveValue('K9P2MX');
  await page.getByRole('button', { name: 'กลับหน้าหลัก' }).click();
  await page.getByRole('button', { name: 'สร้างห้อง', exact: true }).click();
  await expect(page.getByLabel('ชื่อ Host')).toBeVisible();
  await expect(page.getByLabel('รหัสห้อง', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('ชื่อ Host')).toBeVisible();
});

test('invitation skips home and input rejects invalid room characters', async ({ page }) => {
  await page.goto('/?room=k9p2mx');
  await expect(page.getByLabel('รหัสห้อง', { exact: true })).toHaveValue('K9P2MX');
  await page.getByRole('button', { name: 'กลับหน้าหลัก' }).click();
  await expect(page.locator('.entry-menu')).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('รหัสห้อง', { exact: true })).toHaveValue('K9P2MX');
  await page.getByLabel('รหัสห้อง', { exact: true }).fill('ab!12');
  await expect(page.getByLabel('รหัสห้อง', { exact: true })).toHaveValue('AB12');
  await page.getByLabel('ชื่อผู้เล่น', { exact: true }).fill('มะนาว');
  await page.getByRole('button', { name: 'เข้าสู่เกม', exact: true }).click();
  await expect(page).toHaveURL(/\?room=k9p2mx$/);
});

for (const width of [360,390,768,1440]) {
  test(`pixel entry visual review ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const screen of ['home','join','host']) {
      await page.goto('/#'+screen);
      await expect(page.locator('.entry-'+screen)).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const backgrounds = await page.locator('.entry-art, .entry-form-art').evaluateAll(nodes => Promise.all(nodes.map(node => new Promise(resolve => {
        const src = getComputedStyle(node).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
        if (!src) return resolve(false);
        const image = new Image(); image.onload=()=>resolve(true); image.onerror=()=>resolve(false); image.src=src;
      }))));
      expect(backgrounds.every(Boolean)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path:`artifacts/pixel-review/${screen}-${width}.png`, fullPage:true });
    }
  });
}
