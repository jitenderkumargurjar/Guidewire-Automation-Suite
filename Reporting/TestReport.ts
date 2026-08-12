import fs from 'fs';
import path from 'path';

export interface StepResult {
  name: string;
  status: 'passed' | 'failed';
  durationMs: number;
  detail?: string;
  error?: string;
  // Name of the step that started the current failure streak, set only on steps that failed
  // immediately after another failure (not on the first/root failure itself). Lets the report
  // distinguish "this step is why the rest fell over" from "this one just happened to fail too".
  causedByStep?: string;
}

export interface ReportConfig {
  state: string;
  effectiveDate?: string;
  lineOfBusiness: string;
  customerFirstName: string;
  customerLastName: string;
  mailingAddress: string;
  email: string;
  phone: string;
  vehicleCategory: string;
  vehicleRatingClass?: string;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  deductible: string;
  payPlan: string;
  paymentType: string;
  checkNumber?: string;
}

export interface ReportResult {
  quoteNumber?: string;
  applicationNumber?: string;
  policyNumber?: string;
  odometer?: string;
  // True when this row's Payment Type needed the in-browser manual pause (Credit Card/ACH aren't
  // scripted). The card/bank details entered are intentionally never captured or shown here.
  paymentEnteredManually?: boolean;
}

export interface ReportData {
  testName: string;
  startedAt: Date;
  finishedAt: Date;
  overallStatus: 'passed' | 'failed';
  failureMessage?: string;
  config: ReportConfig;
  result: ReportResult;
  steps: StepResult[];
  screenshotBase64?: string;
  environment: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

function keyValueRows(rows: [string, string | undefined][]): string {
  return rows
    .filter(([, v]) => v !== undefined && v !== '')
    .map(
      ([k, v]) => `
      <div class="cfg-row">
        <span class="k">${escapeHtml(k)}</span>
        <span class="v mono">${escapeHtml(v!)}</span>
      </div>`
    )
    .join('');
}

function configRows(config: ReportConfig, result: ReportResult): string {
  return keyValueRows([
    ['State', config.state],
    ['Effective Date', config.effectiveDate],
    ['Line of Business', config.lineOfBusiness],
    ['Customer Name', `${config.customerFirstName} ${config.customerLastName}`],
    ['Mailing Address', config.mailingAddress],
    ['Email', config.email],
    ['Phone', config.phone],
    ['Vehicle Category', config.vehicleCategory],
    ['Vehicle Rating Class', config.vehicleRatingClass],
    ['Vehicle Year/Make/Model', `${config.vehicleYear} ${config.vehicleMake} ${config.vehicleModel}`],
    ['Odometer', result.odometer],
    ['Deductible', `$${config.deductible}`],
    ['Pay Plan', config.payPlan],
    [
      'Payment Type',
      result.paymentEnteredManually ? `${config.paymentType} (entered manually in-browser)` : config.paymentType,
    ],
    ['Check Number', config.paymentType === 'Check' ? config.checkNumber : undefined],
  ]);
}

function chainHtml(result: ReportResult): string {
  const nodes: [string, string | undefined][] = [
    ['Quote', result.quoteNumber],
    ['Application', result.applicationNumber],
    ['Policy issued', result.policyNumber],
  ];
  const present = nodes.filter(([, v]) => !!v);
  if (present.length === 0) return '';
  return present
    .map(([label, num], i) => {
      const arrow = i < present.length - 1 ? '<span class="chain-arrow">&#8594;</span>' : '';
      return `
      <div class="chain-node">
        <span class="label">${escapeHtml(label)}</span>
        <span class="num mono">${escapeHtml(num!)}</span>
      </div>${arrow}`;
    })
    .join('');
}

function stepsHtml(steps: StepResult[]): string {
  return steps
    .map((s, i) => {
      const idx = String(i + 1).padStart(2, '0');
      const pillClass = s.status === 'passed' ? 'pill-pass' : 'pill-fail';
      const pillLabel = s.status === 'passed' ? 'Passed' : 'Failed';
      const detailLine = s.error
        ? `<p class="err">${escapeHtml(s.error)}</p>`
        : s.detail
          ? `<p>${escapeHtml(s.detail)}</p>`
          : '';
      const downstreamLine = s.causedByStep
        ? `<p class="downstream">&#8618; Downstream of the earlier failure in &ldquo;${escapeHtml(s.causedByStep)}&rdquo;.</p>`
        : '';
      return `
      <div class="step ${s.status === 'failed' ? 'step-fail' : ''}">
        <span class="idx mono">${idx}</span>
        <div class="body">
          <h3>${escapeHtml(s.name)}</h3>
          ${detailLine}
          ${downstreamLine}
        </div>
        <span class="pill ${pillClass}">${pillLabel}</span>
        <span class="dur mono">${formatDuration(s.durationMs)}</span>
      </div>`;
    })
    .join('');
}

// Groups the run's failures into "root" failures (the first in a streak) and however many
// steps then failed as a direct consequence, so the report says why the rest fell over instead
// of just listing a wall of red rows.
function failureSummaryHtml(steps: StepResult[]): string {
  const rootFailures = steps.filter((s) => s.status === 'failed' && !s.causedByStep);
  if (rootFailures.length === 0) return '';

  return rootFailures
    .map((root) => {
      const cascadeCount = steps.filter((s) => s.causedByStep === root.name).length;
      const cascadeNote =
        cascadeCount > 0
          ? ` ${cascadeCount} later step${cascadeCount === 1 ? '' : 's'} then failed as a downstream consequence and can likely be ignored once this one's fixed.`
          : ' The run kept going and no later step was affected by it.';
      return `
      <div class="failure-callout">
        <span class="failure-callout-title">Root cause: ${escapeHtml(root.name)}</span>
        <p>${escapeHtml(root.error ?? 'No error message was captured.')}</p>
        <p class="failure-callout-note">${cascadeNote}</p>
      </div>`;
    })
    .join('');
}

// A donut (ringed pie) of passed vs failed steps. The center readout carries the headline number
// (pass rate) so the reader isn't left estimating angles, and both segments are backed by a
// legend with exact counts - color is never the only channel here.
function donutChartSvg(passed: number, failed: number): string {
  const total = passed + failed;
  const size = 168;
  const strokeWidth = 24;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const passedFrac = total > 0 ? passed / total : 0;
  const hasBoth = passed > 0 && failed > 0;
  const gap = hasBoth ? 5 : 0;

  const passedLen = Math.max(circumference * passedFrac - (hasBoth ? gap / 2 : 0), 0);
  const failedLen = Math.max(circumference - circumference * passedFrac - (hasBoth ? gap / 2 : 0), 0);
  const failedOffset = -(passedLen + gap);
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const passedArc =
    passedLen > 0
      ? `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="var(--good)" stroke-width="${strokeWidth}"
          stroke-dasharray="${passedLen} ${circumference}" stroke-linecap="round"
          transform="rotate(-90 ${center} ${center})" />`
      : '';
  const failedArc =
    failedLen > 0
      ? `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="var(--critical)" stroke-width="${strokeWidth}"
          stroke-dasharray="${failedLen} ${circumference}" stroke-dashoffset="${failedOffset}" stroke-linecap="round"
          transform="rotate(-90 ${center} ${center})" />`
      : '';

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${passed} of ${total} steps passed (${passRate}%)">
      <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="var(--rule)" stroke-width="${strokeWidth}" />
      ${passedArc}
      ${failedArc}
      <text x="${center}" y="${center - 5}" text-anchor="middle" class="donut-figure">${passRate}%</text>
      <text x="${center}" y="${center + 17}" text-anchor="middle" class="donut-caption">passed</text>
    </svg>`;
}

function summarySectionHtml(steps: StepResult[], totalDuration: number, overallStatus: 'passed' | 'failed'): string {
  const passedCount = steps.filter((s) => s.status === 'passed').length;
  const failedCount = steps.filter((s) => s.status === 'failed').length;
  const outcomeClass = overallStatus === 'passed' ? 'good' : 'critical';

  return `
  <section class="summary-card">
    <div class="donut-wrap">${donutChartSvg(passedCount, failedCount)}</div>
    <div class="summary-legend">
      <div class="legend-row"><span class="dot dot-good"></span><span class="legend-label">Passed</span><span class="legend-count mono">${passedCount}</span></div>
      <div class="legend-row"><span class="dot dot-critical"></span><span class="legend-label">Failed</span><span class="legend-count mono">${failedCount}</span></div>
    </div>
    <div class="stat-tiles">
      <div class="stat-tile">
        <span class="stat-label">Total steps</span>
        <span class="stat-value mono">${steps.length}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-label">Duration</span>
        <span class="stat-value mono">${formatDuration(totalDuration)}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-label">Outcome</span>
        <span class="stat-value stat-${outcomeClass}">${overallStatus === 'passed' ? 'Passed' : 'Failed'}</span>
      </div>
    </div>
  </section>`;
}

export function renderReportHtml(data: ReportData): string {
  const totalDuration = data.finishedAt.getTime() - data.startedAt.getTime();
  const passedCount = data.steps.filter((s) => s.status === 'passed').length;
  const failedCount = data.steps.filter((s) => s.status === 'failed').length;
  const outcomeClass = data.overallStatus === 'passed' ? 'good' : 'critical';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.testName)} — Test Report</title>
<style>
  :root {
    color-scheme: light;
    --page: #f9f9f7; --surface: #ffffff; --ink: #0b0b0b; --ink-soft: #52514e; --ink-faint: #898781;
    --rule: #e1e0d9; --border: rgba(11,11,11,0.10);
    --accent: #2a78d6; --accent-soft: rgba(42,120,214,0.10);
    --good: #0ca30c; --good-soft: rgba(12,163,12,0.10);
    --critical: #d03b3b; --critical-soft: rgba(208,59,59,0.10);
    --shadow: 0 1px 2px rgba(11,11,11,0.04), 0 8px 24px rgba(11,11,11,0.06);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--page); color: var(--ink);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.55;
  }
  .mono { font-family: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace; font-variant-numeric: tabular-nums; }
  h1, h2, h3 { font-family: inherit; margin: 0; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 48px 24px 80px; }

  header { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); padding: 24px 26px; position: relative; overflow: hidden; }
  header::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, var(--accent), var(--good)); }
  .eyebrow { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-faint); font-weight: 600; margin-bottom: 8px; }
  h1.title { font-size: 25px; font-weight: 700; }
  .meta-row { display: flex; flex-wrap: wrap; gap: 8px 28px; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--rule); font-size: 13px; }
  .meta-row div { display: flex; flex-direction: column; gap: 2px; }
  .meta-row .k { color: var(--ink-faint); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
  .meta-row .v { font-weight: 600; }
  .status-badge { font-weight: 700; }
  .status-badge.good { color: var(--good); }
  .status-badge.critical { color: var(--critical); }

  .chain { display: flex; align-items: center; gap: 0; margin: 20px 0; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); padding: 18px 18px; flex-wrap: wrap; }
  .chain-node { display: flex; flex-direction: column; gap: 3px; padding: 0 16px; }
  .chain-node .label { font-size: 10.5px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-faint); }
  .chain-node .num { font-size: 16px; font-weight: 700; }
  .chain-arrow { color: var(--accent); font-size: 18px; padding: 0 4px; }

  section { margin-bottom: 32px; }
  h2.section-title { font-size: 17px; font-weight: 700; margin-bottom: 14px; }

  .summary-card {
    display: flex; align-items: center; gap: 32px; flex-wrap: wrap;
    background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    padding: 24px 28px; margin: 20px 0 32px;
  }
  .donut-wrap { flex: 0 0 auto; }
  .donut-figure { font-size: 26px; font-weight: 700; fill: var(--ink); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .donut-caption { font-size: 11px; fill: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.06em; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }

  .summary-legend { display: flex; flex-direction: column; gap: 10px; flex: 0 0 auto; }
  .legend-row { display: flex; align-items: center; gap: 9px; font-size: 13.5px; }
  .legend-label { color: var(--ink-soft); min-width: 52px; }
  .legend-count { font-weight: 700; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }
  .dot-good { background: var(--good); }
  .dot-critical { background: var(--critical); }

  .stat-tiles { display: flex; gap: 22px; margin-left: auto; flex-wrap: wrap; }
  .stat-tile { display: flex; flex-direction: column; gap: 4px; min-width: 90px; }
  .stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint); }
  .stat-value { font-size: 22px; font-weight: 700; }
  .stat-value.stat-good { color: var(--good); }
  .stat-value.stat-critical { color: var(--critical); }

  .config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); padding: 16px 20px; }
  .cfg-row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--rule); font-size: 13px; }
  .cfg-row:last-child, .cfg-row:nth-last-child(2) { border-bottom: none; }
  .cfg-row .k { color: var(--ink-faint); }
  .cfg-row .v { font-weight: 600; text-align: right; }

  .failure-callout { background: var(--critical-soft); border: 1px solid var(--critical); border-radius: 12px; padding: 14px 18px; margin-bottom: 12px; }
  .failure-callout:last-child { margin-bottom: 0; }
  .failure-callout-title { display: block; font-weight: 700; color: var(--critical); font-size: 13.5px; margin-bottom: 4px; }
  .failure-callout p { margin: 2px 0 0; font-size: 13px; color: var(--ink); }
  .failure-callout p.failure-callout-note { color: var(--ink-soft); font-style: italic; }

  .ledger { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden; }
  .step { display: grid; grid-template-columns: 26px 1fr auto 60px; gap: 14px; align-items: start; padding: 14px 18px; border-bottom: 1px solid var(--rule); }
  .step:last-child { border-bottom: none; }
  .step-fail { background: var(--critical-soft); }
  .step .idx { color: var(--ink-faint); font-size: 12.5px; padding-top: 2px; }
  .step .body h3 { font-size: 14.5px; font-weight: 600; }
  .step .body p { margin: 4px 0 0; color: var(--ink-soft); font-size: 13px; max-width: 58ch; }
  .step .body p.err { color: var(--critical); font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; }
  .step .body p.downstream { color: var(--ink-faint); font-size: 12px; font-style: italic; }
  .pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 100px; font-size: 11.5px; font-weight: 600; white-space: nowrap; height: fit-content; }
  .pill-pass { background: var(--good-soft); color: var(--good); }
  .pill-pass::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--good); display: inline-block; }
  .pill-fail { background: var(--critical-soft); color: var(--critical); }
  .pill-fail::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--critical); display: inline-block; }
  .dur { font-size: 12.5px; color: var(--ink-faint); text-align: right; padding-top: 4px; }

  figure { margin: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; box-shadow: var(--shadow); }
  figure img { display: block; width: 100%; height: auto; }
  figcaption { padding: 10px 14px; font-size: 12.5px; color: var(--ink-soft); }

  footer { margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--rule); font-size: 12px; color: var(--ink-faint); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }

  @media (max-width: 640px) {
    .config-grid { grid-template-columns: 1fr; }
    .step { grid-template-columns: 20px 1fr; }
    .dur, .pill { grid-column: 2; justify-self: start; }
    .summary-card { flex-direction: column; align-items: flex-start; }
    .stat-tiles { margin-left: 0; }
  }
</style>
</head>
<body>
<div class="wrap">

  <header>
    <div class="eyebrow">Playwright · Guidewire InsuranceNow</div>
    <h1 class="title">${escapeHtml(data.testName)}</h1>
    <div class="meta-row">
      <div><span class="k">Environment</span><span class="v mono">${escapeHtml(data.environment)}</span></div>
      <div><span class="k">Run at</span><span class="v mono">${data.startedAt.toLocaleString()}</span></div>
      <div><span class="k">Duration</span><span class="v mono">${formatDuration(totalDuration)}</span></div>
      <div><span class="k">Outcome</span><span class="v status-badge ${outcomeClass}">${passedCount} passed${failedCount ? `, ${failedCount} failed` : ''}</span></div>
    </div>
  </header>

  ${chainHtml(data.result) ? `<div class="chain">${chainHtml(data.result)}</div>` : ''}

  ${summarySectionHtml(data.steps, totalDuration, data.overallStatus)}

  ${
    failureSummaryHtml(data.steps)
      ? `<section>
    <h2 class="section-title">What went wrong</h2>
    ${failureSummaryHtml(data.steps)}
  </section>`
      : ''
  }

  <section>
    <h2 class="section-title">Configuration used</h2>
    <div class="config-grid">${configRows(data.config, data.result)}</div>
  </section>

  <section>
    <h2 class="section-title">Step-by-step result</h2>
    <div class="ledger">${stepsHtml(data.steps)}</div>
  </section>

  ${
    data.screenshotBase64
      ? `<section>
    <h2 class="section-title">Final state</h2>
    <figure>
      <img src="data:image/png;base64,${data.screenshotBase64}" alt="Final page state" />
      <figcaption>Screenshot captured at the end of the run.</figcaption>
    </figure>
  </section>`
      : ''
  }

  <footer>
    <span>Generated automatically after this run.</span>
    <span class="mono">${passedCount} passed &middot; ${failedCount} failed &middot; ${formatDuration(totalDuration)}</span>
  </footer>

</div>
</body>
</html>`;
}

export function writeReport(data: ReportData, outDir: string, fileName: string): { reportPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const html = renderReportHtml(data);
  const reportPath = path.join(outDir, fileName);
  fs.writeFileSync(reportPath, html, 'utf-8');
  return { reportPath };
}
