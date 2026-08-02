/**
 * Runs every fixture in test-fixtures/ through the real parseTemplate +
 * validateTemplate pipeline and asserts each one produced exactly the finding
 * its name promises, in the section it belongs to, and nothing else.
 *
 * Isolation is measured as a delta against the clean baseline rather than against
 * zero. The source template is real and evolves, so it carries its own findings
 * (today: value-mapping variants like 'CK72012' vs 'CK-72012'). Comparing to the
 * baseline means those stay out of the way without being suppressed, and the suite
 * keeps working when the source data changes.
 *
 * Usage: node scripts/run-fixture-tests.js <fixtures-dir>
 */
const fs = require('fs');
const path = require('path');
const { parseTemplate } = require('../src/templateParser');
const { validateTemplate } = require('../src/cockpitValidator');

const OTHER_SECTIONS = [
  'prerequisites', 'migrationObject', 'structure', 'mandatory',
  'referential', 'types', 'mapping', 'checkTables',
];

/** Stable identity for a finding, so baseline noise can be subtracted. */
function signature(section, m) {
  return `${section}|${m.severity}|${m.sheet || ''}|${m.row || ''}|${m.message}`;
}

function signatureSet(report) {
  const set = new Set();
  for (const [section, msgs] of Object.entries(report.sections)) {
    for (const m of msgs) {
      if (m.severity === 'Error' || m.severity === 'Warning') set.add(signature(section, m));
    }
  }
  return set;
}

/** Findings present in this report but not in the baseline, grouped by section. */
function newFindings(report, baselineSigs) {
  const out = {};
  for (const [section, msgs] of Object.entries(report.sections)) {
    for (const m of msgs) {
      if (m.severity !== 'Error' && m.severity !== 'Warning') continue;
      if (baselineSigs.has(signature(section, m))) continue;
      (out[section] = out[section] || []).push(m);
    }
  }
  return out;
}

/**
 * Each expectation receives the full report plus `added` — the findings this fixture
 * introduced on top of the baseline. Assertions run against `added`, so a finding the
 * source file already produced can never stand in for the one being tested.
 */
const EXPECTATIONS = {
  '00-clean-baseline.xml': (report) => {
    assertEqual(report.summary.errors, 0, 'expected zero errors');
    assertEqual(report.summary.migrationReady, true, 'expected migrationReady: true');
  },
  '01-prereq-wrong-format.xlsx': (report, added) => {
    assertAdded(added, 'prerequisites', 'Error', /not saved as "XML Spreadsheet 2003/);
  },
  '02-unknown-migration-object.xml': (report, added) => {
    assertAdded(added, 'migrationObject', 'Warning', /was not found among the/);
  },
  '03-structure-missing-sheet.xml': (report, added) => {
    assertAdded(added, 'structure', 'Error', /'Plant Data' is listed in the Field List but missing/);
  },
  '04-structure-rogue-sheet.xml': (report, added) => {
    assertAdded(added, 'structure', 'Error', /'Rogue Sheet' exists in the workbook but is not listed/);
  },
  '05-structure-typespec-blanked.xml': (report, added) => {
    assertAdded(added, 'structure', 'Error', /Hidden row 6 .* is missing on sheet 'Basic Data'/);
  },
  '06-structure-row-unhidden.xml': (report, added) => {
    assertAdded(added, 'structure', 'Warning', /Row 4 on sheet 'Basic Data' is no longer hidden/);
  },
  '07-structure-header-altered.xml': (report, added) => {
    assertAdded(added, 'structure', 'Error', /'Description'.*row-8 header is missing or altered/);
  },
  '08-structure-formula-cell.xml': (report, added) => {
    assertAdded(added, 'structure', 'Error', /Formula detected on sheet 'Basic Data' row 9/);
  },
  '09-mandatory-missing.xml': (report, added) => {
    assertAdded(added, 'mandatory', 'Error', /mandatory field 'Description' is empty/);
  },
  '10-referential-orphan-fk.xml': (report, added) => {
    assertAdded(added, 'referential', 'Error', /'NONEXISTENT-999'.*not found in main sheet/);
  },
  '11-referential-missing-fk.xml': (report, added) => {
    assertAdded(added, 'referential', 'Error', /Foreign key 'Product Number' is missing on active row/);
  },
  '12-referential-duplicate-pk.xml': (report, added) => {
    assertAdded(added, 'referential', 'Error', /Duplicate primary key/);
  },
  '12b-duplicate-child-record.xml': (report, added) => {
    assertAdded(added, 'referential', 'Error', /Duplicate record in sheet 'Additional Descriptions'/);
  },
  // Negative case: sharing a foreign key is normal and must not be reported. Asserted
  // as "added nothing" rather than "zero errors", so it holds even if the source file
  // later grows a defect of its own.
  '12c-child-same-fk-not-duplicate.xml': (report, added) => {
    const introduced = Object.values(added).flat();
    assertEqual(introduced.length, 0,
      `reusing a foreign key must not raise anything new (got: ${introduced.map((m) => m.message).join(' | ')})`);
  },
  '13-type-text-overflow.xml': (report, added) => {
    assertAdded(added, 'types', 'Error', /exceeds declared length 40/);
  },
  // Pinned to the absolute-cap wording, including the threshold itself, so raising
  // MAX_DECIMALS cannot be masked by the declared-decimals rule firing instead.
  '14-type-decimal-overflow.xml': (report, added) => {
    assertAdded(added, 'types', 'Error', /More than 3 decimal places is not supported/);
  },
  '14b-type-decimals-exceed-declared.xml': (report, added) => {
    assertAdded(added, 'types', 'Error', /has 2 decimal places but the template declares 0/);
  },
  '14c-type-not-a-number.xml': (report, added) => {
    assertAdded(added, 'types', 'Error', /must be a number but contains 'heavy'/);
  },
  '15-type-invalid-date.xml': (report, added) => {
    assertAdded(added, 'types', 'Error', /not a valid date/);
  },
  '16-mapping-inconsistent-variants.xml': (report, added) => {
    assertAdded(added, 'mapping', 'Warning', /HAWA \/ hawa|hawa \/ HAWA/);
  },
};

let failures = 0;

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg} (got ${JSON.stringify(actual)})`);
}

/** Asserts the fixture *introduced* a matching finding, ignoring baseline noise. */
function assertAdded(added, section, severity, pattern) {
  const msgs = (added[section] || []).filter((m) => m.severity === severity);
  if (!msgs.some((m) => pattern.test(m.message))) {
    const seen = msgs.map((m) => m.message).join('\n  ');
    throw new Error(`no NEW ${severity} in '${section}' matching ${pattern}\nnew findings there:\n  ${seen || '(none)'}`);
  }
}

/**
 * Anything this fixture introduced beyond the baseline must live in a section the
 * fixture is declared to touch. "downstream" is exempt — it cascades from any error.
 */
function checkIsolation(report, fixtureFile, baselineSigs) {
  const added = newFindings(report, baselineSigs);
  const allowed = EXPECTATIONS_TOUCH[fixtureFile];
  const problems = [];

  for (const section of OTHER_SECTIONS) {
    const msgs = added[section];
    if (msgs && msgs.length > 0 && !allowed.has(section)) {
      problems.push(`${section}: ${msgs.map((m) => m.message).join(' | ')}`);
    }
  }
  return problems;
}

// Which section each fixture is allowed to have findings in (beyond its primary one).
const EXPECTATIONS_TOUCH = {
  '00-clean-baseline.xml': new Set(OTHER_SECTIONS),
  '01-prereq-wrong-format.xlsx': new Set(['prerequisites']),
  '02-unknown-migration-object.xml': new Set(['migrationObject']),
  '03-structure-missing-sheet.xml': new Set(['structure']),
  '04-structure-rogue-sheet.xml': new Set(['structure']),
  '05-structure-typespec-blanked.xml': new Set(['structure']),
  '06-structure-row-unhidden.xml': new Set(['structure']),
  '07-structure-header-altered.xml': new Set(['structure']),
  '08-structure-formula-cell.xml': new Set(['structure']),
  '09-mandatory-missing.xml': new Set(['mandatory']),
  '10-referential-orphan-fk.xml': new Set(['referential']),
  // A blank Product Number on an active child row is legitimately both a missing
  // mandatory field and an unresolvable foreign key, so both layers must fire.
  '11-referential-missing-fk.xml': new Set(['referential', 'mandatory']),
  '12-referential-duplicate-pk.xml': new Set(['referential']),
  '12b-duplicate-child-record.xml': new Set(['referential']),
  '12c-child-same-fk-not-duplicate.xml': new Set(OTHER_SECTIONS),
  '13-type-text-overflow.xml': new Set(['types']),
  '14-type-decimal-overflow.xml': new Set(['types']),
  '14b-type-decimals-exceed-declared.xml': new Set(['types']),
  '14c-type-not-a-number.xml': new Set(['types']),
  '15-type-invalid-date.xml': new Set(['types']),
  '16-mapping-inconsistent-variants.xml': new Set(['mapping']),
};

async function main() {
  const [, , dir] = process.argv;
  if (!dir) {
    console.error('Usage: node run-fixture-tests.js <fixtures-dir>');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
  const BASELINE = '00-clean-baseline.xml';
  const files = [BASELINE, ...manifest.map((m) => m.file).filter((f) => f !== BASELINE)];

  async function reportFor(file) {
    const buf = fs.readFileSync(path.join(dir, file));
    const template = await parseTemplate(buf, file);
    return validateTemplate(template, buf.length);
  }

  // The baseline's own findings are subtracted from every other fixture.
  const baselineReport = await reportFor(BASELINE);
  const baselineSigs = signatureSet(baselineReport);
  const carried = baselineSigs.size;
  if (carried > 0) {
    console.log(`baseline carries ${carried} pre-existing finding(s); these are subtracted from each fixture\n`);
  }

  for (const file of files) {
    let report;
    try {
      report = file === BASELINE ? baselineReport : await reportFor(file);
    } catch (err) {
      console.log(`FAIL  ${file.padEnd(38)} threw: ${err.message}`);
      failures += 1;
      continue;
    }

    try {
      const added = file === BASELINE ? {} : newFindings(report, baselineSigs);
      EXPECTATIONS[file](report, added);
      const isolationProblems = file === BASELINE ? [] : checkIsolation(report, file, baselineSigs);
      if (isolationProblems.length > 0) {
        throw new Error(`findings this fixture added outside its own layer:\n  ${isolationProblems.join('\n  ')}`);
      }
      console.log(`PASS  ${file.padEnd(38)} errors=${report.summary.errors} warnings=${report.summary.warnings}`);
    } catch (err) {
      console.log(`FAIL  ${file.padEnd(38)} ${err.message}`);
      failures += 1;
    }
  }

  console.log(`\n${files.length - failures}/${files.length} fixtures behaved as expected`);
  if (failures > 0) process.exit(1);
}

main();
