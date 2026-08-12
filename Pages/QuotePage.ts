import { Page, Locator, Frame, expect } from '@playwright/test';

export interface MailingAddress {
  line1: string;
  city: string;
  state: string;
  zip: string;
}

export type LineOfBusiness = 'Mechanical Breakdown Insurance' | 'Vehicle Service Contract';

// The three categories under "Add Vehicle Detail". Each maps to a differently-shaped form:
// - Affinity Auto: a private passenger auto. Rating class auto-fills; has Transmission Type.
// - Motorhome: rating class must be picked (e.g. "Motorhome Class A"); has Engine Location
//   instead of Transmission Type.
// - Travel Trailer: rating class must be picked (e.g. "Travel Trailer"); not self-propelled, so
//   no Odometer/Transmission/Fuel/Engine Location at all.
export type VehicleCategory = 'Affinity Auto' | 'Motorhome' | 'Travel Trailer';

// The Pay Plans tab's PayPlanCd radio values - re-confirmed 2026-08-10 by scraping the live app's
// actual radio value attributes after the previous names (Direct Bill/Automated Bill Pay In
// Full/Quarterly/Monthly Statement) turned out to be stale and made every row's pay plan
// selection fail. Five options exist (two Direct, three Automated; there is no Direct monthly
// plan). Selecting an Automated plan - unlike a Direct plan - reveals an in-page Credit Card/ACH
// payment collection flow (see selectInstallmentPaymentMethod below) that isn't present for
// Direct plans.
export const DIRECT_BILL_PAY_PLANS = ['Annual Pay Direct', 'Quarterly Pay Direct'] as const;
export const AUTOMATED_BILL_PAY_PLANS = ['Annual Pay Automated', 'Quarterly Pay Automated', 'Monthly Pay Automated'] as const;

export interface ACHPaymentDetails {
  routingNumber: string;
  accountNumber: string;
}

export interface VehicleDetails {
  category: VehicleCategory;
  // Required for Motorhome ("Motorhome Class A/B/C") and Travel Trailer ("Travel Trailer",
  // "Trailer Fifth Wheel", "Trailer Pop-up", "Truck Slide in Camper"); ignored for Affinity Auto,
  // whose rating class auto-fills once the vehicle type is chosen.
  ratingClass?: string;
  year: string;
  make: string;
  model: string;
  // Affinity Auto and Motorhome only.
  odometer?: string;
  // Affinity Auto only.
  transmissionType?: string;
  // Affinity Auto and Motorhome only.
  fuelType?: string;
  // Motorhome only.
  engineLocation?: string;
}

export class QuotePage {
  readonly page: Page;
  readonly quoteNumberLocator: Locator;

  readonly producerLookupIcon: Locator;
  readonly producerCodeInput: Locator;
  readonly campaignIdSearchInput: Locator;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly resetNameLink: Locator;
  readonly nameInput: Locator;
  readonly addressLine1Input: Locator;
  readonly cityInput: Locator;
  readonly stateSelect: Locator;
  readonly zipInput: Locator;
  readonly verifyAddressIcon: Locator;
  readonly emailInput: Locator;
  readonly primaryPhoneTypeSelect: Locator;
  readonly primaryPhoneNumberInput: Locator;
  readonly saveLink: Locator;
  readonly nextPageLink: Locator;
  readonly newCustomerRadio: Locator;

  readonly addVehicleDetailButton: Locator;
  readonly vehicleRatingClassSelect: Locator;
  readonly vehicleModelYearInput: Locator;
  readonly vehicleMakeSelect: Locator;
  readonly vehicleModelSelect: Locator;
  readonly vehicleOdometerInput: Locator;
  readonly vehicleTransmissionSelect: Locator;
  readonly vehicleFuelTypeSelect: Locator;
  readonly vehicleEngineLocationSelect: Locator;
  readonly deductibleRows: Locator;

  readonly riskSummaryLink: Locator;
  readonly bindLink: Locator;
  readonly closeoutLink: Locator;
  readonly paymentTypeSelect: Locator;
  readonly paymentAmountInput: Locator;
  readonly checkNumberInput: Locator;
  readonly issueNewBusinessLink: Locator;

  // Pay Plans tab: appears once one of the AUTOMATED_BILL_PAY_PLANS is selected.
  readonly installmentMethodSelect: Locator;
  readonly enterACHDetailsButton: Locator;
  readonly enterCreditCardDetailsButton: Locator;

  constructor(page: Page) {
    this.page = page;
    // Quote number renders as text like "QT-0000005973" in the quote summary panel.
    // The page has a "Full_"-prefixed duplicate (zero-size, hidden) and a duplicate id on a
    // hidden <td>, so filter to the one actually visible.
    this.quoteNumberLocator = page.locator('#QuoteAppSummary_QuoteAppNumber:visible').first();

    // Magnifying-glass icon that opens the producer search popup window.
    this.producerLookupIcon = page.locator('#ProducerLookup');
    this.producerCodeInput = page.locator('#ProviderNumber');

    // The real Campaign ID <select> is hidden; this jQuery-UI autocomplete text input is what's
    // actually interactive and shows a suggestion dropdown as you type.
    this.campaignIdSearchInput = page.locator('#CampaignIdSearch');

    this.firstNameInput = page.locator('#InsuredName\\.GivenName');
    this.lastNameInput = page.locator('#InsuredName\\.Surname');
    this.nameInput = page.locator('#InsuredName\\.CommercialName');
    // Recomputes Name* from First/Middle/Last.
    this.resetNameLink = page.locator('#ResetCommercialName');

    // Address1 is a Google-Places-style autocomplete field; freeform text is accepted without
    // requiring a suggestion to be picked.
    this.addressLine1Input = page.locator('#InsuredMailingAddr\\.Addr1');
    this.cityInput = page.locator('#InsuredMailingAddr\\.City');
    this.stateSelect = page.locator('#InsuredMailingAddr\\.StateProvCd');
    this.zipInput = page.locator('#InsuredMailingAddr\\.PostalCode');
    // Icon-only control; its label comes from a title attribute, not visible text.
    this.verifyAddressIcon = page.locator('#InsuredMailingAddr\\.addrVerifyImg');

    this.emailInput = page.locator('#InsuredEmail\\.EmailAddr');
    this.primaryPhoneTypeSelect = page.locator('#InsuredPhonePrimary\\.PhoneName');
    this.primaryPhoneNumberInput = page.locator('#InsuredPhonePrimary\\.PhoneNumber');

    this.saveLink = page.locator('#Save');
    this.nextPageLink = page.locator('#NextPage');
    // Appears on a "Select Customer" screen when Save finds existing customers with matching
    // details (e.g. same name); its numeric id shifts as more matches accumulate, so target by
    // its "New" value instead.
    this.newCustomerRadio = page.locator('input[name="QuoteCustomerClearingRef"][value="New"]');

    // "Add Vehicle Detail" dropdown, opened on the Vehicle tab; offers Private Passenger Auto
    // (rating class "Affinity Auto"), Trailer ("Travel Trailer" etc.), Motorhome.
    this.addVehicleDetailButton = page.locator('#AddAutomobile');
    // Auto-fills for Affinity Auto; must be explicitly chosen for Motorhome/Travel Trailer.
    this.vehicleRatingClassSelect = page.locator('#Vehicle\\.VehicleClass');
    this.vehicleModelYearInput = page.locator('#Vehicle\\.ModelYr');
    // Make/Model are cascading: Make's options populate once Model Year (and, for
    // Motorhome/Trailer, Rating Class) is set, and Model's options populate once Make is selected.
    this.vehicleMakeSelect = page.locator('#Vehicle\\.ManufacturerID');
    this.vehicleModelSelect = page.locator('#Vehicle\\.Model');
    this.vehicleOdometerInput = page.locator('#Vehicle\\.OdometerReading');
    // Affinity Auto only.
    this.vehicleTransmissionSelect = page.locator('#Vehicle\\.TransType');
    this.vehicleFuelTypeSelect = page.locator('#Vehicle\\.FuelType');
    // Motorhome only.
    this.vehicleEngineLocationSelect = page.locator('#Vehicle\\.EngineLocation');
    // Each pricing tier (e.g. Gold, Silver) renders one row per deductible option, with ids like
    // "COVGold_TERM12_DED100" / "COVSilver_TERM12_DED250".
    this.deductibleRows = page.locator('tr[id*="_DED"]');

    // Rate Confirmation link on the Review tab, e.g. "Risk 1 - 2020 Honda Accord".
    this.riskSummaryLink = page.getByRole('link', { name: /^Risk 1 -/ });
    // "Create Application" on the Pay Plans tab.
    this.bindLink = page.locator('#Bind');
    // "Finish" on the Closeout/Application summary screen.
    this.closeoutLink = page.locator('#Closeout');
    this.paymentTypeSelect = page.locator('#TransactionInfo\\.PaymentTypeCd');
    this.paymentAmountInput = page.locator('#TransactionInfo\\.PaymentAmt');
    this.checkNumberInput = page.locator('#TransactionInfo\\.CheckNumber');
    // "Issue New Business" - kicks off a multi-stage, long-running server job.
    this.issueNewBusinessLink = page.locator('#Process');

    this.installmentMethodSelect = page.locator('#InstallmentSource\\.MethodCd');
    this.enterACHDetailsButton = page.locator('#EnterACHDetails');
    this.enterCreditCardDetailsButton = page.locator('#EnterCreditCardDetails');
  }

  // Rendered as an <a> link on the product selection screen. California only offers Mechanical
  // Breakdown Insurance; other states (e.g. TX) offer both this and Vehicle Service Contract.
  lineOfBusinessLink(lob: LineOfBusiness): Locator {
    return this.page.getByRole('link', { name: lob });
  }

  async expectQuoteOpened(lob: LineOfBusiness) {
    await this.page.waitForLoadState('networkidle');
    await expect(this.page).toHaveURL(process.env.GW_BASE_URL!);
    await expect(this.lineOfBusinessLink(lob)).toBeVisible({ timeout: 15000 });
  }

  async selectLineOfBusiness(lob: LineOfBusiness) {
    await this.lineOfBusinessLink(lob).click();
  }

  async expectQuoteNumberGenerated(): Promise<string> {
    await expect(this.quoteNumberLocator).toBeVisible({ timeout: 15000 });
    const quoteNumber = (await this.quoteNumberLocator.textContent())?.trim();
    expect(quoteNumber).toMatch(/^QT-\d+/);
    return quoteNumber!;
  }

  // Opens the producer search popup, searches by text, and selects the matching result.
  async selectProducer(searchText: string) {
    const [popup] = await Promise.all([
      this.page.context().waitForEvent('page'),
      this.producerLookupIcon.click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    await popup.locator('#SearchText').waitFor({ state: 'visible', timeout: 10000 });
    await popup.locator('#SearchText').fill(searchText);
    await popup.locator('#Search').click();

    const resultLink = popup.locator('a.actionLink', { hasText: new RegExp(searchText, 'i') }).first();
    await resultLink.waitFor({ state: 'visible', timeout: 10000 });
    await resultLink.click();

    await expect(this.producerCodeInput).not.toHaveValue('', { timeout: 10000 });
  }

  // The Campaign ID field is a live-search autocomplete with no "browse all" affordance, so
  // picking "any" campaign means typing a letter to trigger suggestions and taking the first.
  async selectAnyCampaignId() {
    const candidateLetters = ['M', 'C', 'A', 'G'];
    for (const letter of candidateLetters) {
      await this.campaignIdSearchInput.click();
      await this.campaignIdSearchInput.fill('');
      await this.campaignIdSearchInput.pressSequentially(letter, { delay: 100 });
      const firstOption = this.page.locator('.ui-autocomplete .ui-menu-item').first();
      const appeared = await firstOption
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (appeared) {
        await firstOption.click();
        return;
      }
    }
    throw new Error('No Campaign ID suggestions appeared for any candidate letter.');
  }

  // Fills First/Last and clicks Reset to (re)compute the Name* field from them.
  async fillCustomerName(firstName: string, lastName: string) {
    await this.firstNameInput.fill(firstName);
    await this.lastNameInput.fill(lastName);
    await this.resetNameLink.click();
    await expect(this.nameInput).not.toHaveValue('', { timeout: 5000 });
  }

  async fillMailingAddress(address: MailingAddress) {
    await this.addressLine1Input.fill(address.line1);
    await this.cityInput.fill(address.city);
    await this.stateSelect.selectOption(address.state);
    await this.zipInput.fill(address.zip);
  }

  // A successful verify standardizes the address (e.g. the zip gains a "-XXXX" suffix), so a
  // changed zip is used as the completion/success signal rather than the visible "Address
  // Verified" confirmation text, which sits in a duplicated/hard-to-target DOM node.
  async verifyAddress() {
    const zipBefore = await this.zipInput.inputValue();
    await this.verifyAddressIcon.click();
    await this.page.waitForLoadState('networkidle');
    await expect(this.zipInput).not.toHaveValue(zipBefore, { timeout: 10000 });
  }

  async fillContactInfo(email: string, phoneNumber: string, phoneType: string = 'Home') {
    await this.emailInput.fill(email);
    await this.primaryPhoneTypeSelect.selectOption(phoneType);
    await this.primaryPhoneNumberInput.fill(phoneNumber);
  }

  // Saving can land on a "Select Customer" screen when existing customers share matching
  // details (e.g. the same test name reused across runs); explicitly picking "New Customer"
  // and saving again avoids silently merging this quote into an unrelated old customer record.
  // This can recur across separate save() calls (e.g. once after applicant info, again after
  // adding a vehicle), so each call resolves it independently with a bounded retry.
  async save() {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.saveLink.click();
      await this.page.waitForLoadState('networkidle');

      const matchScreenShown = await this.newCustomerRadio.isVisible().catch(() => false);
      if (!matchScreenShown) {
        return;
      }
      await this.newCustomerRadio.check();
    }
    await expect(this.newCustomerRadio).not.toBeVisible({ timeout: 10000 });
  }

  // The top-toolbar #NextPage link only exists on the Policy tab; once a vehicle exists, only
  // the bottom #NextPage_Bottom button remains, so check which is actually visible.
  async goToNextPage() {
    const topNext = this.page.locator('#NextPage');
    const bottomNext = this.page.locator('#NextPage_Bottom');
    if (await topNext.isVisible().catch(() => false)) {
      await topNext.click();
    } else {
      await bottomNext.click();
    }
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForLoadState('networkidle');
  }

  // The "Add Vehicle Detail" dropdown's option ids don't match its category labels 1:1.
  private static readonly VEHICLE_CATEGORY_OPTION_ID: Record<VehicleCategory, string> = {
    'Affinity Auto': 'PrivatePassengerAuto',
    Motorhome: 'Motorhome',
    'Travel Trailer': 'Trailer',
  };

  // Opens "Add Vehicle Detail" for the given category and fills the vehicle form. Each category
  // renders a differently-shaped form (see VehicleDetails), so only the fields that category
  // actually has are touched. Year, Make, and Model form a cascading chain (each one's options
  // only populate once the prior field is set, and for Motorhome/Travel Trailer, Rating Class
  // must be set first too), so each selection is followed by a networkidle wait before the next.
  async addVehicle(vehicle: VehicleDetails) {
    await this.addVehicleDetailButton.click();
    const optionId = QuotePage.VEHICLE_CATEGORY_OPTION_ID[vehicle.category];
    const categoryOption = this.page.locator(`#${optionId}`);
    await categoryOption.waitFor({ state: 'visible', timeout: 5000 });
    await categoryOption.click();
    await this.page.waitForLoadState('networkidle');

    // Affinity Auto's rating class auto-fills; Motorhome/Travel Trailer require picking one.
    if (vehicle.category !== 'Affinity Auto') {
      if (!vehicle.ratingClass) {
        throw new Error(`ratingClass is required for vehicle category "${vehicle.category}".`);
      }
      await this.vehicleRatingClassSelect.selectOption({ label: vehicle.ratingClass });
      await this.page.waitForLoadState('networkidle');
    }

    await this.vehicleModelYearInput.fill(vehicle.year);
    await this.vehicleModelYearInput.blur();
    await this.page.waitForLoadState('networkidle');

    await this.vehicleMakeSelect.selectOption({ label: vehicle.make });
    await this.page.waitForLoadState('networkidle');

    await this.vehicleModelSelect.selectOption({ label: vehicle.model });
    await this.page.waitForLoadState('networkidle');

    // Travel Trailer isn't self-propelled: no odometer, transmission, fuel, or engine location.
    if (vehicle.category === 'Travel Trailer') {
      return;
    }

    await this.vehicleOdometerInput.fill(vehicle.odometer ?? '');

    if (vehicle.category === 'Affinity Auto') {
      await this.vehicleTransmissionSelect.selectOption({ label: vehicle.transmissionType ?? 'Automatic' });
    }
    await this.vehicleFuelTypeSelect.selectOption({ label: vehicle.fuelType ?? 'Gasoline' });

    if (vehicle.category === 'Motorhome') {
      await this.vehicleEngineLocationSelect.selectOption({ label: vehicle.engineLocation ?? 'Front' });
    }
  }

  // After saving a rated vehicle, each pricing tier (Gold, Silver, ...) lists its deductible
  // options with prices. Confirms at least one tier's deductible options actually rendered.
  async expectDeductiblesDisplayed() {
    await expect(this.deductibleRows.first()).toBeVisible({ timeout: 15000 });
    const count = await this.deductibleRows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(this.deductibleRows.nth(i)).toBeVisible();
    }
  }

  // Occasionally the vehicle-add cascade (Year -> Make -> Model, each an AJAX round-trip) hasn't
  // fully registered server-side by the time Save fires, so the rating engine silently doesn't
  // run and no deductible options appear. Retrying save() recovers it without re-entering the
  // vehicle details.
  async saveVehicleAndExpectRated() {
    await this.save();
    try {
      await this.expectDeductiblesDisplayed();
    } catch {
      await this.save();
      await this.expectDeductiblesDisplayed();
    }
  }

  // Picks the given deductible amount's checkbox from whichever pricing tier lists it first
  // (e.g. "250" -> the first "..._DED250" row found, typically the top tier).
  async selectDeductible(amount: string) {
    const checkbox = this.page.locator(`tr[id*="_DED${amount}"] input[type=checkbox]`).first();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
  }

  async expectReviewPageOpened() {
    await expect(this.page.getByText('Rate Confirmation')).toBeVisible({ timeout: 15000 });
    await expect(this.riskSummaryLink).toBeVisible({ timeout: 15000 });
  }

  // The Pay Plans panel can still be mid-render (a secondary AJAX refresh after the tab's own
  // networkidle already resolved) right when this runs, so a plain .check() intermittently times
  // out on the global 15s actionTimeout waiting for the radio to become actionable - even though
  // the value is correct and the same row would pass on a faster render. Wait for it explicitly
  // with a longer budget, retrying once, then confirm it actually took (a check that "succeeds"
  // against a panel that's about to be replaced can silently no-op).
  async selectPayPlan(planName: string) {
    const radio = this.page.locator(`input[name="BasicPolicy.PayPlanCd"][value="${planName}"]`);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await radio.waitFor({ state: 'visible', timeout: 30000 });
        await radio.check();
        await this.page.waitForLoadState('networkidle');
        if (await radio.isChecked().catch(() => false)) {
          return;
        }
      } catch (err) {
        lastError = err;
      }
    }

    // Every attempt failed - the "value" this locator expects may not match what the app
    // actually renders (label text vs. the input's real value attribute can differ). Scrape the
    // radios that do exist on the page so the failure says what to fix instead of just timing out.
    const available = await this.page
      .locator('input[name="BasicPolicy.PayPlanCd"]')
      .evaluateAll((els) =>
        els.map((el) => {
          const input = el as HTMLInputElement;
          const label =
            input.closest('label')?.textContent?.trim() ||
            (input.id && document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim()) ||
            input.parentElement?.textContent?.trim() ||
            '';
          return `"${input.value}" (label: "${label}")`;
        })
      );
    throw new Error(
      `Could not select Pay Plan "${planName}" after 3 attempts. ` +
        (available.length
          ? `PayPlanCd radios actually present on the page: ${available.join(', ')}`
          : 'No "BasicPolicy.PayPlanCd" radios were found on the page at all - the Pay Plans tab may not have loaded.') +
        (lastError instanceof Error ? ` Last error: ${lastError.message}` : '')
    );
  }

  // Only meaningful once an AUTOMATED_BILL_PAY_PLANS plan is selected - that's what reveals the
  // "Pay Plan Information" panel this select lives in.
  async selectInstallmentPaymentMethod(method: 'ACH' | 'Credit Card') {
    await this.installmentMethodSelect.selectOption(method);
    await this.page.waitForTimeout(500);
  }

  // "Enter ACH/Credit Card Details" opens a PCI-compliant hosted payment form served from a
  // nested iframe stack (js-sdk-prod.payments.guidewire.net -> processonepayments.com). That
  // stack is torn down and recreated with a new "uniq=" query param at each step (entry screen ->
  // confirm screen), so frames must be re-queried by content rather than captured once and reused.
  private async waitForPaymentFrame(textMarker: string, timeoutMs = 20000): Promise<Frame> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const fr of this.page.frames()) {
        if (!fr.url().includes('processonepayments.com')) continue;
        const matches = await fr
          .evaluate((marker) => document.body?.innerText?.includes(marker), textMarker)
          .catch(() => false);
        if (matches) return fr;
      }
      await this.page.waitForTimeout(300);
    }
    throw new Error(`Payment form containing "${textMarker}" did not appear within ${timeoutMs}ms.`);
  }

  // Accepts the confirmation screen ("Payment method" summary + Accept checkbox) and waits for
  // the hosted payment iframe stack to close. A decline surfaces there too (e.g. "Your
  // transaction is not complete!") without the iframe closing, so that's detected explicitly
  // rather than left to time out.
  private async confirmAndSubmitPayment() {
    const confirmFrame = await this.waitForPaymentFrame('SUBMIT AND PAY', 25000);
    await confirmFrame.locator('#complianceConsentCheckboxVisible-input:visible').check();
    await confirmFrame.locator('button:visible', { hasText: /submit and pay/i }).click();

    // Re-query frames fresh each poll rather than reusing confirmFrame - by this point it may
    // already be a detached, torn-down instance (same reason waitForPaymentFrame re-queries).
    const start = Date.now();
    while (Date.now() - start < 20000) {
      const paymentFrames = this.page.frames().filter((fr) => fr.url().includes('processonepayments.com'));
      if (paymentFrames.length === 0) return;
      for (const fr of paymentFrames) {
        const declined = await fr
          .evaluate(() => document.body?.innerText?.includes('transaction is not complete'))
          .catch(() => false);
        if (declined) {
          throw new Error('Payment was declined by the hosted payment form ("Your transaction is not complete!").');
        }
      }
      await this.page.waitForTimeout(300);
    }
    throw new Error('Timed out waiting for the payment form to close after Submit and Pay.');
  }

  // Fills and submits the ACH collection form opened by "Enter ACH Details". Only Account
  // Number/Repeat/Routing Number are set - Name On Account auto-fills from the insured, and
  // Checking is the default account type.
  async enterACHDetailsOnPayPlan(details: ACHPaymentDetails) {
    await this.enterACHDetailsButton.click();
    const entryFrame = await this.waitForPaymentFrame('Routing Number');
    await entryFrame.locator('input[placeholder="Account Number"]').fill(details.accountNumber);
    await entryFrame.locator('input[placeholder="Repeat Account Number"]').fill(details.accountNumber);
    await entryFrame.locator('input[placeholder="Routing Number"]').fill(details.routingNumber);
    // Routing Number triggers a debounced async bank-name lookup; give it a beat to settle
    // before Next, or the click can land while the form is still mid-validation.
    await this.page.waitForTimeout(500);
    await entryFrame.getByRole('button', { name: /^next$/i }).click();
    await this.confirmAndSubmitPayment();
    await this.page.waitForLoadState('networkidle');
  }

  // Opens the Credit Card collection form via "Enter Credit Card Details" and waits for it to be
  // ready, then hands off - unlike enterACHDetailsOnPayPlan, card details aren't filled/submitted
  // here. The sandbox's generic test card (4111...) reliably fails the gateway's real Submit and
  // Pay authorization even though it fills and validates fine, so this is a manual hand-off point
  // until a test card that the gateway actually approves is available.
  async openCreditCardDetailsOnPayPlan() {
    await this.enterCreditCardDetailsButton.click();
    await this.waitForPaymentFrame('Card Number');
  }

  // Binding requires the "Select Customer" screen to be resolved at the exact moment of
  // clicking; an earlier save() doesn't carry over since the panel re-renders unchecked on
  // every reload. Checks "New Customer" immediately before clicking Bind, not before.
  async createApplication(): Promise<string> {
    const matchScreenShown = await this.newCustomerRadio.isVisible().catch(() => false);
    if (matchScreenShown) {
      await this.newCustomerRadio.check();
    }
    await this.bindLink.click();
    await this.page.waitForLoadState('networkidle');

    const applicationNumber = (await this.quoteNumberLocator.textContent())?.trim();
    expect(applicationNumber).toMatch(/^AP-\d+/);
    return applicationNumber!;
  }

  async finishApplication() {
    await this.closeoutLink.click();
    await this.page.waitForLoadState('networkidle');
    await expect(this.paymentTypeSelect).toBeVisible({ timeout: 15000 });
  }

  async selectPaymentType(type: 'None' | 'Check' | 'Credit Card' | 'ACH') {
    await this.paymentTypeSelect.selectOption({ label: type });
    await this.page.waitForLoadState('networkidle');
  }

  // For AUTOMATED_BILL_PAY_PLANS rows, the Credit Card/ACH entered on the Pay Plans tab carries
  // over to this screen's Payment Type automatically - this just confirms that happened instead
  // of re-selecting it. Compares by label (like selectPaymentType does), since the option's value
  // attribute isn't guaranteed to match its displayed text.
  async expectPaymentTypeCarriedOver(type: 'Credit Card' | 'ACH') {
    // The Closeout screen briefly shows "Select..." while it populates from the Pay Plans tab's
    // data server-side, so this needs to retry rather than read the value once immediately after
    // navigating here (a single read can catch that transient unpopulated state).
    await expect(async () => {
      const selectedLabel = await this.paymentTypeSelect.evaluate(
        (el) => (el as HTMLSelectElement).selectedOptions[0]?.label
      );
      expect(
        selectedLabel,
        `Expected Payment Type to already be "${type}" on Closeout, got "${selectedLabel}".`
      ).toBe(type);
    }).toPass({ timeout: 15000 });
  }

  async fillCheckNumber(checkNumber: string) {
    await this.checkNumberInput.fill(checkNumber);
  }

  // Kicks off a multi-stage, long-running server job (document generation, rating, etc.) that
  // cycles through several distinct "processing" overlays (e.g. "Printing Policy Output", then
  // "Processing Stats") and, once done, navigates away entirely to the Home/Inbox dashboard -
  // the application page's own elements (including quoteNumberLocator) no longer exist there.
  // The policy number instead appears in a notification banner: "Policy has been created: X".
  async issueNewBusiness(): Promise<string> {
    await this.issueNewBusinessLink.click();

    const policyCreatedBanner = this.page.getByText(/Policy has been created/i);
    await policyCreatedBanner.waitFor({ state: 'visible', timeout: 480000 });

    const bannerText = await policyCreatedBanner.textContent();
    const match = bannerText?.match(/Policy has been created:\s*([A-Z0-9-]+)/i);
    expect(match, `Could not find a policy number in banner text: "${bannerText}"`).not.toBeNull();
    return match![1];
  }
}
