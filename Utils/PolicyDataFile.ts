import XLSX from 'xlsx';
import fs from 'fs';
import { AUTOMATED_BILL_PAY_PLANS, DIRECT_BILL_PAY_PLANS } from '../Pages/QuotePage';

const VALID_PAY_PLANS: readonly string[] = [...DIRECT_BILL_PAY_PLANS, ...AUTOMATED_BILL_PAY_PLANS];

export interface PolicyRow {
  // 1-based spreadsheet row number (header is row 1), used in error messages so a typo is easy
  // to find without counting.
  rowNumber: number;
  state: string;
  effectiveDate?: string;
  lineOfBusiness: string;
  firstName: string;
  lastName: string;
  addressLine1: string;
  city: string;
  mailingState: string;
  zip: string;
  email: string;
  phone: string;
  vehicleCategory: string;
  vehicleRatingClass?: string;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  // Blank means "let the test randomize it" - see CreatePolicies.spec.ts.
  odometer?: string;
  transmission?: string;
  fuelType?: string;
  engineLocation?: string;
  deductible: string;
  payPlan: string;
  paymentType: string;
  checkNumber?: string;
  // Blank means "let the test randomize it" (see randomTestRoutingNumber/randomTestAccountNumber
  // in CreatePolicies.spec.ts) - only meaningful when paymentType is "ACH".
  achRoutingNumber?: string;
  achAccountNumber?: string;
  // Set when the row fails validation (missing/inconsistent fields). The row is still returned
  // rather than dropped or thrown, so one bad row can surface as a single failed policy instead
  // of blocking every other row in the file from running.
  validationError?: string;
}

// Excel auto-converts date-shaped text to its own date type, and can auto-convert plain numeric
// text (zip, phone, deductible, etc.) to a number - normalizing everything to a trimmed string
// here means the rest of the code never has to think about cell types.
function cellToString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) {
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${value.getFullYear()}`;
  }
  return String(value).trim();
}

// The spreadsheet has a single VehicleRatingClass column (see scripts/generatePolicyTemplate.js)
// rather than a separate VehicleCategory column, since VehicleCategory is really just "which of
// these 8 rating classes did you pick" - this is the reverse lookup that recovers it. Keys must
// match scripts/generatePolicyTemplate.js's VEHICLE_RATING_CLASSES list exactly.
const RATING_CLASS_TO_CATEGORY: Record<string, string> = {
  'Affinity Auto': 'Affinity Auto',
  'Motorhome Class A': 'Motorhome',
  'Motorhome Class B': 'Motorhome',
  'Motorhome Class C': 'Motorhome',
  'Travel Trailer': 'Travel Trailer',
  'Trailer Fifth Wheel': 'Travel Trailer',
  'Trailer Pop-up': 'Travel Trailer',
  'Truck Slide in Camper': 'Travel Trailer',
};

const REQUIRED_FIELDS: (keyof PolicyRow)[] = [
  'state',
  'lineOfBusiness',
  'firstName',
  'lastName',
  'addressLine1',
  'city',
  'mailingState',
  'zip',
  'email',
  'phone',
  'vehicleRatingClass',
  'vehicleYear',
  'vehicleMake',
  'vehicleModel',
  'deductible',
  'payPlan',
  'paymentType',
];

// Cheap checks that catch a typo'd spreadsheet before a browser even opens for that row, rather
// than failing deep inside the Playwright flow with a less obvious error.
function validate(row: PolicyRow): string | undefined {
  const missing = REQUIRED_FIELDS.filter((key) => !row[key]);
  if (missing.length > 0) {
    return `Row ${row.rowNumber}: missing required value(s): ${missing.join(', ')}.`;
  }
  if (!row.vehicleCategory) {
    return (
      `Row ${row.rowNumber}: VehicleRatingClass "${row.vehicleRatingClass}" is not recognized ` +
      `(must be one of: ${Object.keys(RATING_CLASS_TO_CATEGORY).join(', ')}).`
    );
  }
  if (row.paymentType === 'Check' && !row.checkNumber) {
    return `Row ${row.rowNumber}: CheckNumber is required when PaymentType is "Check".`;
  }
  const validPaymentTypes = ['None', 'Check', 'Credit Card', 'ACH'];
  if (!validPaymentTypes.includes(row.paymentType)) {
    return `Row ${row.rowNumber}: PaymentType "${row.paymentType}" must be one of: ${validPaymentTypes.join(', ')}.`;
  }
  if (!VALID_PAY_PLANS.includes(row.payPlan)) {
    return `Row ${row.rowNumber}: PayPlan "${row.payPlan}" must be one of: ${VALID_PAY_PLANS.join(', ')}.`;
  }
  if (
    (AUTOMATED_BILL_PAY_PLANS as readonly string[]).includes(row.payPlan) &&
    row.paymentType !== 'Credit Card' &&
    row.paymentType !== 'ACH'
  ) {
    return (
      `Row ${row.rowNumber}: PayPlan "${row.payPlan}" is an Automated Bill plan, which requires ` +
      `PaymentType "Credit Card" or "ACH" (got "${row.paymentType}").`
    );
  }
  return undefined;
}

export function readPolicyRows(filePath: string): PolicyRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Policy data file not found: ${filePath}\nRun "npm run policies:template" to create a starter file, then fill in your rows.`
    );
  }

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets['Policies'] || workbook.Sheets[workbook.SheetNames[0]];
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  if (records.length === 0) {
    throw new Error(`Policy data file has no rows: ${filePath}`);
  }

  return records.map((record, index) => {
    const get = (key: string) => cellToString(record[key]);
    const vehicleRatingClass = get('VehicleRatingClass');
    const row: PolicyRow = {
      rowNumber: index + 2,
      state: get('State'),
      effectiveDate: get('EffectiveDate') || undefined,
      lineOfBusiness: get('LineOfBusiness'),
      firstName: get('FirstName'),
      lastName: get('LastName'),
      addressLine1: get('AddressLine1'),
      city: get('City'),
      mailingState: get('MailingState'),
      zip: get('Zip'),
      email: get('Email'),
      phone: get('Phone'),
      vehicleCategory: RATING_CLASS_TO_CATEGORY[vehicleRatingClass] ?? '',
      vehicleRatingClass: vehicleRatingClass || undefined,
      vehicleYear: get('VehicleYear'),
      vehicleMake: get('VehicleMake'),
      vehicleModel: get('VehicleModel'),
      odometer: get('Odometer') || undefined,
      transmission: get('Transmission') || undefined,
      fuelType: get('FuelType') || undefined,
      engineLocation: get('EngineLocation') || undefined,
      deductible: get('Deductible'),
      payPlan: get('PayPlan'),
      paymentType: get('PaymentType'),
      checkNumber: get('CheckNumber') || undefined,
      achRoutingNumber: get('ACHRoutingNumber') || undefined,
      achAccountNumber: get('ACHAccountNumber') || undefined,
    };
    row.validationError = validate(row);
    return row;
  });
}
