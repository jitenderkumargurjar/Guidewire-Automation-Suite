// pages/LoginPage.ts
import { Page, expect } from '@playwright/test';

export class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto(process.env.GW_BASE_URL!);
  }

  async login(username: string, password: string) {
    await this.page.fill('#j_username', username);
    await this.page.fill('#j_password', password);
    await this.page.click('#SignIn');

    const invalidCreds = this.page.getByText('Invalid user or password');
    const loginRejected = await invalidCreds
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (loginRejected) {
      throw new Error(
        `Login failed: invalid user or password for user "${username}". Check GW_USERNAME/GW_PASSWORD.`
      );
    }
  }

  async expectLoginPageVisible() {
    await expect(this.page.locator('#SignIn')).toBeVisible();
  }
}