const { isBlank, asString, cellText, stripMandatorySuffix, FIELD_LIST_SHEET } = require('./templateParser');
const catalog = require('./stagingObjectCatalog');
const dependencies = require('./objectDependencies.json');

const SEVERITY = { ERROR: 'Error', WARNING: 'Warning', INFO: 'Information', SUCCESS: 'Success' };

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const EXCEL_MAX_DIGITS = 15;
const MAX_DECIMALS = 3;
const MAPPABLE_TEXT_LENGTH = 80;

function columnLetter(index) {
  let n = index;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

class Report {
  constructor() {
    this.sections = {};
  }

  add(section, severity, message, location = {}) {
    if (!this.sections[section]) this.sections[section] = [];
    this.sections[section].push({ severity, message, ...location });
  }

  get(section) {
    return this.sections[section] || [];
  }

  counts() {
    const all = Object.values(this.sections).flat();
    return {
      errors: all.filter((m) => m.severity === SEVERITY.ERROR).length,
      warnings: all.filter((m) => m.severity === SEVERITY.WARNING).length,
      information: all.filter((m) => m.severity === SEVERITY.INFO).length,
    };
  }
}

/* ---------- Layer 0: prerequisites ---------- */

function checkPrerequisites(template, fileSize, report) {
  const section = 'prerequisites';

  if (template.format === 'xlsx') {
    report.add(section, SEVERITY.ERROR,
      'File is not saved as "XML Spreadsheet 2003 (*.xml)". The Migration Cockpit only accepts XML Spreadsheet 2003 files. Re-save via File > Save As > XML Spreadsheet 2003 before uploading.');
  } else {
    report.add(section, SEVERITY.SUCCESS, 'File format is XML Spreadsheet 2003, as required by the Migration Cockpit.');
  }

  if (fileSize > MAX_FILE_BYTES) {
    report.add(section, SEVERITY.ERROR,
      `File size ${(fileSize / 1024 / 1024).toFixed(1)} MB exceeds the 100 MB limit. Split the file, or raise icm/HTTP/max_request_size_KB to allow up to 160 MB.`);
  } else {
    report.add(section, SEVERITY.SUCCESS, `File size ${(fileSize / 1024 / 1024).toFixed(1)} MB is within the 100 MB limit.`);
  }

  // "Set precision as displayed" is an Excel application setting that leaves no trace in the
  // saved file, so it cannot be verified by reading the upload.
  report.add(section, SEVERITY.INFO,
    'Cannot verify "Set precision as displayed" (File > Options > Advanced) from the uploaded file — this is an Excel application setting. Confirm it is enabled before generating the template.');
}

/* ---------- Migration object scope (Staging Table approach) ---------- */

function checkMigrationObject(template, report) {
  const section = 'migrationObject';
  const objectName = template.fieldList ? template.fieldList.objectName : null;

  if (!objectName) {
    report.add(section, SEVERITY.WARNING,
      'The migration object name could not be read from the Field List title, so it cannot be matched against the catalogue of supported Staging Table objects.');
    return null;
  }

  const entry = catalog.findObject(objectName);

  if (!entry) {
    report.add(section, SEVERITY.WARNING,
      `'${objectName}' was not found among the ${catalog.count} migration objects available for the Staging Table approach. It may be a custom object built in the migration object modeler (LTMOM), an object only available via Direct Transfer, or named differently in your release.`);
    return null;
  }

  report.add(section, SEVERITY.SUCCESS,
    `'${entry.name}' is available for the Staging Table approach (${entry.businessObjectType}${entry.component ? `, component ${entry.component}` : ''}).`);

  if (entry.deprecated) {
    report.add(section, SEVERITY.WARNING,
      `'${entry.name}' is marked deprecated: a newer version of this migration object exists and deprecated objects are removed after a few releases. Check SAP Note 2698032 and migrate to the current object.`);
  }

  if (entry.restricted) {
    report.add(section, SEVERITY.WARNING,
      `'${entry.name}' is marked restricted: it does not cover all fields and structures of the related business processes. Read the object documentation before relying on it.`);
  }

  report.add(section, SEVERITY.INFO,
    `Migration objects perform initial load only — '${entry.name}' can create records but cannot change or update records that already exist in the target system.`);

  if (entry.customFieldSupport) {
    report.add(section, SEVERITY.INFO,
      `'${entry.name}' supports custom fields. Fields added via key user extensibility can be included in the template.`);
  }

  return entry;
}

/* ---------- Layer 1: structure integrity ---------- */

function checkStructure(template, report) {
  const section = 'structure';

  if (!template.fieldList) {
    report.add(section, SEVERITY.ERROR,
      `Sheet '${FIELD_LIST_SHEET}' is missing or unreadable. Without it the template cannot be validated and the cockpit will reject the file.`);
    return;
  }

  const { headerLabels } = template.fieldList;
  const expectedHeaders = { sheet: 'Sheet Name', field: 'Field Description', importance: 'Importance', type: 'Type', sapStructure: 'SAP Structure', sapField: 'SAP Field' };
  const headerDrift = Object.entries(expectedHeaders).filter(([key, expected]) => headerLabels[key] !== expected);
  if (headerDrift.length > 0) {
    report.add(section, SEVERITY.ERROR,
      `'${FIELD_LIST_SHEET}' header row altered (expected ${headerDrift.map(([, e]) => `'${e}'`).join(', ')}). Modified template not supported by SAP S/4HANA Migration Cockpit.`);
  }

  // Sheet roster: the Field List is the authority on which sheets must exist.
  const rosterNames = template.fieldList.sheets.map((s) => s.name);
  const actualNames = template.dataSheets.map((s) => s.name);

  for (const expected of rosterNames) {
    if (!actualNames.includes(expected)) {
      report.add(section, SEVERITY.ERROR,
        `Sheet '${expected}' is listed in the Field List but missing from the workbook (deleted or renamed). Modified template not supported by SAP S/4HANA Migration Cockpit.`,
        { sheet: expected });
    }
  }

  for (const actual of actualNames) {
    if (!rosterNames.includes(actual)) {
      report.add(section, SEVERITY.ERROR,
        `Sheet '${actual}' exists in the workbook but is not listed in the Field List (added or renamed).`,
        { sheet: actual });
    }
  }

  // Sheet tab position is not checked: the cockpit reads sheets by name, not by their
  // left-to-right order in the workbook, so a reordered tab is not a structural problem.

  for (const sheet of template.dataSheets) {
    const roster = template.fieldList.sheets.find((s) => s.name === sheet.name);

    // Optional and empty: nothing to load from this sheet, so skip its structure checks too.
    if (sheet.rows.length === 0 && !(roster && roster.mandatory)) continue;

    if (!sheet.hiddenRowsIntact.structure) {
      report.add(section, SEVERITY.ERROR, `Hidden row 4 (SAP technical structure) is missing or empty on sheet '${sheet.name}'. The template XML is corrupt.`, { sheet: sheet.name });
    }
    if (!sheet.hiddenRowsIntact.techField) {
      report.add(section, SEVERITY.ERROR, `Hidden row 5 (SAP technical field names) is missing on sheet '${sheet.name}'. The template XML is corrupt.`, { sheet: sheet.name });
    }
    if (!sheet.hiddenRowsIntact.typeSpec) {
      report.add(section, SEVERITY.ERROR, `Hidden row 6 (data type / length definitions) is missing on sheet '${sheet.name}'. The template XML is corrupt.`, { sheet: sheet.name });
    }

    for (const key of ['structureHidden', 'techFieldHidden', 'typeSpecHidden']) {
      if (sheet.rowVisibility[key] === false) {
        const rowNum = { structureHidden: 4, techFieldHidden: 5, typeSpecHidden: 6 }[key];
        report.add(section, SEVERITY.WARNING,
          `Row ${rowNum} on sheet '${sheet.name}' is no longer hidden. The technical rows should stay hidden; unhiding them suggests the template was edited.`,
          { sheet: sheet.name });
      }
    }

    if (!roster) continue;

    // Row 8 headers must still match the Field List field descriptions, in the same order.
    const rosterFields = roster.fields.map((f) => f.name);
    const sheetFields = sheet.columns.map((c) => c.name).filter(Boolean);

    for (const expected of rosterFields) {
      if (!sheetFields.includes(expected)) {
        report.add(section, SEVERITY.ERROR,
          `Column '${expected}' is defined in the Field List for sheet '${sheet.name}' but its row-8 header is missing or altered (deleted column or Find & Replace damage).`,
          { sheet: sheet.name, field: expected });
      }
    }

    for (const actual of sheetFields) {
      if (!rosterFields.includes(actual)) {
        report.add(section, SEVERITY.ERROR,
          `Column '${actual}' on sheet '${sheet.name}' is not defined in the Field List (added column or altered header).`,
          { sheet: sheet.name, field: actual });
      }
    }

    const commonCols = sheetFields.filter((n) => rosterFields.includes(n));
    const expectedCols = rosterFields.filter((n) => sheetFields.includes(n));
    if (commonCols.join('|') !== expectedCols.join('|')) {
      report.add(section, SEVERITY.ERROR,
        `Column order on sheet '${sheet.name}' differs from the Field List. Reordering columns corrupts the template.`,
        { sheet: sheet.name });
    }

    // Mandatory markers must agree between the Field List and the row-8 '*' suffix.
    for (const col of sheet.columns) {
      if (!col.name) continue;
      const rosterField = roster.fields.find((f) => f.name === col.name);
      if (rosterField && rosterField.mandatory !== col.mandatory) {
        report.add(section, SEVERITY.ERROR,
          `Mandatory marker mismatch for '${col.name}' on sheet '${sheet.name}': Field List says ${rosterField.mandatory ? 'mandatory' : 'optional'} but the row-8 header says ${col.mandatory ? 'mandatory' : 'optional'}.`,
          { sheet: sheet.name, field: col.name });
      }
    }

    for (const row of sheet.rows) {
      if (row.hasFormula) {
        report.add(section, SEVERITY.ERROR,
          `Formula detected on sheet '${sheet.name}' row ${row.rowNumber}. Paste values only — formulas corrupt the template XML.`,
          { sheet: sheet.name, row: row.rowNumber });
      }
    }
  }

  if (report.get(section).length === 0) {
    report.add(section, SEVERITY.SUCCESS, 'Template structure is intact: sheets, columns, hidden technical rows and headers all match the Field List.');
  }
}

/* ---------- Layer 2: row-level mandatory coverage ---------- */

function checkMandatoryCoverage(template, report) {
  const section = 'mandatory';

  for (const sheet of template.dataSheets) {
    const mandatoryCols = sheet.columns.filter((c) => c.mandatory);
    if (mandatoryCols.length === 0) continue;

    const roster = template.fieldList
      ? template.fieldList.sheets.find((s) => s.name === sheet.name)
      : null;

    // An optional sheet that is out of project scope may be left entirely empty.
    if (sheet.rows.length === 0) {
      if (roster && roster.mandatory) {
        report.add(section, SEVERITY.ERROR,
          `Mandatory sheet '${sheet.name}' contains no data. At least one complete record is required.`,
          { sheet: sheet.name });
      }
      continue;
    }

    for (const row of sheet.rows) {
      const populatedOptional = sheet.columns
        .filter((c) => !c.mandatory && !isBlank(row.values[c.index]))
        .map((c) => c.name)
        .filter(Boolean);

      for (const col of mandatoryCols) {
        if (isBlank(row.values[col.index])) {
          const because = populatedOptional.length > 0
            ? `has data in optional field '${populatedOptional[0]}'`
            : 'has data in another mandatory field';
          report.add(section, SEVERITY.ERROR,
            `Row is active (${because}) but mandatory field '${col.name}' is empty.`,
            { sheet: sheet.name, row: row.rowNumber, field: col.name, cell: `${columnLetter(col.index)}${row.rowNumber}` });
        }
      }
    }
  }

  if (report.get(section).length === 0) {
    report.add(section, SEVERITY.SUCCESS, 'Every active row has all mandatory fields populated.');
  }
}

/* ---------- Layer 2c: key uniqueness across every sheet ---------- */

/**
 * Identifies the columns that make an active record unique on a given sheet.
 *
 * The main sheet declares a genuine primary key: the Field List marks it group
 * 'Key', and that column must be unique on its own. On a child sheet the same
 * marker only tags the foreign key back to the header, and the rest of the
 * composite key is not declared anywhere in the template — so the sheet's
 * mandatory fields stand in for it. That set is a superset of the true key, which
 * biases the check towards silence: a reported duplicate is always real, while two
 * rows differing only in a mandatory *data* field go unreported. Better to miss one
 * than to accuse a clean template.
 */
function identityColumnsFor(sheet, isMainSheet) {
  if (isMainSheet) {
    const declared = sheet.columns.filter(
      (c) => c.name && String(c.group || '').trim().toLowerCase() === 'key'
    );
    if (declared.length > 0) return { columns: declared, basis: 'declared key' };

    const firstMandatory = sheet.columns.find((c) => c.mandatory && c.name);
    return firstMandatory ? { columns: [firstMandatory], basis: 'first mandatory field' } : { columns: [], basis: null };
  }

  const mandatory = sheet.columns.filter((c) => c.mandatory && c.name);
  // A lone mandatory column on a child sheet is just the foreign key, and one
  // header legitimately owns many child rows, so repeats there mean nothing.
  if (mandatory.length < 2) return { columns: [], basis: null };
  return { columns: mandatory, basis: 'mandatory fields' };
}

function checkKeyUniqueness(template, report) {
  const section = 'keyUniqueness';
  const mainSheetName = template.mainSheet ? template.mainSheet.name : null;
  let sheetsChecked = 0;

  for (const sheet of template.dataSheets) {
    if (sheet.rows.length === 0) continue;

    const { columns, basis } = identityColumnsFor(sheet, sheet.name === mainSheetName);
    if (columns.length === 0) {
      report.add(section, SEVERITY.INFO,
        `Sheet '${sheet.name}' has no column combination that identifies a record, so duplicates cannot be detected here.`,
        { sheet: sheet.name });
      continue;
    }

    sheetsChecked += 1;
    const seen = new Map();

    for (const row of sheet.rows) {
      const parts = columns.map((c) => asString(row.values[c.index]));
      // A record missing part of its own key is the mandatory layer's business.
      if (parts.some((part) => part === '')) continue;
      // NUL separator: key values legitimately contain spaces and punctuation
      // (e.g. '1000 MILES12'), so a printable delimiter risks false collisions.
      const composite = parts.join('\u0000');
      if (!seen.has(composite)) seen.set(composite, { parts, rows: [] });
      seen.get(composite).rows.push(row.rowNumber);
    }

    for (const { parts, rows } of seen.values()) {
      if (rows.length < 2) continue;
      const shown = columns.map((c, i) => `${c.name}='${parts[i]}'`).join(', ');
      const label = columns.length === 1 ? 'Duplicate key' : 'Duplicate composite key';
      report.add(section, SEVERITY.ERROR,
        `${label} in sheet '${sheet.name}' on rows ${rows.join(', ')}: ${shown}. Every active record must be uniquely identified (compared on ${basis}), so the cockpit cannot tell these rows apart.`,
        { sheet: sheet.name, row: rows[0], field: columns[0].name });
    }
  }

  if (report.get(section).some((m) => m.severity === SEVERITY.ERROR)) return;

  if (sheetsChecked === 0) {
    report.add(section, SEVERITY.INFO, 'No sheet contained data whose records could be checked for uniqueness.');
  } else {
    report.add(section, SEVERITY.SUCCESS,
      `Every active record is uniquely identified across ${sheetsChecked} populated sheet(s).`);
  }
}


/* ---------- Layer 2b: foreign key / referential integrity ---------- */

function checkReferentialIntegrity(template, report) {
  const section = 'referential';
  const mainSheet = template.mainSheet;

  if (!mainSheet) {
    report.add(section, SEVERITY.ERROR, 'No data sheet found after the Field List — the main (key) table cannot be determined.');
    return;
  }

  const keyColumn = mainSheet.columns.find((c) => c.mandatory && c.name);
  if (!keyColumn) {
    report.add(section, SEVERITY.ERROR, `Main sheet '${mainSheet.name}' has no mandatory key column; referential integrity cannot be checked.`, { sheet: mainSheet.name });
    return;
  }

  const keyValues = new Map();
  for (const row of mainSheet.rows) {
    const raw = row.values[keyColumn.index];
    if (isBlank(raw)) continue;
    const key = asString(raw);
    if (!keyValues.has(key)) keyValues.set(key, []);
    keyValues.get(key).push(row.rowNumber);
  }

  const referencedKeys = new Set();

  for (const sheet of template.dataSheets) {
    if (sheet.name === mainSheet.name) continue;

    const fkColumn = sheet.columns.find((c) => c.name === keyColumn.name);
    if (!fkColumn) continue;

    for (const row of sheet.rows) {
      const raw = row.values[fkColumn.index];

      if (isBlank(raw)) {
        report.add(section, SEVERITY.ERROR,
          `Foreign key '${keyColumn.name}' is missing on active row.`,
          { sheet: sheet.name, row: row.rowNumber, field: keyColumn.name, cell: `${columnLetter(fkColumn.index)}${row.rowNumber}` });
        continue;
      }

      const fk = asString(raw);
      referencedKeys.add(fk);

      if (!keyValues.has(fk)) {
        report.add(section, SEVERITY.ERROR,
          `Foreign key '${fk}' in sheet '${sheet.name}' not found in main sheet '${mainSheet.name}'. The record cannot be related to a header.`,
          { sheet: sheet.name, row: row.rowNumber, field: keyColumn.name, cell: `${columnLetter(fkColumn.index)}${row.rowNumber}` });
      }
    }
  }

  for (const key of keyValues.keys()) {
    if (!referencedKeys.has(key)) {
      report.add(section, SEVERITY.INFO,
        `Record '${key}' in main sheet '${mainSheet.name}' has no child records in any other sheet. This is allowed.`,
        { sheet: mainSheet.name, field: keyColumn.name });
    }
  }

  if (report.get(section).filter((m) => m.severity === SEVERITY.ERROR).length === 0) {
    report.add(section, SEVERITY.SUCCESS,
      `Referential integrity is intact. Main sheet '${mainSheet.name}', key '${keyColumn.name}': ${keyValues.size} unique record(s).`);
  }

  return { mainSheetName: mainSheet.name, keyFieldName: keyColumn.name, keyCount: keyValues.size };
}

/* ---------- Layer 3: data type & length conformance ---------- */

function countDecimals(str) {
  const match = /\.(\d+)$/.exec(str);
  return match ? match[1].length : 0;
}

function significantDigits(str) {
  return str.replace(/[-.]/g, '').replace(/^0+/, '').length;
}

function isValidDate(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  const str = String(value).trim();

  const patterns = [
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,   // US MM/DD/YYYY
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,   // DE DD.MM.YYYY
    /^(\d{4})-(\d{2})-(\d{2})$/,          // ISO
  ];

  for (const pattern of patterns) {
    const m = pattern.exec(str);
    if (!m) continue;

    let day, month, year;
    if (pattern === patterns[0]) { month = +m[1]; day = +m[2]; year = +m[3]; }
    else if (pattern === patterns[1]) { day = +m[1]; month = +m[2]; year = +m[3]; }
    else { year = +m[1]; month = +m[2]; day = +m[3]; }

    if (month < 1 || month > 12) return false;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day >= 1 && day <= daysInMonth;
  }

  return false;
}

function checkTypesAndLengths(template, report) {
  const section = 'types';

  for (const sheet of template.dataSheets) {
    for (const row of sheet.rows) {
      for (const col of sheet.columns) {
        const raw = row.values[col.index];
        if (isBlank(raw)) continue;

        const declaredType = col.declaredType || (col.typeSpec && col.typeSpec.category);
        const maxLength = col.declaredLength || (col.typeSpec ? col.typeSpec.length : null);
        const location = { sheet: sheet.name, row: row.rowNumber, field: col.name, cell: `${columnLetter(col.index)}${row.rowNumber}` };
        const value = cellText(raw);

        if (declaredType === 'Text') {
          const str = asString(value);
          if (maxLength && str.length > maxLength) {
            report.add(section, SEVERITY.ERROR,
              `'${col.name}' exceeds declared length ${maxLength} (value is ${str.length} characters).`, location);
          }
        } else if (declaredType === 'Number') {
          const str = asString(value);
          const numeric = Number(str.replace(',', '.'));
          if (Number.isNaN(numeric)) {
            report.add(section, SEVERITY.ERROR, `'${col.name}' must be a number but contains '${str}'.`, location);
            continue;
          }
          const decimals = countDecimals(str.replace(',', '.'));
          const declaredDecimals = col.typeSpec ? col.typeSpec.decimals : null;

          if (decimals > MAX_DECIMALS) {
            report.add(section, SEVERITY.ERROR,
              `'${col.name}' has ${decimals} decimal places. More than ${MAX_DECIMALS} decimal places is not supported.`, location);
          } else if (declaredDecimals !== null && decimals > declaredDecimals) {
            report.add(section, SEVERITY.ERROR,
              `'${col.name}' has ${decimals} decimal places but the template declares ${declaredDecimals}.`, location);
          }

          if (significantDigits(str) > EXCEL_MAX_DIGITS) {
            report.add(section, SEVERITY.WARNING,
              `'${col.name}' has more than ${EXCEL_MAX_DIGITS} digits. Excel cannot store this precisely — use the staging tables path instead of a file upload.`, location);
          }

          if (maxLength && str.replace('-', '').replace('.', '').length > maxLength) {
            report.add(section, SEVERITY.ERROR,
              `'${col.name}' exceeds declared length ${maxLength} (length includes decimal places).`, location);
          }
        } else if (declaredType === 'Date') {
          if (!isValidDate(value)) {
            report.add(section, SEVERITY.ERROR,
              `'${col.name}' contains '${asString(value)}', which is not a valid date. Use the country-specific format (US 12/31/1998 or DE 31.12.1998).`, location);
          }
        } else if (declaredType === 'Time') {
          const str = asString(value);
          if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(str)) {
            report.add(section, SEVERITY.ERROR,
              `'${col.name}' contains '${str}'. Time must be in strict HH:MM:SS format (e.g. 02:52:40).`, location);
          }
        }
      }
    }
  }

  if (report.get(section).length === 0) {
    report.add(section, SEVERITY.SUCCESS, 'All populated cells conform to their declared data type and length.');
  }
}

/* ---------- Layer 4: value mapping readiness ---------- */

function checkValueMapping(template, report) {
  const section = 'mapping';

  for (const sheet of template.dataSheets) {
    if (sheet.rows.length === 0) continue;

    for (const col of sheet.columns) {
      const maxLength = col.declaredLength || (col.typeSpec ? col.typeSpec.length : null);
      if (col.declaredType !== 'Text' || maxLength !== MAPPABLE_TEXT_LENGTH) continue;

      const distinct = new Set();
      for (const row of sheet.rows) {
        const raw = row.values[col.index];
        if (!isBlank(raw)) distinct.add(asString(raw));
      }
      if (distinct.size === 0) continue;

      const values = [...distinct];
      report.add(section, SEVERITY.INFO,
        `'${col.name}' (Text/80) needs source-to-target value mapping in the "Convert Values" step. ${values.length} distinct source value(s): ${values.slice(0, 10).join(', ')}${values.length > 10 ? '…' : ''}`,
        { sheet: sheet.name, field: col.name });

      // Values that normalise to the same token are usually legacy spelling variants
      // that should collapse to a single target value.
      const normalised = new Map();
      for (const value of values) {
        const key = value.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!normalised.has(key)) normalised.set(key, []);
        normalised.get(key).push(value);
      }
      for (const variants of normalised.values()) {
        if (variants.length > 1) {
          report.add(section, SEVERITY.WARNING,
            `'${col.name}' has inconsistent source variants that likely map to one target value: ${variants.join(' / ')}.`,
            { sheet: sheet.name, field: col.name });
        }
      }
    }
  }

  if (report.get(section).length === 0) {
    report.add(section, SEVERITY.SUCCESS, 'No text fields requiring value mapping contain data.');
  }
}

/* ---------- Failure impact: which dependent rows a failed record blocks ---------- */

/**
 * The cockpit creates the header record first, then its dependent records. If a
 * header fails, every child row pointing at it is blocked even when that child
 * row is itself error-free — this maps that cascade.
 */
function buildImpactGraph(template, report, mainSheetName, keyFieldName) {
  const mainSheet = template.dataSheets.find((s) => s.name === mainSheetName);
  if (!mainSheet || !keyFieldName) return null;

  const keyColumn = mainSheet.columns.find((c) => c.name === keyFieldName);
  if (!keyColumn) return null;

  // Index every error message by the row it was raised against.
  const errorsByRow = new Map();
  for (const messages of Object.values(report.sections)) {
    for (const m of messages) {
      if (m.severity !== SEVERITY.ERROR || !m.sheet || !m.row) continue;
      const id = `${m.sheet}:${m.row}`;
      if (!errorsByRow.has(id)) errorsByRow.set(id, []);
      errorsByRow.get(id).push(m.message);
    }
  }

  const keyToMainRow = new Map();
  for (const row of mainSheet.rows) {
    const raw = row.values[keyColumn.index];
    if (isBlank(raw)) continue;
    const key = asString(raw);
    if (!keyToMainRow.has(key)) keyToMainRow.set(key, row.rowNumber);
  }

  const failedKeys = new Map();
  for (const [key, rowNumber] of keyToMainRow.entries()) {
    const reasons = errorsByRow.get(`${mainSheetName}:${rowNumber}`);
    if (reasons) failedKeys.set(key, { row: rowNumber, reasons });
  }

  const childSheets = template.dataSheets.filter(
    (s) => s.name !== mainSheetName && s.rows.length > 0 && s.columns.some((c) => c.name === keyFieldName)
  );

  const blockedByKey = new Map();
  const nodes = [];
  const edges = [];

  const mainOwnErrorRows = mainSheet.rows.filter((r) => errorsByRow.has(`${mainSheetName}:${r.rowNumber}`)).length;
  nodes.push({
    id: mainSheetName,
    sheet: mainSheetName,
    role: 'main',
    totalRows: mainSheet.rows.length,
    ownErrorRows: mainOwnErrorRows,
    blockedRows: 0,
    status: mainOwnErrorRows > 0 ? 'error' : mainSheet.rows.length > 0 ? 'clean' : 'empty',
  });

  for (const sheet of childSheets) {
    const fkColumn = sheet.columns.find((c) => c.name === keyFieldName);
    let ownErrorRows = 0;
    let blockedRows = 0;

    for (const row of sheet.rows) {
      const hasOwnError = errorsByRow.has(`${sheet.name}:${row.rowNumber}`);
      if (hasOwnError) ownErrorRows += 1;

      const raw = row.values[fkColumn.index];
      if (isBlank(raw)) continue;
      const fk = asString(raw);

      // Blocked = the parent header itself failed, so this row cannot load
      // regardless of its own correctness.
      if (failedKeys.has(fk)) {
        blockedRows += 1;
        if (!blockedByKey.has(fk)) blockedByKey.set(fk, []);
        blockedByKey.get(fk).push({ sheet: sheet.name, row: row.rowNumber, hasOwnError });
      }
    }

    nodes.push({
      id: sheet.name,
      sheet: sheet.name,
      role: 'child',
      totalRows: sheet.rows.length,
      ownErrorRows,
      blockedRows,
      status: blockedRows > 0 ? 'blocked' : ownErrorRows > 0 ? 'error' : 'clean',
    });

    edges.push({ from: mainSheetName, to: sheet.name, viaField: keyFieldName });
  }

  const cascades = [...failedKeys.entries()].map(([key, info]) => ({
    key,
    mainRow: info.row,
    reasons: info.reasons,
    blocked: blockedByKey.get(key) || [],
  })).sort((a, b) => b.blocked.length - a.blocked.length);

  return {
    mainSheet: mainSheetName,
    keyField: keyFieldName,
    nodes,
    edges,
    cascades,
    totals: {
      failedRecords: failedKeys.size,
      blockedRows: [...blockedByKey.values()].reduce((sum, list) => sum + list.length, 0),
      affectedSheets: nodes.filter((n) => n.status === 'blocked').length,
    },
  };
}

/* ---------- Downstream migration objects blocked by this object failing ---------- */

/**
 * Each object's documentation lists the objects that must already be migrated.
 * Inverted, that tells us which objects cannot load if this one fails — and the
 * block propagates transitively down the chain.
 */
function buildDownstreamImpact(objectEntry, hasErrors) {
  if (!objectEntry) return null;

  const rootName = objectEntry.name;
  if (!(rootName in dependencies.dependsOn)) return null;

  const direct = dependencies.requiredBy[rootName] || [];

  // Breadth-first over requiredBy gives the full set of objects that transitively
  // depend on this one, recording the depth at which each becomes blocked.
  const depthByObject = new Map();
  let frontier = [rootName];
  let depth = 0;

  while (frontier.length > 0) {
    depth += 1;
    const next = [];
    for (const current of frontier) {
      for (const dependent of dependencies.requiredBy[current] || []) {
        if (dependent === rootName || depthByObject.has(dependent)) continue;
        depthByObject.set(dependent, depth);
        next.push(dependent);
      }
    }
    frontier = next;
  }

  const transitive = [...depthByObject.entries()]
    .map(([name, level]) => ({ name, level }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  return {
    object: rootName,
    blocked: hasErrors,
    dependsOn: dependencies.dependsOn[rootName] || [],
    directDependents: direct,
    transitiveDependents: transitive,
    totals: {
      direct: direct.length,
      transitive: transitive.length,
      maxDepth: transitive.reduce((max, t) => Math.max(max, t.level), 0),
    },
    source: dependencies.source,
    retrieved: dependencies.retrieved,
  };
}

function reportDownstreamImpact(downstream, report) {
  if (!downstream) return;
  const section = 'downstream';

  if (downstream.dependsOn.length > 0) {
    report.add(section, SEVERITY.INFO,
      `'${downstream.object}' requires these objects to be maintained or migrated first: ${downstream.dependsOn.join(', ')}.`);
  }

  if (downstream.totals.direct === 0) {
    report.add(section, SEVERITY.SUCCESS, `No other migration object lists '${downstream.object}' as a prerequisite.`);
    return;
  }

  if (downstream.blocked) {
    report.add(section, SEVERITY.ERROR,
      `'${downstream.object}' has blocking errors, so ${downstream.totals.direct} migration object(s) that list it as a prerequisite cannot be migrated${downstream.totals.transitive > downstream.totals.direct ? `, and ${downstream.totals.transitive} in total once the chain is followed` : ''}. Fix this object before loading: ${downstream.directDependents.slice(0, 8).join(', ')}${downstream.directDependents.length > 8 ? `, and ${downstream.directDependents.length - 8} more` : ''}.`);
  } else {
    report.add(section, SEVERITY.SUCCESS,
      `'${downstream.object}' has no blocking errors, so the ${downstream.totals.direct} object(s) that depend on it are not blocked by this template.`);
    report.add(section, SEVERITY.INFO,
      `${downstream.totals.direct} object(s) list '${downstream.object}' as a prerequisite and must be migrated after it${downstream.totals.transitive > downstream.totals.direct ? ` (${downstream.totals.transitive} including indirect dependents)` : ''}.`);
  }
}

/* ---------- Layer 5: check tables (requires a live SAP connection) ---------- */

function checkConfigTables(template, report) {
  report.add('checkTables', SEVERITY.INFO,
    'Check-table validation (Company Code in T001, Plant in T001W, Country in T005, Currency in TCURC, etc.) was not performed: no SAP system is connected. These values are validated by the cockpit during the "Simulate" step.');
}

/* ---------- orchestration ---------- */

function validateTemplate(template, fileSize) {
  const report = new Report();

  checkPrerequisites(template, fileSize, report);
  const objectEntry = checkMigrationObject(template, report);
  checkStructure(template, report);

  const structureBlocked = report.get('structure').some((m) => m.severity === SEVERITY.ERROR);

  let keyInfo = null;
  if (!structureBlocked) {
    checkMandatoryCoverage(template, report);
    checkKeyUniqueness(template, report);
    keyInfo = checkReferentialIntegrity(template, report);
    checkTypesAndLengths(template, report);
    checkValueMapping(template, report);
    checkConfigTables(template, report);
  } else {
    for (const section of ['mandatory', 'keyUniqueness', 'referential', 'types', 'mapping', 'checkTables']) {
      report.add(section, SEVERITY.INFO,
        'Skipped: the template structure is corrupt, so the cockpit would reject the file before reaching this step. Fix the structure errors first.');
    }
  }

  const impactGraph = keyInfo
    ? buildImpactGraph(template, report, keyInfo.mainSheetName, keyInfo.keyFieldName)
    : null;

  // Downstream objects are blocked by any error that would stop this template
  // loading, not only by referential ones.
  const hasBlockingErrors = report.counts().errors > 0;
  const downstream = buildDownstreamImpact(objectEntry, hasBlockingErrors);
  reportDownstreamImpact(downstream, report);

  const counts = report.counts();

  return {
    fileName: template.fileName,
    objectName: template.fieldList ? template.fieldList.objectName : null,
    migrationObject: objectEntry,
    impactGraph,
    downstream,
    format: template.format === 'xml2003' ? 'XML Spreadsheet 2003' : 'Excel Workbook (.xlsx)',
    fieldListDetected: Boolean(template.fieldList),
    mainSheet: keyInfo ? keyInfo.mainSheetName : (template.mainSheet ? template.mainSheet.name : null),
    keyField: keyInfo ? keyInfo.keyFieldName : null,
    recordCount: keyInfo ? keyInfo.keyCount : 0,
    sheetCount: template.dataSheets.length,
    sheetsWithData: template.dataSheets.filter((s) => s.rows.length > 0).map((s) => ({ name: s.name, rows: s.rows.length })),
    sections: report.sections,
    summary: { ...counts, migrationReady: counts.errors === 0 },
  };
}

module.exports = { validateTemplate, SEVERITY };
