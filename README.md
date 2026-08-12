# Guidewire Automation Suite

Playwright + TypeScript automation for Guidewire InsuranceNow. Drives the full policy lifecycle end to end — login, new quote, applicant info, vehicle, rating, review, pay plan, bind, closeout, issue — for Mechanical Breakdown Insurance and Vehicle Service Contract policies.

The suite is data-driven: one row in `test-data/policies.xlsx` produces one fully issued policy, and every row writes its own self-contained HTML report.

## Setup

1. Install dependencies:
   ```
   npm install
   npx playwright install
   ```
2. Copy `.env.example` to `.env` and fill in real values:
   ```
   GW_BASE_URL=...
   GW_USERNAME=...
   GW_PASSWORD=...
   ```
   `.env` is gitignored — never commit it.
3. Generate a starter policy data file (skip if `test-data/policies.xlsx` already exists):
   ```
   npm run policies:template
   ```

## Running tests

| Command | What it does |
|---|---|
| `npm run test:policies` | Runs every row in `test-data/policies.xlsx` (headed, Chromium) |
| `npm run test:headed` | Runs the whole suite (headed, Chromium) |
| `npx playwright test tests/Login.spec.ts` | Smoke test: login reaches the home page |
| `npx playwright test tests/CreatePolicies.spec.ts --grep "<name>"` | Runs only rows whose test name matches |
| `npm run report` | Opens Playwright's own HTML report for the last run |

Each policy row also gets its own report at `test-reports/<slug>-report.html` (donut chart, step-by-step ledger, root-cause/cascade grouping for failures).

## Project structure

```
Pages/          Page Object Model — one class per app screen (LoginPage, HomePage, QuotePage)
Utils/          Policy data file reading/validation, test payment data, manual-step helper
Reporting/      Self-contained HTML report generator (Reporting/TestReport.ts)
tests/          Playwright specs
scripts/        generatePolicyTemplate.js — (re)builds test-data/policies.xlsx with dropdowns
test-data/      policies.xlsx (gitignored — contains real customer/policy data)
test-reports/   Per-row HTML reports (generated)
```

### Adding policies to test

Open `test-data/policies.xlsx`, add a row (dropdowns are provided for most columns), save, close Excel, then run `npm run policies:template` to refresh the dropdown lists if needed — it preserves existing rows as data. Required columns are validated up front by `Utils/PolicyDataFile.ts`; a bad row fails fast with a specific message before any browser opens.

## Known limitations

- **Closeout-screen Credit Card/ACH** (Direct Bill plans, selected on the final payment screen) isn't scripted — no known field IDs yet. The test pauses in-browser (`page.pause()`) with an instruction for a human to complete it.
- **Automated Bill Credit Card** (Pay Plans tab) *is* fully scripted, but there's no gateway-approved test card yet — the generic `4111...` sandbox card fills and validates but is reliably declined by the real payment gateway's Submit and Pay step. This surfaces as a normal failed step (`Payment was declined by the hosted payment form...`), not a crash or a manual pause.
- **Automated Bill ACH** (Pay Plans tab) is fully scripted and works end to end with standard ACH test routing/account numbers.
- Vehicle Make/Model/Deductible/Transmission/FuelType/EngineLocation dropdown lists in the Excel template are a best-effort convenience list, not a verified export from this Guidewire instance.
