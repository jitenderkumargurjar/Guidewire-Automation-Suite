import { test } from '@playwright/test';
import { LoginPage } from '../Pages/LoginPage';
import { HomePage } from '../Pages/HomePage';
import { QuotePage } from '../Pages/QuotePage';

test('explore credit card form fields', async ({ page }) => {
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
  await quotePage.fillCustomerName('Explore', 'CCTest');
  await quotePage.fillMailingAddress({ line1: '1 Infinite Loop', city: 'Cupertino', state: 'CA', zip: '95014' });
  await quotePage.verifyAddress();
  await quotePage.fillContactInfo('explore@test.com', '5551234567');
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
  await quotePage.selectPayPlan('Quarterly Pay Automated');
  await quotePage.selectInstallmentPaymentMethod('Credit Card');
  await quotePage.openCreditCardDetailsOnPayPlan();

  // Dump the hosted payment iframe's fields for inspection, without filling/submitting.
  await page.waitForTimeout(1500);
  const frames = page.frames().filter((fr) => fr.url().includes('processonepayments.com'));
  console.log(`Found ${frames.length} processonepayments.com frame(s).`);
  let entryFrame;
  for (const fr of frames) {
    console.log('--- FRAME URL:', fr.url());
    const inputsInfo = await fr.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, select, button'));
      return inputs.map((el) => ({
        tag: el.tagName,
        type: (el as HTMLInputElement).type,
        id: el.id,
        name: (el as HTMLInputElement).name,
        placeholder: (el as HTMLInputElement).placeholder,
        text: el.textContent?.trim().slice(0, 40),
      }));
    });
    console.log(JSON.stringify(inputsInfo, null, 2));
    if (inputsInfo.some((i) => i.id === 'cardNumber')) entryFrame = fr;
  }

  await page.screenshot({ path: 'test-reports/_explore-cc-before.png' });

  if (entryFrame) {
    await entryFrame.locator('input#cardNumber').fill('4111111111111111');
    await entryFrame.locator('input#expirationDate').fill('12/30');
    await entryFrame.locator('input#billingAddress').fill('1 Infinite Loop');
    await entryFrame.locator('input#billingZip').fill('95014');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-reports/_explore-cc-filled.png' });
    const nextBtn = entryFrame.getByRole('button', { name: /^next$/i });
    console.log('Next button enabled:', await nextBtn.isEnabled());

    const errorInfo = await entryFrame.evaluate(() => {
      const cardInput = document.querySelector('input#cardNumber') as HTMLInputElement;
      const wrapper = cardInput?.closest('oicc-number-input, .form-group, div');
      const errors = Array.from(document.querySelectorAll('.error, .mat-error, [class*="error"], [class*="invalid"]'));
      return {
        cardInputValue: cardInput?.value,
        cardInputAriaInvalid: cardInput?.getAttribute('aria-invalid'),
        wrapperHtml: wrapper?.outerHTML?.slice(0, 2000),
        errorTexts: errors.map((e) => e.textContent?.trim()).filter(Boolean),
      };
    });
    console.log('ERROR INFO:', JSON.stringify(errorInfo, null, 2));
  }
});
