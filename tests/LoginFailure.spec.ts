import { test, expect } from '@playwright/test';
import { LoginPage } from '../Pages/LoginPage';

test('shows an error and throws when credentials are invalid', async ({ page }) => {
  const loginPage = new LoginPage(page);

  await loginPage.goto();
  await loginPage.expectLoginPageVisible();

  await expect(
    loginPage.login('invalid.user', 'wrong-password')
  ).rejects.toThrow(/Login failed: invalid user or password/);
});
