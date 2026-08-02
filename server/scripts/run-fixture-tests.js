/**
 * Runs every fixture in test-fixtures/ through the real parseTemplate +
 * validateTemplate pipeline and asserts each one produced exactly the finding
 * its name promises, in the section it belongs to, with every other layer clean.
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

function errorsIn(report, section) {
  return (report.sections[section] || []).filter((m) => m.severity === 'Error');
}

function warningsIn(report, section) {
  return (report.sections[section] || []).filter((m) => m.severity === 'Warning');
}

/**
 * Each assertion: which section must contain an Error/Warning matching `match`,
 * and which sections must otherwise stay clean (checked automatically — every
 * section not named here must have zero Errors and zero Warnings, aside from
 * "downstream", which legitimately errors any time the object has any error).
 */
const EXPECTATIONS = {
  '00-clean-baseline.xml': (report) => {
    assertEqual(report.summary.errors, 0, 'expected zero errors');
    assertEqual(report.summary.migrationReady, true, 'expected migrationReady: true');
  },
  '01-prereq-wrong-format.xlsx': (report) => {
    assertSectionHas(report, 'prerequisites', 'Error', /not saved as "XML Spreadsheet 2003/);
  },
  '02-unknown-migration-object.xml': (report) => {
    assertSectionHas(report, 'migrationObject', 'Warning', /was not found among the/);
  },
  '03-structure-missing-sheet.xml': (report) => {
    assertSectionHas(report, 'structure', 'Error', /'Plant Data' is listed in the Field List but missing/);
  },
  '04-structure-rogue-sheet.xml': (report) => {
    assertSectionHas(report, 'structure', 'Error', /'Rogue Sheet' exists in the workbook but is not listed/);
  },
  '05-structure-typespec-blanked.xml': (report) => {
    assertSectionHas(report, 'structure', 'Error', /Hidden row 6 .* is missing on sheet 'Basic Data'/);
  },
  '06-structure-row-unhidden.xml': (report) => {
    assertSectionHas(report, 'structure', 'Warning', /Row 4 on sheet 'Basic Data' is no longer hidden/);
  },
  '07-structure-header-altered.xml': (report) => {
    assertSectionHas(report, 'structure', 'Error', /'Description'.*row-8 header is missing or altered/);
  },
  '08-structure-formula-cell.xml': (report) => {
    assertSectionHas(report, 'structure', 'Error', /Formula detected on sheet 'Basic Data' row 9/);
  },
  '09-mandatory-missing.xml': (report) => {
    assertSectionHas(report, 'mandatory', 'Error', /mandatory field 'Description' is empty/);
  },
  '10-referential-orphan-fk.xml': (report) => {
    assertSectionHas(report, 'referential', 'Error', /'NONEXISTENT-999'.*not found in main sheet/);
  },
  '11-referential-missing-fk.xml': (report) => {
    assertSectionHas(report, 'referential', 'Error', /Foreign key 'Product Number' is missing on active row/);
  },
  '12-referential-duplicate-pk.xml': (report) => {
    assertSectionHas(report, 'referential', 'Error', /Duplicate primary key/);
  },
  '13-type-text-overflow.xml': (report) => {
    assertSectionHas(report, 'types', 'Error', /exceeds declared length 40/);
  },
  // Pinned to the absolute-cap wording, including the threshold itself, so raising
  // MAX_DECIMALS cannot be masked by the declared-decimals rule firing instead.
  '14-type-decimal-overflow.xml': (report) => {
    assertSectionHas(report, 'types', 'Error', /More than 3 decimal places is not supported/);
  },
  '14b-type-decimals-exceed-declared.xml': (report) => {
    assertSectionHas(report, 'types', 'Error', /has 2 decimal places but the template declares 0/);
  },
  '14c-type-not-a-number.xml': (report) => {
    assertSectionHas(report, 'types', 'Error', /must be a number but contains 'heavy'/);
  },
  '15-type-invalid-date.xml': (report) => {
    assertSectionHas(report, 'types', 'Error', /not a valid date/);
  },
  '16-mapping-inconsistent-variants.xml': (report) => {
    assertSectionHas(report, 'mapping', 'Warning', /inconsistent source variants/);
  },
};

let failures = 0;

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg} (got ${JSON.stringify(actual)})`);
}

function assertSectionHas(report, section, severity, pattern) {
  const msgs = (report.sections[section] || []).filter((m) => m.severity === severity);
  const hit = msgs.find((m) => pattern.test(m.message));
  if (!hit) {
    const seen = msgs.map((m) => m.message).join('\n  ');
    throw new Error(`section '${section}' has no ${severity} matching ${pattern}\nfound:\n  ${seen || '(none)'}`);
  }
}

function checkIsolation(report, fixtureFile) {
  // For every section other than the ones this fixture intentionally breaks,
  // and other than "downstream" (which cascades from ANY error), nothing else
  // should have fired. This catches cross-contamination between fixtures.
  const problems = [];
  for (const section of OTHER_SECTIONS) {
    const errs = errorsIn(report, section);
    const warns = warningsIn(report, section);
    if ((errs.length > 0 || warns.length > 0) && !EXPECTATIONS_TOUCH[fixtureFile].has(section)) {
      problems.push(`${section}: ${[...errs, ...warns].map((m) => m.message).join(' | ')}`);
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
  const files = ['00-clean-baseline.xml', ...manifest.map((m) => m.file).filter((f) => f !== '00-clean-baseline.xml')];

  for (const file of files) {
    const buf = fs.readFileSync(path.join(dir, file));
    let report;
    try {
      const template = await parseTemplate(buf, file);
      report = validateTemplate(template, buf.length);
    } catch (err) {
      console.log(`FAIL  ${file.padEnd(38)} threw: ${err.message}`);
      failures += 1;
      continue;
    }

    try {
      EXPECTATIONS[file](report);
      const isolationProblems = file === '00-clean-baseline.xml' ? [] : checkIsolation(report, file);
      if (isolationProblems.length > 0) {
        throw new Error(`unexpected findings in other sections:\n  ${isolationProblems.join('\n  ')}`);
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
