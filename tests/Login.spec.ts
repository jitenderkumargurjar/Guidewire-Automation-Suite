import { test, expect } from '@playwright/test';
import { LoginPage } from '../Pages/LoginPage';
import { HomePage } from '../Pages/HomePage';

test('user can log in and reach the home page', async ({ page }) => {
  const loginPage = new LoginPage(page);
  const homePage = new HomePage(page);

  await loginPage.goto();
  await loginPage.expectLoginPageVisible();
  await loginPage.login(process.env.GW_USERNAME!, process.env.GW_PASSWORD!);

  try {
    await homePage.expectLoaded();
  } catch (err) {
    await page.screenshot({ path: 'screenshots/debug-after-login.png', fullPage: true });
    throw err;
  }
});