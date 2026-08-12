import { Page, Locator, expect } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly newQuoteTrigger: Locator;
  readonly newQuoteStartButton: Locator;
  readonly effectiveDateInput: Locator;
  readonly stateSelect: Locator;
  readonly searchInput: Locator;

  constructor(page: Page) {
    this.page = page;
    // Sidebar link that opens the "New Quote" flyout; visible as soon as the home page loads.
    this.newQuoteTrigger = page.locator('#QuickAction_NewQuote_Holder');
    // "Start" button inside the flyout; hidden until newQuoteTrigger is clicked.
    this.newQuoteStartButton = page.locator('#QuickAction_NewQuote');
    this.effectiveDateInput = page.locator('#QuickAction_EffectiveDt');
    this.stateSelect = page.locator('#QuickAction_StateCd');
    this.searchInput = page.locator('#ToolbarSearchText');
  }

  async openNewQuoteFlyout() {
    await this.newQuoteTrigger.click();
    await expect(this.newQuoteStartButton).toBeVisible();
  }

  async setEffectiveDate(date: string) {
    // The flyout populates its default date asynchronously after opening, which can race
    // with and clobber this fill (value ends up blank or reset to today). Retry until it sticks.
    await expect(async () => {
      await this.effectiveDateInput.fill(date);
      await this.page.waitForTimeout(300);
      await expect(this.effectiveDateInput).toHaveValue(date);
    }).toPass({ timeout: 10000 });
  }

  async selectState(state: string) {
    await this.stateSelect.selectOption(state);
  }

  async startNewQuote(options: { state: string; effectiveDate?: string }) {
    await this.openNewQuoteFlyout();
    if (options.effectiveDate) {
      await this.setEffectiveDate(options.effectiveDate);
    }
    await this.selectState(options.state);
    await this.newQuoteStartButton.click();
  }

  async expectLoaded() {
    // Wait for network activity to settle before asserting, since content may load async
    await this.page.waitForLoadState('networkidle');

    await expect(this.newQuoteTrigger).toBeVisible({ timeout: 15000 });
  }

  async search(text: string) {
    await this.searchInput.fill(text);
  }
}