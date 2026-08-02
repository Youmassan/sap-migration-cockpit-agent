/**
 * Generates one isolated-fault fixture per validation layer from a real, clean
 * Product template, so each layer's checks can be exercised without the noise
 * of unrelated failures. Also writes a fully clean baseline (the real file with
 * its one naturally-occurring orphan FK row removed) so the "everything passes"
 * path has a fixture too.
 *
 * Usage: node scripts/make-test-fixtures.js <path-to-source.xml> <output-dir>
 */
const fs = require('fs');
const path = require('path');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const ExcelJS = require('exceljs');

const PARSE_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: true,
};

const BUILD_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: false,
  suppressEmptyNode: true,
  processEntities: true,
};

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function findSheet(doc, name) {
  const sheets = asArray(doc.Workbook.Worksheet);
  return sheets.find((w) => w['@_ss:Name'] === name);
}

function resolveRows(ws) {
  const rows = asArray(ws.Table.Row);
  let rowIndex = 0;
  return rows.map((el) => {
    rowIndex = el['@_ss:Index'] ? Number(el['@_ss:Index']) : rowIndex + 1;
    return { el, index: rowIndex };
  });
}

function getRow(ws, rowNumber) {
  const found = resolveRows(ws).find((r) => r.index === rowNumber);
  if (!found) throw new Error(`Row ${rowNumber} not found on sheet '${ws['@_ss:Name']}'`);
  return found.el;
}

function resolveCells(rowEl) {
  const cells = asArray(rowEl.Cell);
  let colIndex = 0;
  return cells.map((el) => {
    colIndex = el['@_ss:Index'] ? Number(el['@_ss:Index']) : colIndex + 1;
    const thisIndex = colIndex;
    const merge = Number(el['@_ss:MergeAcross'] || 0);
    if (merge > 0) colIndex += merge;
    return { el, index: thisIndex };
  });
}

function getCell(rowEl, colNumber) {
  const found = resolveCells(rowEl).find((c) => c.index === colNumber);
  return found ? found.el : null;
}

function setCellText(cellEl, text, type = 'String') {
  cellEl.Data = { '@_ss:Type': type, '#text': String(text) };
}

function makeCell(colIndex, text, type = 'String') {
  return { '@_ss:Index': String(colIndex), Data: { '@_ss:Type': type, '#text': String(text) } };
}

function makeRow(rowIndex, cells) {
  return { '@_ss:Index': String(rowIndex), Cell: cells };
}

/** Deep clone via structuredClone-equivalent (buffers/functions never appear in this tree). */
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadDoc(xmlText) {
  const parser = new XMLParser(PARSE_OPTS);
  return parser.parse(xmlText);
}

function serialize(doc) {
  const builder = new XMLBuilder(BUILD_OPTS);
  const body = builder.build(doc);
  return '<?xml version="1.0"?>\n' + body;
}

/* ---------- baseline ---------- */

/**
 * The supplied source carries one real defect: an 'Additional Descriptions' row
 * whose Product Number ('cr') matches no Basic Data record. Every fixture is built
 * on top of this cleanup so that each one exercises exactly its own injected fault
 * and nothing else — otherwise that orphan FK contaminates every referential check.
 */
function cleanBaseline(doc) {
  const ad = findSheet(doc, 'Additional Descriptions');
  const rows = asArray(ad.Table.Row);
  const bad = resolveRows(ad).find((r) => {
    const cell = getCell(r.el, 1);
    return cell && cell.Data && cell.Data['#text'] === 'cr';
  });
  if (bad) ad.Table.Row = rows.filter((el) => el !== bad.el);
}

/* ---------- fixture definitions ---------- */

const FIXTURES = [];

function fixture(name, description, mutate) {
  FIXTURES.push({ name, description, mutate });
}

// 0. Clean baseline — no mutation beyond the shared cleanup above.
fixture('00-clean-baseline', 'All layers pass', () => {});

// 1. Prerequisites — wrong format. Handled outside the mutate() pipeline below: this
//    needs a genuine ExcelJS-loadable .xlsx binary, not mutated XML text, or ExcelJS
//    throws on invalid zip data instead of exercising the format check.

// 2. Migration Object Scope — object name not in the Staging Table catalogue.
fixture('02-unknown-migration-object', 'Field List title renamed to a bogus object', (doc) => {
  const fl = findSheet(doc, 'Field List');
  const row1 = getRow(fl, 1);
  const cell = getCell(row1, 1);
  setCellText(cell, 'Field List for Migration Object: Totally Bogus Object XYZ');
});

// 3. Structure — sheet declared in Field List but missing from the workbook.
fixture('03-structure-missing-sheet', "'Plant Data' worksheet deleted", (doc) => {
  const sheets = asArray(doc.Workbook.Worksheet);
  doc.Workbook.Worksheet = sheets.filter((w) => w['@_ss:Name'] !== 'Plant Data');
});

// 4. Structure — sheet present but not declared in the Field List.
fixture('04-structure-rogue-sheet', "Extra worksheet 'Rogue Sheet' added, not in Field List", (doc) => {
  const template = findSheet(doc, 'Forecasting Data');
  const rogue = clone(template);
  rogue['@_ss:Name'] = 'Rogue Sheet';
  const sheets = asArray(doc.Workbook.Worksheet);
  const idx = sheets.findIndex((w) => w['@_ss:Name'] === 'Forecasting Data');
  sheets.splice(idx + 1, 0, rogue);
  doc.Workbook.Worksheet = sheets;
});

// 5. Structure — hidden row 6 (type spec) blanked out.
fixture('05-structure-typespec-blanked', "Basic Data row 6 (type spec) cells cleared", (doc) => {
  const bd = findSheet(doc, 'Basic Data');
  const row6 = getRow(bd, 6);
  row6.Cell = [];
});

// 6. Structure — technical row unhidden.
fixture('06-structure-row-unhidden', 'Basic Data row 4 (SAP structure) ss:Hidden removed', (doc) => {
  const bd = findSheet(doc, 'Basic Data');
  const row4 = getRow(bd, 4);
  delete row4['@_ss:Hidden'];
});

// 7. Structure — row-8 header text altered so it no longer matches the Field List.
fixture('07-structure-header-altered', "Basic Data row 8 'Description' header text changed", (doc) => {
  const bd = findSheet(doc, 'Basic Data');
  const row8 = getRow(bd, 8);
  const cell = getCell(row8, 4);
  setCellText(cell, 'Description Renamed By Mistake');
});

// 8. Structure — formula in a data cell.
fixture('08-structure-formula-cell', "Basic Data row 9 'Description' cell given a formula", (doc) => {
  const bd = findSheet(doc, 'Basic Data');
  const row9 = getRow(bd, 9);
  const cell = getCell(row9, 4);
  cell['@_ss:Formula'] = '=RC[-1]';
});

// 9. Mandatory coverage — active row missing a mandatory field.
fixture('09-mandatory-missing', "Basic Data row 9 'Description' blanked, other fields left populated", (doc) => {
  const bd = findSheet(doc, 'Basic Data');
  const row9 = getRow(bd, 9);
  const cell = getCell(row9, 4);
  setCellText(cell, '');
});

// 10. Referential — orphan FK (constructed, isolated from the real one).
fixture('10-referential-orphan-fk', "Storage Locations row references a Product Number not in Basic Data", (doc) => {
  const sl = findSheet(doc, 'Storage Locations');
  const row = makeRow(9, [
    makeCell(1, 'NONEXISTENT-999'),
    makeCell(2, '1000'),
    makeCell(3, '0001'),
    makeCell(4, 'A-01-01'),
  ]);
  sl.Table.Row = [...asArray(sl.Table.Row), row];
});

// 11. Referential — missing FK on an active row.
fixture('11-referential-missing-fk', 'Storage Locations row has no Product Number but other fields are populated', (doc) => {
  const sl = findSheet(doc, 'Storage Locations');
  const row = makeRow(9, [
    makeCell(2, '1000'),
    makeCell(3, '0001'),
    makeCell(4, 'A-01-01'),
  ]);
  sl.Table.Row = [...asArray(sl.Table.Row), row];
});

// 12. Referential — duplicate primary key.
fixture('12-referential-duplicate-pk', "Basic Data row 10's Product Number set equal to row 9's", (doc) => {
  const bd = findSheet(doc, 'Basic Data');
  const row9 = getRow(bd, 9);
  const row10 = getRow(bd, 10);
  const key9 = getCell(row9, 1).Data['#text'];
  setCellText(getCell(row10, 1), key9);
});

// 13. Type — text exceeds declared length (Description, Text/40).
fixture('13-type-text-overflow', "Basic Data row 9 'Description' set to 60 characters (declared max 40)", (doc) => {
  const bd = findSheet(doc, 'Basic Data');
  const row9 = getRow(bd, 9);
  const cell = getCell(row9, 4);
  setCellText(cell, 'X'.repeat(60));
});

/** Writes a value into a cell, appending the cell if the row doesn't reach that column. */
function putCell(rowEl, colIndex, text, type = 'String') {
  const existing = getCell(rowEl, colIndex);
  if (existing) {
    setCellText(existing, text, type);
  } else {
    rowEl.Cell = [...asArray(rowEl.Cell), makeCell(colIndex, text, type)];
  }
}

// 14. Type — more decimals than the cockpit supports at all (Gross Weight, declares 3).
//     Asserted against the absolute-cap message specifically: the declared-decimals
//     rule below emits a near-identical sentence, and a loose pattern would match
//     either, letting the cap regress undetected.
fixture('14-type-decimal-overflow', "Basic Data row 9 'Gross Weight' set to 4 decimals (cockpit cap is 3)", (doc) => {
  const bd = findSheet(doc, 'Basic Data');
  putCell(getRow(bd, 9), 27, '12.3456', 'Number');
});

// 14b. Type — within the cockpit cap but finer than this column declares.
//      'Total Shelf Life' declares 0 decimals, so 2 decimals trips only this rule.
fixture('14b-type-decimals-exceed-declared', "Basic Data row 9 'Total Shelf Life' set to 2 decimals (column declares 0)", (doc) => {
  const bd = findSheet(doc, 'Basic Data');
  putCell(getRow(bd, 9), 70, '12.25', 'Number');
});

// 14c. Type — non-numeric text in a Number column.
fixture('14c-type-not-a-number', "Basic Data row 9 'Net Weight' set to a non-numeric string", (doc) => {
  const bd = findSheet(doc, 'Basic Data');
  putCell(getRow(bd, 9), 28, 'heavy');
});

// 15. Type — invalid date (Valid From, Date/8).
fixture('15-type-invalid-date', "Basic Data row 9 'Valid From' set to an impossible calendar date", (doc) => {
  const bd = findSheet(doc, 'Basic Data');
  const row9 = getRow(bd, 9);
  let cell = getCell(row9, 14);
  if (!cell) {
    cell = makeCell(14, '31/02/2024');
    row9.Cell = [...asArray(row9.Cell), cell];
  } else {
    setCellText(cell, '31/02/2024');
  }
});

// 16. Value mapping — inconsistent source variants of the same target value.
fixture('16-mapping-inconsistent-variants', "Basic Data row 10 'Product Type' respelled as lowercase with trailing space", (doc) => {
  const bd = findSheet(doc, 'Basic Data');
  const row10 = getRow(bd, 10);
  const cell = getCell(row10, 2);
  setCellText(cell, 'hawa ');
});

/**
 * Rebuilds the whole template as a genuine .xlsx so the format prerequisite fails
 * while every other layer stays clean. A stub workbook would also trip the missing
 * Field List check, which would hide whether the format error fired on its own —
 * and this way the ExcelJS parsing path gets exercised against real content too.
 */
async function writeTemplateAsXlsx(doc, outPath) {
  const wb = new ExcelJS.Workbook();

  for (const sheet of asArray(doc.Workbook.Worksheet)) {
    const ws = wb.addWorksheet(sheet['@_ss:Name']);

    for (const { el: rowEl, index: rowIndex } of resolveRows(sheet)) {
      const row = ws.getRow(rowIndex);
      if (rowEl['@_ss:Hidden'] === '1' || rowEl['@_ss:Hidden'] === 1) row.hidden = true;

      for (const { el: cellEl, index: colIndex } of resolveCells(rowEl)) {
        const data = cellEl.Data;
        if (data === undefined || data === null) continue;
        const text = typeof data === 'object' ? data['#text'] : data;
        if (text === undefined || text === null || text === '') continue;
        const type = typeof data === 'object' ? data['@_ss:Type'] : 'String';
        row.getCell(colIndex).value = type === 'Number' ? Number(text) : String(text);
      }
      row.commit();
    }
  }

  await wb.xlsx.writeFile(outPath);
}

/* ---------- runner ---------- */

async function main() {
  const [, , srcPath, outDir] = process.argv;
  if (!srcPath || !outDir) {
    console.error('Usage: node make-test-fixtures.js <source.xml> <output-dir>');
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const originalXml = fs.readFileSync(srcPath, 'utf-8');

  const manifest = [];

  for (const f of FIXTURES) {
    const doc = loadDoc(originalXml);
    cleanBaseline(doc);
    f.mutate(doc);
    const xml = serialize(doc);
    const outName = `${f.name}.xml`;
    fs.writeFileSync(path.join(outDir, outName), xml, 'utf-8');
    manifest.push({ file: outName, description: f.description });
    console.log(`wrote ${outName.padEnd(38)} ${f.description}`);
  }

  const xlsxName = '01-prereq-wrong-format.xlsx';
  const xlsxDoc = loadDoc(originalXml);
  cleanBaseline(xlsxDoc);
  await writeTemplateAsXlsx(xlsxDoc, path.join(outDir, xlsxName));
  const xlsxDesc = 'Whole template rebuilt as a real .xlsx — only the format check must fail';
  manifest.splice(1, 0, { file: xlsxName, description: xlsxDesc });
  console.log(`wrote ${xlsxName.padEnd(38)} ${xlsxDesc}`);

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n${FIXTURES.length + 1} fixtures written to ${outDir}`);
}

main();
