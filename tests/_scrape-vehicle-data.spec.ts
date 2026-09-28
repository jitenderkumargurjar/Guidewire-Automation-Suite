import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { LoginPage } from '../Pages/LoginPage';
import { HomePage } from '../Pages/HomePage';
import { QuotePage } from '../Pages/QuotePage';

// Regenerates scripts/vehicleData.json - the verified source for VEHICLE_DATA in
// scripts/generatePolicyTemplate.js. Run this (then `npm run policies:template`) if this
// Guidewire instance's Make/Model reference data is ever suspected to have changed.
//
// Two things confirmed the hard way before writing this, both load-bearing for the approach below:
//  - Model Year does NOT affect the Make or Model lists (checked 2000-2030, identical throughout),
//    so a single representative YEAR below is enough - no need to scrape per year.
//  - The Make list *is* shared within a category (all of Motorhome Class A/B/C list the same
//    makes; all four Travel-Trailer-family classes list the same makes), but the Model list for a
//    given make is NOT - it depends on the exact rating class, including makes with real models
//    under one class and zero under another (e.g. Forest River/Motorhome: Class A has
//    Berkshire/Charleston/Fr3/Georgetown/Legacy/Tsunami, Class C has a completely different
//    Forester/Lexington/Ridgeveiw/Solera/Sunseeker lineup; Airstream/Travel Trailer has 20 real
//    models, Airstream/Trailer Fifth Wheel has zero). So every one of the 8 rating classes gets
//    its own full make-with-models scrape below, not one scrape per category.
//
// Single session only (--workers=1): this Guidewire instance appears to allow only one active
// session per user, so running these concurrently intermittently kicks an in-progress login back
// to the login page mid-scrape.
const OUT_PATH = path.resolve(__dirname, '..', 'scripts', 'vehicleData.json');
const YEAR = '2020';

// [VehicleCategory option id on "Add Vehicle Detail", RatingClass label(s) under it]
const CATEGORIES: { optionId: string; ratingClasses: string[] }[] = [
  { optionId: 'PrivatePassengerAuto', ratingClasses: ['Affinity Auto'] },
  { optionId: 'Motorhome', ratingClasses: ['Motorhome Class A', 'Motorhome Class B', 'Motorhome Class C'] },
  {
    optionId: 'Trailer',
    ratingClasses: ['Travel Trailer', 'Trailer Fifth Wheel', 'Trailer Pop-up', 'Truck Slide in Camper'],
  },
];

async function newQuoteToVehicleTab(page: any, quotePage: any, homePage: any, loginPage: any, lastName: string) {
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
  await quotePage.fillCustomerName('Scrape', lastName);
  await quotePage.fillMailingAddress({ line1: '1 Infinite Loop', city: 'Cupertino', state: 'CA', zip: '95014' });
  await quotePage.verifyAddress();
  await quotePage.fillContactInfo('scrapevehicledata@test.com', '5551234567');
  await quotePage.save();
  await quotePage.goToNextPage();
}

// A Make selection triggers an async repopulation of the Model dropdown (same for Year -> Make);
// reading too soon catches the *previous* selection's stale list. Poll for a change, then a
// settle pause, rather than a single fixed wait.
async function pollForChange(before: string[], read: () => Promise<string[]>): Promise<string[]> {
  const start = Date.now();
  let after = before;
  while (Date.now() - start < 10000) {
    after = await read();
    if (JSON.stringify(after) !== JSON.stringify(before) && after.length > 1) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 300));
  return read();
}

function cleanOptions(opts: string[]): string[] {
  return opts.map((o) => o.trim()).filter((o) => o && !/^select/i.test(o));
}

async function scrapeMakes(page: any, quotePage: any): Promise<string[]> {
  const before = await quotePage.vehicleMakeSelect.locator('option').allTextContents();
  await quotePage.vehicleModelYearInput.fill(YEAR);
  await quotePage.vehicleModelYearInput.blur();
  await page.waitForLoadState('networkidle');
  const opts = await pollForChange(before, () => quotePage.vehicleMakeSelect.locator('option').allTextContents());
  return cleanOptions(opts);
}

async function scrapeModelsForMake(page: any, quotePage: any, make: string): Promise<string[]> {
  const before = await quotePage.vehicleModelSelect.locator('option').allTextContents();
  await quotePage.vehicleMakeSelect.selectOption({ label: make });
  await page.waitForLoadState('networkidle');
  const opts = await pollForChange(before, () => quotePage.vehicleModelSelect.locator('option').allTextContents());
  return cleanOptions(opts);
}

async function scrapeRatingClass(
  page: any,
  quotePage: any,
  ratingClass: string,
  isFirstInCategory: boolean
): Promise<Record<string, string[]>> {
  if (!isFirstInCategory) {
    await quotePage.vehicleRatingClassSelect.selectOption({ label: ratingClass });
    await page.waitForLoadState('networkidle');
  }
  const makes = await scrapeMakes(page, quotePage);
  console.log(`${ratingClass}: ${makes.length} makes`);
  const result: Record<string, string[]> = {};
  for (const make of makes) {
    result[make] = await scrapeModelsForMake(page, quotePage, make);
  }
  const withModels = Object.entries(result).filter(([, models]) => models.length > 0);
  console.log(`${ratingClass}: done. ${withModels.length}/${makes.length} makes have at least one model.`);
  // Drop makes with zero models for this class - nothing to pick in Model anyway.
  return Object.fromEntries(withModels);
}

// One test per category (not per rating class) so Affinity Auto's single class doesn't need its
// own quote setup, and so a failure in one category doesn't lose the others' progress - each
// writes the full accumulated result to disk after every rating class.
for (const { optionId, ratingClasses } of CATEGORIES) {
  test(`scrape vehicle data: ${ratingClasses[0]} category`, async ({ page }) => {
    test.setTimeout(1800000);
    const loginPage = new LoginPage(page);
    const homePage = new HomePage(page);
    const quotePage = new QuotePage(page);
    await newQuoteToVehicleTab(page, quotePage, homePage, loginPage, optionId);

    await quotePage.addVehicleDetailButton.click();
    await page.locator(`#${optionId}`).click();
    await page.waitForLoadState('networkidle');

    const existing = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) : {};

    for (let i = 0; i < ratingClasses.length; i++) {
      const ratingClass = ratingClasses[i];
      const data = await scrapeRatingClass(page, quotePage, ratingClass, i === 0);
      existing[ratingClass] = data;
      fs.writeFileSync(OUT_PATH, JSON.stringify(existing, null, 2));
    }
  });
}
