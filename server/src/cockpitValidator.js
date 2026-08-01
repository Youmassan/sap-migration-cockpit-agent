const { isBlank, asString, cellText, stripMandatorySuffix, FIELD_LIST_SHEET } = require('./templateParser');
const catalog = require('./stagingObjectCatalog');

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

  const commonOrder = actualNames.filter((n) => rosterNames.includes(n));
  const expectedOrder = rosterNames.filter((n) => actualNames.includes(n));
  if (commonOrder.join('|') !== expectedOrder.join('|')) {
    report.add(section, SEVERITY.ERROR,
      `Sheet order differs from the Field List roster (found: ${commonOrder.join(', ')}). Reordering sheets corrupts the template.`);
  }

  for (const sheet of template.dataSheets) {
    const roster = template.fieldList.sheets.find((s) => s.name === sheet.name);

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

  for (const [key, rows] of keyValues.entries()) {
    if (rows.length > 1) {
      report.add(section, SEVERITY.ERROR,
        `Duplicate primary key '${key}' in main sheet '${mainSheet.name}' (rows ${rows.join(', ')}). The key must be unique per record.`,
        { sheet: mainSheet.name, field: keyColumn.name, row: rows[0] });
    }
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
    keyInfo = checkReferentialIntegrity(template, report);
    checkTypesAndLengths(template, report);
    checkValueMapping(template, report);
    checkConfigTables(template, report);
  } else {
    for (const section of ['mandatory', 'referential', 'types', 'mapping', 'checkTables']) {
      report.add(section, SEVERITY.INFO,
        'Skipped: the template structure is corrupt, so the cockpit would reject the file before reaching this step. Fix the structure errors first.');
    }
  }

  const counts = report.counts();

  return {
    fileName: template.fileName,
    objectName: template.fieldList ? template.fieldList.objectName : null,
    migrationObject: objectEntry,
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
