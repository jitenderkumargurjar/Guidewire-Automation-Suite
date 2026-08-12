// (Re)creates test-data/policies.xlsx with dropdowns for the columns CreatePolicies.spec.ts reads.
// Preserves whatever row(s) already exist in the current file (as data, not as a dropdown source);
// if the file doesn't exist yet, seeds it with one filled-in example row instead.
// Run with: npm run policies:template
//
// Dropdown sources for State/MailingState/VehicleMake/VehicleModel live on a hidden "Lists" sheet
// (Excel's inline list-validation formula has a ~255 character limit, too short for 50 states or
// 25+ vehicle makes). VehicleRatingClass -> VehicleMake -> VehicleModel is a three-level cascade,
// mirroring the real app's Vehicle tab (Pages/QuotePage.ts: VehicleCategory picks which "Add
// Vehicle Detail" form shows, and Make/Model are cascading selects fed by the resulting vehicle
// type - Affinity Auto's makes are passenger-car brands, Motorhome/Travel Trailer's are RV
// manufacturers, and each shows a different model list even where a manufacturer name is shared,
// e.g. Forest River builds both). There's a single VehicleRatingClass column rather than separate
// VehicleCategory/VehicleRatingClass columns, since VehicleCategory is really just "which of these
// 8 rating classes did you pick" - Utils/PolicyDataFile.ts's RATING_CLASS_TO_CATEGORY recovers the
// category from it at read time. Each make's model list is a named range, and each category's
// make list is also a named range; the Make/Model columns' validation formulas resolve the right
// named range per row via INDIRECT() against that row's VehicleRatingClass (and +Make) cells,
// using a lookup table (see ratingClassCategoryRange below) to map rating class -> category.
//
// Some lists are confirmed by other code/comments in this repo (PayPlan, VehicleRatingClass,
// PaymentType); others (VehicleMake/Model, Deductible, Transmission, FuelType, EngineLocation)
// are a best-effort convenience list, not a verified export of what this Guidewire instance
// actually rates - the live app may accept values outside these lists, or reject some inside them.
// Every dropdown here allows typing over it (showErrorMessage: false) for exactly that reason.
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
const VEHICLE_CATEGORIES = ['Affinity Auto', 'Motorhome', 'Travel Trailer'];
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

// Curated common makes/models per VehicleCategory, for convenience - not a verified export of
// what this Guidewire instance's rating engine actually offers (see file header comment).
// Affinity Auto = passenger-car brands; Motorhome/Travel Trailer = RV manufacturers. Some
// manufacturer names appear in more than one category (Forest River, Jayco, Coachmen all build
// both motorhomes and travel trailers) with a different model lineup each time - that's exactly
// why the Model dropdown's named range is keyed by Category+Make together, not by Make alone.
const VEHICLE_DATA = {
  'Affinity Auto': {
    Honda: ['Accord', 'Civic', 'CR-V', 'Pilot', 'Odyssey', 'HR-V', 'Passport', 'Ridgeline'],
    Toyota: ['Camry', 'Corolla', 'RAV4', 'Highlander', 'Tacoma', 'Tundra', 'Sienna', '4Runner'],
    Ford: ['F-150', 'Escape', 'Explorer', 'Mustang', 'Edge', 'Fusion', 'Focus', 'Expedition'],
    Chevrolet: ['Silverado', 'Equinox', 'Malibu', 'Traverse', 'Tahoe', 'Camaro', 'Impala', 'Suburban'],
    Nissan: ['Altima', 'Rogue', 'Sentra', 'Pathfinder', 'Murano', 'Maxima', 'Frontier', 'Titan'],
    Hyundai: ['Elantra', 'Sonata', 'Tucson', 'Santa Fe', 'Accent', 'Kona', 'Palisade', 'Venue'],
    Kia: ['Optima', 'Forte', 'Sportage', 'Sorento', 'Soul', 'Telluride', 'Rio', 'Seltos'],
    Jeep: ['Wrangler', 'Grand Cherokee', 'Cherokee', 'Compass', 'Renegade', 'Gladiator'],
    Ram: ['1500', '2500', '3500', 'ProMaster'],
    GMC: ['Sierra', 'Terrain', 'Acadia', 'Yukon', 'Canyon'],
    Subaru: ['Outback', 'Forester', 'Crosstrek', 'Impreza', 'Legacy', 'Ascent'],
    Volkswagen: ['Jetta', 'Passat', 'Tiguan', 'Atlas', 'Golf', 'Beetle'],
    BMW: ['3 Series', '5 Series', 'X3', 'X5', 'X1'],
    'Mercedes-Benz': ['C-Class', 'E-Class', 'GLC', 'GLE', 'S-Class'],
    Audi: ['A4', 'A6', 'Q5', 'Q7', 'A3'],
    Mazda: ['Mazda3', 'Mazda6', 'CX-5', 'CX-9', 'CX-30'],
    Dodge: ['Charger', 'Challenger', 'Durango', 'Journey'],
    Chrysler: ['300', 'Pacifica', 'Voyager'],
    Buick: ['Encore', 'Enclave', 'Envision', 'LaCrosse'],
    Cadillac: ['Escalade', 'XT5', 'CT5', 'XT4'],
    Lexus: ['RX', 'ES', 'NX', 'GX'],
    Acura: ['MDX', 'RDX', 'TLX', 'ILX'],
    Infiniti: ['QX60', 'Q50', 'QX80'],
    Lincoln: ['Navigator', 'Aviator', 'Corsair'],
    Volvo: ['XC90', 'XC60', 'S60'],
    Tesla: ['Model 3', 'Model Y', 'Model S', 'Model X'],
    Mitsubishi: ['Outlander', 'Eclipse Cross', 'Mirage'],
  },
  Motorhome: {
    Winnebago: ['View', 'Vista', 'Adventurer', 'Journey', 'Solis', 'Navion', 'Forza'],
    'Thor Motor Coach': ['Four Winds', 'Freedom Elite', 'Chateau', 'Ace', 'Axis', 'Windsport'],
    'Forest River': ['Forester', 'Sunseeker', 'FR3', 'Georgetown'],
    Jayco: ['Redhawk', 'Greyhawk', 'Alante', 'Precept'],
    Newmar: ['Bay Star', 'Ventana', 'Dutch Star', 'King Aire'],
    Tiffin: ['Allegro', 'Phaeton', 'Breeze', 'Wayfarer'],
    Fleetwood: ['Bounder', 'Discovery', 'Flair', 'Pace Arrow'],
    Coachmen: ['Leprechaun', 'Freelander', 'Mirada', 'Pursuit'],
    'Gulf Stream': ['Conquest', 'Independence', 'BT Cruiser'],
  },
  'Travel Trailer': {
    'Forest River': ['Rockwood', 'Wildwood', 'Salem', 'Cherokee', 'Flagstaff'],
    Jayco: ['Jay Flight', 'Eagle', 'White Hawk', 'Jay Feather'],
    Keystone: ['Passport', 'Bullet', 'Hideout', 'Springdale', 'Cougar'],
    'Grand Design': ['Imagine', 'Reflection', 'Transcend', 'Momentum'],
    Airstream: ['Bambi', 'Flying Cloud', 'International', 'Classic'],
    Coachmen: ['Catalina', 'Freedom Express', 'Apex', 'Spirit'],
    Heartland: ['Wilderness', 'Prowler', 'Mallard', 'North Trail'],
    Dutchmen: ['Aspen Trail', 'Coleman', 'Kodiak'],
    CrossRoads: ['Zinger', 'Sunset Trail', 'Volante'],
  },
};

// Excel defined names can't contain spaces or hyphens - matches the SUBSTITUTE() calls in the
// Make/Model columns' INDIRECT() formulas below, which sanitize cell values the same way.
function sanitizeName(name) {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

// Formula fragment that sanitizes a cell reference the same way sanitizeName() sanitizes a string
// - only spaces and hyphens appear in any of the category/make names above, so two SUBSTITUTEs
// covers it.
function sanitizeFormula(cellRef) {
  return `SUBSTITUTE(SUBSTITUTE(${cellRef}," ","_"),"-","_")`;
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

  // Two-column table: RatingClass value -> its sanitized Category key (e.g. "Travel Trailer" ->
  // "Travel_Trailer"). VLOOKUP against this (see the Make/Model formulas below) is how the
  // cascade recovers Category from the single VehicleRatingClass column.
  function writeLookupTable(header1, header2, pairs) {
    const col1 = colLetter(nextCol++);
    const col2 = colLetter(nextCol++);
    lists.getCell(`${col1}1`).value = header1;
    lists.getCell(`${col2}1`).value = header2;
    pairs.forEach(([a, b], i) => {
      lists.getCell(`${col1}${i + 2}`).value = a;
      lists.getCell(`${col2}${i + 2}`).value = b;
    });
    return `Lists!$${col1}$2:$${col2}$${pairs.length + 1}`;
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
  const ratingClassCategoryRange = writeLookupTable(
    'RatingClass',
    'CategoryKey',
    VEHICLE_RATING_CLASSES.map(([ratingClass, category]) => [ratingClass, sanitizeName(category)])
  );

  // One column per category, holding just that category's makes; named range keyed by the
  // sanitized category name (e.g. "Travel_Trailer") - the Make column's INDIRECT() formula
  // resolves this per row by first looking up the category for that row's VehicleRatingClass.
  for (const category of VEHICLE_CATEGORIES) {
    const makes = Object.keys(VEHICLE_DATA[category]);
    const range = writeColumn(`${category} Makes`, makes);
    workbook.definedNames.add(range, sanitizeName(category));
  }

  // One column per (category, make) pair, holding just that pair's models; named range keyed by
  // sanitized "Category_Make" together - not by make alone, since a make like Forest River builds
  // both motorhomes and travel trailers with a different model lineup each time. The Model
  // column's INDIRECT() formula resolves this per row from that row's Category *and* Make cells.
  for (const category of VEHICLE_CATEGORIES) {
    for (const [make, models] of Object.entries(VEHICLE_DATA[category])) {
      const range = writeColumn(`${category} ${make} Models`, models);
      workbook.definedNames.add(range, `${sanitizeName(category)}_${sanitizeName(make)}`);
    }
  }

  // --- "Policies" sheet (created above): the data CreatePolicies.spec.ts actually reads. ---
  sheet.columns = HEADERS.map((header) => ({ header, key: header, width: Math.max(header.length + 2, 14) }));
  dataRows.forEach((row) => sheet.addRow(row));

  const lastRow = Math.max(dataRows.length + 1, 200);
  const colIndex = (name) => HEADERS.indexOf(name) + 1;

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

  // VehicleMake depends on VehicleRatingClass (via the RatingClass -> CategoryKey lookup table),
  // and VehicleModel depends on VehicleRatingClass *and* VehicleMake together (see the named-range
  // comment above) - so unlike the uniform columns above, both need their own formula per row. One
  // dataValidation entry per single-cell address; still safe since none of these addresses overlap.
  const ratingClassCol = colLetter(colIndex('VehicleRatingClass'));
  const makeColLetter = colLetter(colIndex('VehicleMake'));
  const modelColLetter = colLetter(colIndex('VehicleModel'));
  const categoryKeyLookup = (cellRef) => `VLOOKUP(${cellRef},${ratingClassCategoryRange},2,FALSE)`;
  for (let r = 2; r <= lastRow; r++) {
    const ratingClassCell = `$${ratingClassCol}${r}`;
    sheet.dataValidations.add(`${makeColLetter}${r}`, {
      type: 'list',
      allowBlank: true,
      showErrorMessage: false,
      formulae: [`INDIRECT(${categoryKeyLookup(ratingClassCell)})`],
    });
    sheet.dataValidations.add(`${modelColLetter}${r}`, {
      type: 'list',
      allowBlank: true,
      showErrorMessage: false,
      formulae: [
        `INDIRECT(${categoryKeyLookup(ratingClassCell)}&"_"&${sanitizeFormula(`$${makeColLetter}${r}`)})`,
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
