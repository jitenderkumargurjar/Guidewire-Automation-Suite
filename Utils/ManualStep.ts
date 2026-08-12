import { Page } from '@playwright/test';

// Hands control to the user: prints what to do, then opens Playwright's Inspector overlay in
// the browser itself (a "Resume" button plus selector/log tools) and waits for them to click it.
// Used for steps the user wants to do by hand (e.g. picking a vehicle, deductible, or pay plan)
// instead of driving them from .env. Playwright automatically suspends the test's timeout clock
// while paused, so taking as long as needed here won't fail the run.
export async function waitForManualStep(page: Page, message: string): Promise<void> {
  console.log(`\n>>> ${message}\n>>> Click "Resume" (the ▶ button) in the Playwright Inspector when done.\n`);
  await page.pause();
}
