// (Re)creates test-data/policies.xlsx with dropdowns for the columns CreatePolicies.spec.ts reads.
// Preserves whatever row(s) already exist in the current file (as data, not as a dropdown source);
// if the file doesn't exist yet, seeds it with one filled-in example row instead.
// Run with: npm run policies:template
//
// Dropdown sources for State/MailingState/VehicleMake/VehicleModel live on a hidden "Lists" sheet
// (Excel's inline list-validation formula has a ~255 character limit, too short for 50 states or
// 170+ vehicle makes). VehicleRatingClass -> VehicleMake -> VehicleModel is a three-level cascade,
// mirroring the real app's Vehicle tab (Pages/QuotePage.ts: VehicleCategory picks which "Add
// Vehicle Detail" form shows, and Make/Model are cascading selects fed by the resulting vehicle
// type). Each make's model list is a named range, and each rating class's make list is also a
// named range; the Make/Model columns' validation formulas resolve the right named range per row
// via INDIRECT() directly against that row's VehicleRatingClass (and +Make) cells - no
// class->category lookup needed for this, since (see below) the Model list doesn't just depend on
// category, it depends on the exact rating class.
//
// VehicleMake/VehicleModel (VEHICLE_DATA, from ./vehicleData.json) *is* a verified export - scraped
// live, one rating class at a time, via tests/_scrape-vehicle-data.spec.ts (see that file's doc
// comment for method - re-run it, then this script, if this instance's reference data ever changes).
// Two things that looked like reasonable shortcuts turned out to be wrong and cost real debugging
// time before this was scraped, so both are captured here too: (1) the Make list *is* shared within
// a category (Motorhome
// Class A/B/C all list the same ~50 makes; the four Travel-Trailer-family classes all list the same
// ~180), but (2) the Model list for a given make is NOT shared - it depends on the exact rating
// class, including makes with real models under one class and zero under another (e.g. Forest
// River/Motorhome: Class A has Berkshire/Charleston/Fr3/Georgetown/Legacy/Tsunami, Class C has an
// entirely different Forester/Lexington/Ridgeveiw/Solera/Sunseeker lineup; Airstream/Travel Trailer
// has 20 real models, Airstream/Trailer Fifth Wheel has zero). So VEHICLE_DATA is keyed by the
// exact rating class throughout, not by the 3-way category grouping - a make with zero models under
// a given class is dropped from that class's Make list entirely (there'd be nothing to pick in
// Model anyway). Other lists (PayPlan, VehicleRatingClass, PaymentType, Deductible, Transmission,
// FuelType, EngineLocation) are still hand-confirmed against the live app rather than scraped.
// Every dropdown here still allows typing over it (showErrorMessage: false) as a safety valve in
// case this Guidewire instance's reference data changes after the last scrape.
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const outPath = path.resolve(__dirname, '..', 'test-data', 'policies.xlsx');

const HEADERS = [
  'State',
  'EffectiveDate',
  'LineOfBusiness',
  'FirstName',
  'LastName',
  'AddressLine1',
  'City',
  'MailingState',
  'Zip',
  'Email',
  'Phone',
  'VehicleRatingClass',
  'VehicleYear',
  'VehicleMake',
  'VehicleModel',
  'Odometer',
  'Transmission',
  'FuelType',
  'EngineLocation',
  'Deductible',
  'PayPlan',
  'PaymentType',
  'CheckNumber',
  'CardNumber',
  'ACHRoutingNumber',
  'ACHAccountNumber',
];

// [State name, abbreviation] - the New Quote flyout's State field (HomePage#QuickAction_StateCd)
// selects by full name (e.g. "Texas"); the applicant's Mailing State field
// (QuotePage#InsuredMailingAddr.StateProvCd) selects by 2-letter abbreviation (e.g. "CA").
const STATES = [
  ['Alabama', 'AL'], ['Alaska', 'AK'], ['Arizona', 'AZ'], ['Arkansas', 'AR'],
  ['California', 'CA'], ['Colorado', 'CO'], ['Connecticut', 'CT'], ['Delaware', 'DE'],
  ['Florida', 'FL'], ['Georgia', 'GA'], ['Hawaii', 'HI'], ['Idaho', 'ID'],
  ['Illinois', 'IL'], ['Indiana', 'IN'], ['Iowa', 'IA'], ['Kansas', 'KS'],
  ['Kentucky', 'KY'], ['Louisiana', 'LA'], ['Maine', 'ME'], ['Maryland', 'MD'],
  ['Massachusetts', 'MA'], ['Michigan', 'MI'], ['Minnesota', 'MN'], ['Mississippi', 'MS'],
  ['Missouri', 'MO'], ['Montana', 'MT'], ['Nebraska', 'NE'], ['Nevada', 'NV'],
  ['New Hampshire', 'NH'], ['New Jersey', 'NJ'], ['New Mexico', 'NM'], ['New York', 'NY'],
  ['North Carolina', 'NC'], ['North Dakota', 'ND'], ['Ohio', 'OH'], ['Oklahoma', 'OK'],
  ['Oregon', 'OR'], ['Pennsylvania', 'PA'], ['Rhode Island', 'RI'], ['South Carolina', 'SC'],
  ['South Dakota', 'SD'], ['Tennessee', 'TN'], ['Texas', 'TX'], ['Utah', 'UT'],
  ['Vermont', 'VT'], ['Virginia', 'VA'], ['Washington', 'WA'], ['West Virginia', 'WV'],
  ['Wisconsin', 'WI'], ['Wyoming', 'WY'],
];

const LINE_OF_BUSINESS = ['Mechanical Breakdown Insurance', 'Vehicle Service Contract'];
// [RatingClass, Category] - all 8 selectable VehicleRatingClass values and which VehicleCategory
// each belongs to. "Affinity Auto" is its own rating class (auto-fills once the vehicle type is
// chosen, per Pages/QuotePage.ts); Motorhome/Travel Trailer's sub-classes are confirmed by the
// VehicleDetails.ratingClass comment there. Keep in sync with Utils/PolicyDataFile.ts's
// RATING_CLASS_TO_CATEGORY, which does this same mapping at read time.
const VEHICLE_RATING_CLASSES = [
  ['Affinity Auto', 'Affinity Auto'],
  ['Motorhome Class A', 'Motorhome'],
  ['Motorhome Class B', 'Motorhome'],
  ['Motorhome Class C', 'Motorhome'],
  ['Travel Trailer', 'Travel Trailer'],
  ['Trailer Fifth Wheel', 'Travel Trailer'],
  ['Trailer Pop-up', 'Travel Trailer'],
  ['Truck Slide in Camper', 'Travel Trailer'],
];
const YEARS = Array.from({ length: 2030 - 2005 + 1 }, (_, i) => String(2005 + i));
const TRANSMISSIONS = ['Automatic', 'Manual'];
const FUEL_TYPES = ['Gasoline', 'Diesel', 'Hybrid', 'Electric'];
const ENGINE_LOCATIONS = ['Front', 'Rear'];
const DEDUCTIBLES = ['100', '250', '500', '1000'];
// Re-confirmed 2026-08-10 against the live app's Pay Plans tab (exactly these five radio options
// exist - see Pages/QuotePage.ts's DIRECT_BILL_PAY_PLANS/AUTOMATED_BILL_PAY_PLANS). Must match
// verbatim, including capitalization/spacing - CreatePolicies.spec.ts selects the Pay Plans radio
// by this exact value, so a mismatched string here is why pay plan selection silently fails.
const PAY_PLANS = [
  'Annual Pay Direct', 'Quarterly Pay Direct',
  'Annual Pay Automated', 'Quarterly Pay Automated', 'Monthly Pay Automated',
];
const PAYMENT_TYPES = ['None', 'Check', 'Credit Card', 'ACH'];

// Verified export, keyed by exact VehicleRatingClass - see file header comment for why category
// alone isn't enough and how this was captured.
const VEHICLE_DATA = require('./vehicleData.json');

// Excel defined names can't contain spaces or hyphens - matches the SUBSTITUTE() calls in the
// Make/Model columns' INDIRECT() formulas below, which sanitize cell values the same way.
function sanitizeName(name) {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

// Every non-[A-Za-z0-9_] character that actually appears in a rating class or make name - the
// scraped data has more than just spaces/hyphens (e.g. "Livin' Lite", "T@B", "S & S",
// "Sportsmobile-(2WD Only)"), and any one missed here leaves that make's Model dropdown empty.
const FORMULA_SANITIZE_CHARS = [
  ...new Set(
    [...VEHICLE_RATING_CLASSES.map(([ratingClass]) => ratingClass), ...Object.values(VEHICLE_DATA).flatMap(Object.keys)]
      .join('')
      .replace(/[A-Za-z0-9_]/g, '')
  ),
];

// Formula fragment that sanitizes a cell reference the same way sanitizeName() sanitizes a string,
// one nested SUBSTITUTE per character in FORMULA_SANITIZE_CHARS.
function sanitizeFormula(cellRef) {
  return FORMULA_SANITIZE_CHARS.reduce(
    (expr, ch) => `SUBSTITUTE(${expr},"${ch === '"' ? '""' : ch}","_")`,
    cellRef
  );
}

const colLetter = (n) => XLSX.utils.encode_col(n - 1);

function readExistingRows() {
  if (!fs.existsSync(outPath)) return null;
  const workbook = XLSX.readFile(outPath, { cellDates: true });
  const sheet = workbook.Sheets['Policies'] || workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows.length > 0 ? rows : null;
}

const EXAMPLE_ROW = {
  State: 'Texas',
  EffectiveDate: '07/22/2026',
  LineOfBusiness: 'Mechanical Breakdown Insurance',
  FirstName: 'Ravi',
  LastName: 'Kishan',
  AddressLine1: '1 Infinite Loop',
  City: 'Cupertino',
  MailingState: 'CA',
  Zip: '95014',
  Email: 'test.ravi.kishan@test.com',
  Phone: '5551234567',
  VehicleRatingClass: 'Affinity Auto',
  VehicleYear: '2026',
  VehicleMake: 'Honda',
  VehicleModel: 'Accord',
  Odometer: '',
  Transmission: 'Automatic',
  FuelType: 'Gasoline',
  EngineLocation: '',
  Deductible: '250',
  PayPlan: 'Quarterly Pay Direct',
  PaymentType: 'Check',
  CheckNumber: '21569',
  CardNumber: '',
  ACHRoutingNumber: '',
  ACHAccountNumber: '',
};

// Older files had separate VehicleCategory/VehicleRatingClass columns; merges them into the
// single VehicleRatingClass column ("Affinity Auto" had no rating class of its own back then, so
// falls back to whatever VehicleCategory said). Already-merged rows pass through unchanged.
function migrateRow(row) {
  if (!('VehicleCategory' in row)) return row;
  const { VehicleCategory, ...rest } = row;
  return { ...rest, VehicleRatingClass: rest.VehicleRatingClass || VehicleCategory };
}

async function main() {
  const existingRows = readExistingRows();
  const dataRows = (existingRows || [EXAMPLE_ROW]).map(migrateRow);

  const workbook = new ExcelJS.Workbook();

  // "Policies" must be added before "Lists" so it stays SheetNames[0] - readPolicyRows() (and
  // XLSX.readFile elsewhere) reads workbook.Sheets[workbook.SheetNames[0]] unconditionally.
  const sheet = workbook.addWorksheet('Policies');

  // --- Hidden "Lists" sheet: every dropdown's source range/named range lives here. ---
  const lists = workbook.addWorksheet('Lists', { state: 'hidden' });

  // Auto-incrementing column allocator, since the number of make/model helper columns depends on
  // how many categories and makes are in VEHICLE_DATA above.
  let nextCol = 1;
  function writeColumn(header, values) {
    const col = colLetter(nextCol++);
    lists.getCell(`${col}1`).value = header;
    values.forEach((v, i) => {
      lists.getCell(`${col}${i + 2}`).value = v;
    });
    return `Lists!$${col}$2:$${col}$${values.length + 1}`;
  }

  const stateRange = writeColumn('States', STATES.map((s) => s[0]));
  const stateAbbrRange = writeColumn('StateAbbr', STATES.map((s) => s[1]));
  const lobRange = writeColumn('LineOfBusiness', LINE_OF_BUSINESS);
  const ratingClassRange = writeColumn('VehicleRatingClass', VEHICLE_RATING_CLASSES.map((r) => r[0]));
  const transmissionRange = writeColumn('Transmission', TRANSMISSIONS);
  const fuelTypeRange = writeColumn('FuelType', FUEL_TYPES);
  const engineLocationRange = writeColumn('EngineLocation', ENGINE_LOCATIONS);
  const deductibleRange = writeColumn('Deductible', DEDUCTIBLES);
  const payPlanRange = writeColumn('PayPlan', PAY_PLANS);
  const paymentTypeRange = writeColumn('PaymentType', PAYMENT_TYPES);
  const yearRange = writeColumn('VehicleYear', YEARS);

  // One column per rating class, holding just that class's makes; named range keyed by the
  // sanitized rating class name (e.g. "Motorhome_Class_A") - the Make column's INDIRECT() formula
  // resolves this per row directly from that row's VehicleRatingClass cell. Rating class, not
  // category, because although the Make list happens to be shared within a category, the Model
  // list per make is not (see file header comment) - keying everything by rating class from the
  // start keeps Make and Model consistent with each other.
  for (const [ratingClass] of VEHICLE_RATING_CLASSES) {
    const makes = Object.keys(VEHICLE_DATA[ratingClass] ?? {});
    const range = writeColumn(`${ratingClass} Makes`, makes);
    workbook.definedNames.add(range, sanitizeName(ratingClass));
  }

  // One column per (rating class, make) pair, holding just that pair's models; named range keyed
  // by sanitized "RatingClass_Make" together. The Model column's INDIRECT() formula resolves this
  // per row from that row's VehicleRatingClass *and* Make cells.
  for (const [ratingClass] of VEHICLE_RATING_CLASSES) {
    for (const [make, models] of Object.entries(VEHICLE_DATA[ratingClass] ?? {})) {
      const range = writeColumn(`${ratingClass} ${make} Models`, models);
      workbook.definedNames.add(range, `${sanitizeName(ratingClass)}_${sanitizeName(make)}`);
    }
  }

  // --- "Policies" sheet (created above): the data CreatePolicies.spec.ts actually reads. ---
  sheet.columns = HEADERS.map((header) => ({ header, key: header, width: Math.max(header.length + 2, 14) }));

  const colIndex = (name) => HEADERS.indexOf(name) + 1;

  // ABA routing numbers are always 9 digits and commonly start with 0 (e.g. "021000021"). Without
  // this, typing a leading-zero value into a plain General-formatted cell makes Excel silently
  // store it as the number 21000021 - Text format keeps whatever digits are typed intact.
  // ACHAccountNumber gets the same treatment since it's the same kind of free-form digit string.
  sheet.getColumn(colIndex('ACHRoutingNumber')).numFmt = '@';
  sheet.getColumn(colIndex('ACHAccountNumber')).numFmt = '@';

  dataRows.forEach((row) => sheet.addRow(row));

  const lastRow = Math.max(dataRows.length + 1, 200);

  // One data validation entry covering the whole column range, rather than one per cell - setting
  // dataValidation per-cell (even with an identical rule) makes ExcelJS emit separate, overlapping
  // <dataValidation> sqref entries instead of a single merged range, which some Excel versions flag
  // as a "we found a problem with some content" repair prompt on open.
  function applyListValidation(columnName, formula) {
    const col = colLetter(colIndex(columnName));
    sheet.dataValidations.add(`${col}2:${col}${lastRow}`, {
      type: 'list',
      allowBlank: true,
      showErrorMessage: false,
      formulae: [formula],
    });
  }

  // Blocks entry outright (errorStyle 'stop') unless the value is exactly `digits` digits and
  // nothing else - unlike applyListValidation above, these fields have no fixed set of valid
  // values to pick from, so there's nothing to allow typing over.
  function applyExactDigitsValidation(columnName, digits) {
    const col = colLetter(colIndex(columnName));
    const topCell = `${col}2`;
    sheet.dataValidations.add(`${col}2:${col}${lastRow}`, {
      type: 'custom',
      allowBlank: true,
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Invalid entry',
      error: `Enter exactly ${digits} digits, numbers only.`,
      formulae: [`AND(LEN(${topCell})=${digits},ISNUMBER(VALUE(${topCell})))`],
    });
  }

  applyListValidation('State', stateRange);
  applyListValidation('LineOfBusiness', lobRange);
  applyListValidation('MailingState', stateAbbrRange);
  applyListValidation('VehicleRatingClass', ratingClassRange);
  applyListValidation('VehicleYear', yearRange);
  applyListValidation('Transmission', transmissionRange);
  applyListValidation('FuelType', fuelTypeRange);
  applyListValidation('EngineLocation', engineLocationRange);
  applyListValidation('Deductible', deductibleRange);
  applyListValidation('PayPlan', payPlanRange);
  applyListValidation('PaymentType', paymentTypeRange);
  applyExactDigitsValidation('Phone', 10);
  applyExactDigitsValidation('CardNumber', 16);
  applyExactDigitsValidation('ACHRoutingNumber', 9);

  // VehicleMake depends on VehicleRatingClass directly, and VehicleModel depends on
  // VehicleRatingClass *and* VehicleMake together (see the named-range comment above) - so unlike
  // the uniform columns above, both need their own formula per row. One dataValidation entry per
  // single-cell address; still safe since none of these addresses overlap.
  const ratingClassCol = colLetter(colIndex('VehicleRatingClass'));
  const makeColLetter = colLetter(colIndex('VehicleMake'));
  const modelColLetter = colLetter(colIndex('VehicleModel'));
  for (let r = 2; r <= lastRow; r++) {
    const ratingClassCell = `$${ratingClassCol}${r}`;
    sheet.dataValidations.add(`${makeColLetter}${r}`, {
      type: 'list',
      allowBlank: true,
      showErrorMessage: false,
      formulae: [`INDIRECT(${sanitizeFormula(ratingClassCell)})`],
    });
    sheet.dataValidations.add(`${modelColLetter}${r}`, {
      type: 'list',
      allowBlank: true,
      showErrorMessage: false,
      formulae: [
        `INDIRECT(${sanitizeFormula(ratingClassCell)}&"_"&${sanitizeFormula(`$${makeColLetter}${r}`)})`,
      ],
    });
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await workbook.xlsx.writeFile(outPath);
  console.log(
    existingRows
      ? `Rebuilt with dropdowns, keeping ${existingRows.length} existing row(s): ${outPath}`
      : `Created template: ${outPath}`
  );
}

main();
