import { test } from '@playwright/test';
import { LoginPage } from '../Pages/LoginPage';
import { HomePage } from '../Pages/HomePage';
import { QuotePage } from '../Pages/QuotePage';

// Explores what appears on the Closeout screen (Direct Bill plans) when Payment Type is set to
// ACH or Check, so field ids can be captured without guessing. Does not submit anything.
test('explore ACH/Check fields on Closeout screen', async ({ page }) => {
  test.setTimeout(300000);
  const loginPage = new LoginPage(page);
  const homePage = new HomePage(page);
  const quotePage = new QuotePage(page);

  await loginPage.goto();
  await loginPage.expectLoginPageVisible();
  await loginPage.login(process.env.GW_USERNAME!, process.env.GW_PASSWORD!);
  await homePage.expectLoaded();
  await homePage.startNewQuote({ state: 'Texas' });
  await quotePage.expectQuoteOpened('Mechanical Breakdown Insurance');
  await quotePage.selectLineOfBusiness('Mechanical Breakdown Insurance');
  await quotePage.expectQuoteNumberGenerated();
  await quotePage.selectProducer('abc');
  await quotePage.selectAnyCampaignId();
  await quotePage.fillCustomerName('Explore', 'ACHClose');
  await quotePage.fillMailingAddress({ line1: '1 Infinite Loop', city: 'Cupertino', state: 'CA', zip: '95014' });
  await quotePage.verifyAddress();
  await quotePage.fillContactInfo('exploreach@test.com', '5551234567');
  await quotePage.save();
  await quotePage.goToNextPage();
  await quotePage.addVehicle({
    category: 'Affinity Auto',
    year: '2020',
    make: 'Honda',
    model: 'Accord',
    odometer: '32000',
  });
  await quotePage.saveVehicleAndExpectRated();
  await quotePage.selectDeductible('250');
  await quotePage.goToNextPage();
  await quotePage.expectReviewPageOpened();
  await quotePage.goToNextPage();
  await quotePage.selectPayPlan('Quarterly Pay Direct');
  await quotePage.createApplication();
  await quotePage.finishApplication();

  async function dumpPaymentArea(label: string) {
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `test-reports/_explore-ach-closeout-${label}.png`, fullPage: true });

    const info = await page.evaluate(() => {
      const container = document.querySelector('#TransactionInfo\\.PaymentTypeCd')?.closest('table, div.form, fieldset, div') as HTMLElement | null;
      const scope = container ?? document.body;
      const inputs = Array.from(scope.querySelectorAll('input, select, button, a'));
      return inputs.map((el) => ({
        tag: el.tagName,
        type: (el as HTMLInputElement).type,
        id: el.id,
        name: (el as HTMLInputElement).name,
        placeholder: (el as HTMLInputElement).placeholder,
        text: el.textContent?.trim().slice(0, 60),
        visible: !!(el as HTMLElement).offsetParent,
      })).filter((i) => i.visible);
    });
    console.log(`--- [${label}] elements near PaymentTypeCd ---`);
    console.log(JSON.stringify(info, null, 2));

    const frames = page.frames().map((fr) => fr.url());
    console.log(`--- [${label}] frames on page ---`);
    console.log(JSON.stringify(frames, null, 2));
  }

  await dumpPaymentArea('none-default');

  await quotePage.selectPaymentType('Check');
  await dumpPaymentArea('check');

  await quotePage.selectPaymentType('ACH');
  await dumpPaymentArea('ach');

  // Confirm the hosted ACH form opened here is the same component as the Pay Plans tab's,
  // without filling/submitting anything. Poll (like waitForPaymentFrame does in QuotePage) since
  // the iframe stack loads asynchronously and a flat wait can catch it still empty.
  await quotePage.enterACHDetailsButton.click();
  let foundFrame;
  const start = Date.now();
  while (Date.now() - start < 20000 && !foundFrame) {
    for (const fr of page.frames()) {
      if (!fr.url().includes('processonepayments.com')) continue;
      const hasMarker = await fr.evaluate(() => document.body?.innerText?.includes('Routing Number')).catch(() => false);
      if (hasMarker) foundFrame = fr;
    }
    if (!foundFrame) await page.waitForTimeout(300);
  }
  const achFramesFinal = foundFrame ? [foundFrame] : page.frames().filter((fr) => fr.url().includes('processonepayments.com'));
  console.log(`Found ${achFramesFinal.length} processonepayments.com frame(s) for ACH on Closeout (marker matched: ${!!foundFrame}).`);
  for (const fr of achFramesFinal) {
    const inputsInfo = await fr.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, select, button'));
      return inputs.map((el) => ({
        tag: el.tagName,
        type: (el as HTMLInputElement).type,
        id: el.id,
        placeholder: (el as HTMLInputElement).placeholder,
        text: el.textContent?.trim().slice(0, 40),
      }));
    });
    console.log('--- ACH-on-Closeout FRAME URL:', fr.url());
    console.log(JSON.stringify(inputsInfo, null, 2));
  }
  await page.screenshot({ path: 'test-reports/_explore-ach-closeout-form-open.png' });
});
