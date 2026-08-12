import path from 'path';
import { test } from '@playwright/test';
import { LoginPage } from '../Pages/LoginPage';
import { HomePage } from '../Pages/HomePage';
import { QuotePage, LineOfBusiness, VehicleCategory, AUTOMATED_BILL_PAY_PLANS } from '../Pages/QuotePage';
import { StepResult, ReportResult, writeReport } from '../Reporting/TestReport';
import { waitForManualStep } from '../Utils/ManualStep';
import { readPolicyRows, PolicyRow } from '../Utils/PolicyDataFile';
import { randomTestRoutingNumber, randomTestAccountNumber } from '../Utils/TestPaymentData';

const REPORT_DIR = path.resolve(__dirname, '..', 'test-reports');
const DATA_FILE = path.resolve(__dirname, '..', 'test-data', 'policies.xlsx');

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'policy';
}

// Read once at module load so each row becomes its own named Playwright test - one bad row fails
// only its own test (via validationError below) rather than blocking every other row, and
// Playwright's own reporter/exit code naturally summarizes pass/fail across the whole batch.
let rows: PolicyRow[] = [];
let loadError: Error | undefined;
try {
  rows = readPolicyRows(DATA_FILE);
} catch (err) {
   loadError = err as Error;
}

if (loadError) {
  const capturedError = loadError;
  test('Policy data file could not be read', async () => {
    throw capturedError;
  });
} else {
  for (const row of rows) {
    const testName = `Row ${row.rowNumber}: ${row.firstName} ${row.lastName}`.trim();

    if (row.validationError) {
      // No `page` fixture requested here, so this doesn't waste a browser launch on a row that
      // can't proceed anyway.
      const message = row.validationError;
      test(testName, async () => {
        throw new Error(message);
      });
      continue;
    }

    test(testName, async ({ page }) => {
      test.setTimeout(900000);
      const startedAt = new Date();

      const loginPage = new LoginPage(page);
      const homePage = new HomePage(page);
      const quotePage = new QuotePage(page);

      const steps: StepResult[] = [];
      const result: ReportResult = {};

      // Tracks the current failure streak so the report can tell "this step is why the rest fell
      // over" apart from "this one just happened to fail too".
      let cascadeRootName: string | undefined;

      async function runStep<T>(
        name: string,
        fn: () => Promise<T>,
        detail?: (value: T) => string
      ): Promise<T | undefined> {
        const start = Date.now();
        try {
          const value = await test.step(name, fn);
          steps.push({ name, status: 'passed', durationMs: Date.now() - start, detail: detail?.(value) });
          cascadeRootName = undefined;
          return value;
        } catch (err) {
          const causedByStep = cascadeRootName;
          if (!cascadeRootName) {
            cascadeRootName = name;
          }
          steps.push({
            name,
            status: 'failed',
            durationMs: Date.now() - start,
            error: (err as Error).message,
            causedByStep,
          });
          return undefined;
        }
      }

      try {
        await runStep(`Login and start a new quote (State: ${row.state})`, async () => {
          await loginPage.goto();
          await loginPage.expectLoginPageVisible();
          await loginPage.login(process.env.GW_USERNAME!, process.env.GW_PASSWORD!);
          await homePage.expectLoaded();
          await homePage.startNewQuote({ state: row.state, effectiveDate: row.effectiveDate });
          await quotePage.expectQuoteOpened(row.lineOfBusiness as LineOfBusiness);
        });

        result.quoteNumber = await runStep(
          `Select line of business: ${row.lineOfBusiness}`,
          async () => {
            await quotePage.selectLineOfBusiness(row.lineOfBusiness as LineOfBusiness);
            return quotePage.expectQuoteNumberGenerated();
          },
          (number) => `Quote ${number} generated.`
        );

        await runStep('Select producer and campaign', async () => {
          await quotePage.selectProducer('abc');
          await quotePage.selectAnyCampaignId();
        });

        await runStep(
          'Fill applicant info (name, address, contact)',
          async () => {
            await quotePage.fillCustomerName(row.firstName, row.lastName);
            await quotePage.fillMailingAddress({
              line1: row.addressLine1,
              city: row.city,
              state: row.mailingState,
              zip: row.zip,
            });
            await quotePage.verifyAddress();
            await quotePage.fillContactInfo(row.email, row.phone);
            await quotePage.save();
            await quotePage.goToNextPage();
          },
          () => `${row.firstName} ${row.lastName}, email ${row.email}, phone ${row.phone}.`
        );

        // Uses the spreadsheet's Odometer value when given; otherwise randomizes (30,000-35,000)
        // so each policy still gets a distinct value. Travel Trailer isn't self-propelled and has
        // no odometer field at all.
        if (row.vehicleCategory !== 'Travel Trailer') {
          result.odometer = row.odometer || String(Math.floor(Math.random() * (35000 - 30000 + 1)) + 30000);
        }

        await runStep(
          `Add vehicle (${row.vehicleCategory}: ${row.vehicleYear} ${row.vehicleMake} ${row.vehicleModel})`,
          async () => {
            await quotePage.addVehicle({
              category: row.vehicleCategory as VehicleCategory,
              ratingClass: row.vehicleRatingClass,
              year: row.vehicleYear,
              make: row.vehicleMake,
              model: row.vehicleModel,
              odometer: result.odometer,
              transmissionType: row.transmission,
              fuelType: row.fuelType,
              engineLocation: row.engineLocation,
            });
            await quotePage.saveVehicleAndExpectRated();
          },
          () => (result.odometer ? `Odometer reading: ${result.odometer} mi.` : 'Vehicle rated.')
        );

        await runStep(`Select $${row.deductible} deductible`, async () => {
          await quotePage.selectDeductible(row.deductible);
        });

        await runStep('Go to Review page and verify it opened', async () => {
          await quotePage.goToNextPage();
          await quotePage.expectReviewPageOpened();
        });

        const isAutomatedBillPlan = (AUTOMATED_BILL_PAY_PLANS as readonly string[]).includes(row.payPlan);

        await runStep(`Go to Pay Plans and select plan: ${row.payPlan}`, async () => {
          await quotePage.goToNextPage();
          await quotePage.selectPayPlan(row.payPlan);
        });

        // Automated Bill plans reveal an in-page Credit Card/ACH collection form right here on
        // the Pay Plans tab; whatever's entered carries over to the Closeout tab's payment
        // section automatically (see the payment step near the bottom - it's skipped for these
        // rows), so this is the only place payment details get entered for them.
        if (isAutomatedBillPlan && row.paymentType === 'ACH') {
          result.paymentEnteredManually = false;
          await runStep('Enter ACH details on Pay Plans tab', async () => {
            await quotePage.selectInstallmentPaymentMethod('ACH');
            await quotePage.enterACHDetailsOnPayPlan({
              routingNumber: row.achRoutingNumber || randomTestRoutingNumber(),
              accountNumber: row.achAccountNumber || randomTestAccountNumber(),
            });
          });
        } else if (isAutomatedBillPlan && row.paymentType === 'Credit Card') {
          // The sandbox's generic test card fills and validates fine but is reliably declined by
          // the gateway's real Submit and Pay step, so this opens the same form ACH uses and
          // hands off for a human to enter real card details and complete Submit and Pay.
          result.paymentEnteredManually = true;

          await runStep('Open Credit Card details on Pay Plans tab', async () => {
            await quotePage.selectInstallmentPaymentMethod('Credit Card');
            await quotePage.openCreditCardDetailsOnPayPlan();
          });

          await runStep('Manual: enter credit card details', async () => {
            await waitForManualStep(
              page,
              'Payment Type is set to "Credit Card" on an Automated Bill plan and the Enter Credit ' +
                "Card Details form is open - the sandbox test card isn't accepted by the payment " +
                'gateway, so enter real card details and complete Submit and Pay by hand.'
            );
          });
        }

        result.applicationNumber = await runStep(
          'Create Application',
          () => quotePage.createApplication(),
          (number) => `${result.quoteNumber} → ${number}.`
        );

        await runStep('Finish application', async () => {
          await quotePage.finishApplication();
        });

        if (isAutomatedBillPlan) {
          // Already entered on the Pay Plans tab above, and it carries over here automatically -
          // nothing left to select on this screen.
          await runStep(`Payment (${row.paymentType}) carried over from Pay Plans tab`, async () => {
            await quotePage.expectPaymentTypeCarriedOver(row.paymentType as 'Credit Card' | 'ACH');
          });
        } else {
          // Credit Card/ACH detail entry isn't scripted on this screen (no known field IDs), so
          // those two payment types get a manual hand-off instead of failing outright; None/Check
          // fill automatically.
          const needsManualPaymentDetails = row.paymentType === 'Credit Card' || row.paymentType === 'ACH';

          if (needsManualPaymentDetails) {
            result.paymentEnteredManually = true;

            await runStep(`Select payment type: ${row.paymentType}`, async () => {
              await quotePage.selectPaymentType(row.paymentType as 'Credit Card' | 'ACH');
            });

            await runStep('Manual: enter payment details', async () => {
              const bankDetails =
                row.paymentType === 'ACH' && row.achRoutingNumber && row.achAccountNumber
                  ? ` Use routing number ${row.achRoutingNumber} and account number ${row.achAccountNumber}.`
                  : '';
              await waitForManualStep(
                page,
                `Payment Type is set to "${row.paymentType}", which isn't scripted yet - enter the ` +
                  `card/bank details on this screen.${bankDetails}`
              );
            });
          } else {
            await runStep(
              `Fill payment info (${row.paymentType}${row.paymentType === 'Check' ? `, #${row.checkNumber}` : ''})`,
              async () => {
                await quotePage.selectPaymentType(row.paymentType as 'None' | 'Check');
                if (row.paymentType === 'Check') {
                  await quotePage.fillCheckNumber(row.checkNumber!);
                }
              }
            );
          }
        }

        result.policyNumber = await runStep(
          'Issue New Business and capture policy number',
          () => quotePage.issueNewBusiness(),
          (number) => `${result.applicationNumber} → ${number}.`
        );

        const failedSteps = steps.filter((s) => s.status === 'failed');
        if (failedSteps.length > 0) {
          console.log(
            `Row ${row.rowNumber} finished with ${failedSteps.length} failed step(s): ` +
              failedSteps.map((s) => s.name).join('; ')
          );
        } else {
          console.log(
            `Row ${row.rowNumber} complete. Quote: ${result.quoteNumber} -> Application: ` +
              `${result.applicationNumber} -> Policy: ${result.policyNumber}`
          );
        }

        // Every step above ran to completion regardless of earlier failures (see runStep), so
        // Playwright itself wouldn't otherwise know this row had problems. Failing here - after
        // the whole flow was attempted and after the finally block below writes the report -
        // keeps Playwright's own pass/fail signal (exit code, HTML reporter) honest without
        // cutting this row's run short, and without affecting any other row's test.
        if (failedSteps.length > 0) {
          throw new Error(
            `${failedSteps.length} of ${steps.length} step(s) failed: ${failedSteps.map((s) => s.name).join('; ')}`
          );
        }
      } finally {
        const finishedAt = new Date();
        const overallStatus = steps.some((s) => s.status === 'failed') ? 'failed' : 'passed';

        let screenshotBase64: string | undefined;
        try {
          screenshotBase64 = (await page.screenshot()).toString('base64');
        } catch {
          // Page may already be closed/navigated away on a hard failure; report just omits it.
        }

        const slug = slugify(`${row.firstName}-${row.lastName}`);
        const { reportPath } = writeReport(
          {
            testName: `Row ${row.rowNumber}: ${row.firstName} ${row.lastName}`,
            startedAt,
            finishedAt,
            overallStatus,
            config: {
              state: row.state,
              effectiveDate: row.effectiveDate,
              lineOfBusiness: row.lineOfBusiness,
              customerFirstName: row.firstName,
              customerLastName: row.lastName,
              mailingAddress: `${row.addressLine1}, ${row.city}, ${row.mailingState} ${row.zip}`,
              email: row.email,
              phone: row.phone,
              vehicleCategory: row.vehicleCategory,
              vehicleRatingClass: row.vehicleRatingClass,
              vehicleYear: row.vehicleYear,
              vehicleMake: row.vehicleMake,
              vehicleModel: row.vehicleModel,
              deductible: row.deductible,
              payPlan: row.payPlan,
              paymentType: row.paymentType,
              checkNumber: row.checkNumber,
            },
            result,
            steps,
            screenshotBase64,
            environment: process.env.GW_BASE_URL!,
          },
          REPORT_DIR,
          `${slug}-report.html`
        );

        console.log(`Row ${row.rowNumber} report: ${reportPath}`);
      }
    });
  }
}
