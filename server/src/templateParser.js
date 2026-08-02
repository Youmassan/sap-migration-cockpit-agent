const ExcelJS = require('exceljs');
const { XMLParser } = require('fast-xml-parser');

const FIELD_LIST_SHEET = 'Field List';

// Field List layout (header on row 4)
const FL_HEADER_ROW = 4;
const FL_COL = { sheet: 2, group: 3, field: 4, importance: 5, type: 6, length: 7, decimal: 8, sapStructure: 9, sapField: 10 };

// Data sheet layout
const DS_ROW = { structure: 4, techField: 5, typeSpec: 6, group: 7, header: 8, firstData: 9 };

const MANDATORY_IMPORTANCE = 'mandatory for sheet';

function cellText(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('result' in value) return cellText(value.result);
    if ('text' in value) return value.text;
    if ('error' in value) return `#${value.error}`;
  }
  return value;
}

function asString(value) {
  const v = cellText(value);
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function isBlank(value) {
  const v = cellText(value);
  if (v === null || v === undefined) return true;
  if (v instanceof Date) return false;
  return String(v).trim() === '';
}

/**
 * Row 6 of each data sheet holds SAP's internal type spec, e.g. "ETE;80;0;C;80;0".
 * Segments: kind ; length ; decimals ; category ; outputLength ; outputDecimals
 */
function parseTypeSpec(raw) {
  const str = asString(raw);
  if (!str) return null;
  const parts = str.split(';').map((p) => p.trim());
  const length = Number(parts[1]);
  const decimals = Number(parts[2]);
  return {
    raw: str,
    kind: parts[0] || null,
    length: Number.isFinite(length) ? length : null,
    decimals: Number.isFinite(decimals) ? decimals : null,
    category: parts[3] || null,
  };
}

/**
 * Row 8 headers carry the display name plus an embedded description block, e.g.
 * "Product Number*\n\nA key that uniquely identifies...\n\nType: Text\nLength: 80".
 * The leading line is the field name; a trailing '*' marks it mandatory.
 */
function parseHeaderCell(raw) {
  const str = asString(raw);
  if (!str) return null;
  const firstLine = str.split('\n')[0].trim();
  const mandatory = firstLine.endsWith('*');
  const name = (mandatory ? firstLine.slice(0, -1) : firstLine).trim();
  const typeMatch = /Type:\s*([A-Za-z]+)/.exec(str);
  const lengthMatch = /Length:\s*(\d+)/.exec(str);
  return {
    name,
    mandatory,
    declaredType: typeMatch ? typeMatch[1] : null,
    declaredLength: lengthMatch ? Number(lengthMatch[1]) : null,
    fullText: str,
  };
}

function stripMandatorySuffix(sheetLabel) {
  return sheetLabel.replace(/\s*\((?:mandatory|Mandatory)\)\s*$/, '').trim();
}

function parseFieldList(worksheet) {
  if (!worksheet) return null;

  const headerRow = worksheet.getRow(FL_HEADER_ROW);
  const headerLabels = {
    sheet: asString(headerRow.getCell(FL_COL.sheet).value),
    field: asString(headerRow.getCell(FL_COL.field).value),
    importance: asString(headerRow.getCell(FL_COL.importance).value),
    type: asString(headerRow.getCell(FL_COL.type).value),
    sapStructure: asString(headerRow.getCell(FL_COL.sapStructure).value),
    sapField: asString(headerRow.getCell(FL_COL.sapField).value),
  };

  const objectName = (() => {
    const title = asString(worksheet.getRow(1).getCell(1).value);
    const m = /Field List for Migration Object:\s*(.+)$/i.exec(title);
    return m ? m[1].trim() : null;
  })();

  const sheets = [];
  let current = null;

  for (let r = FL_HEADER_ROW + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const sheetLabel = asString(row.getCell(FL_COL.sheet).value);
    const fieldName = asString(row.getCell(FL_COL.field).value);

    // A sheet banner row has no field entry: real Excel exports leave the merged-across
    // columns sparse (fieldName blank), while a hand-built XML may duplicate the label
    // into every column instead (fieldName === sheetLabel). Either shape is a banner.
    const isBanner = Boolean(sheetLabel) && (!fieldName || fieldName === sheetLabel);

    if (isBanner) {
      current = {
        label: sheetLabel,
        name: stripMandatorySuffix(sheetLabel),
        mandatory: /\(mandatory\)/i.test(sheetLabel),
        fields: [],
      };
      sheets.push(current);
      continue;
    }

    if (!current || !fieldName) continue;

    current.fields.push({
      group: asString(row.getCell(FL_COL.group).value) || null,
      name: fieldName,
      mandatory: asString(row.getCell(FL_COL.importance).value).toLowerCase() === MANDATORY_IMPORTANCE,
      type: asString(row.getCell(FL_COL.type).value) || null,
      length: (() => { const n = Number(asString(row.getCell(FL_COL.length).value)); return Number.isFinite(n) ? n : null; })(),
      decimals: (() => { const n = Number(asString(row.getCell(FL_COL.decimal).value)); return Number.isFinite(n) ? n : null; })(),
      sapStructure: asString(row.getCell(FL_COL.sapStructure).value) || null,
      sapField: asString(row.getCell(FL_COL.sapField).value) || null,
    });
  }

  return { objectName, headerLabels, sheets };
}

function parseDataSheet(worksheet) {
  const structureRow = worksheet.getRow(DS_ROW.structure);
  const techRow = worksheet.getRow(DS_ROW.techField);
  const specRow = worksheet.getRow(DS_ROW.typeSpec);
  const groupRow = worksheet.getRow(DS_ROW.group);
  const headerRow = worksheet.getRow(DS_ROW.header);

  const columns = [];
  for (let c = 1; c <= worksheet.columnCount; c++) {
    const header = parseHeaderCell(headerRow.getCell(c).value);
    const techField = asString(techRow.getCell(c).value) || null;
    if (!header && !techField) continue;
    columns.push({
      index: c,
      name: header ? header.name : null,
      mandatory: header ? header.mandatory : false,
      declaredType: header ? header.declaredType : null,
      declaredLength: header ? header.declaredLength : null,
      headerText: header ? header.fullText : null,
      techField,
      group: asString(groupRow.getCell(c).value) || null,
      typeSpec: parseTypeSpec(specRow.getCell(c).value),
    });
  }

  const rows = [];
  for (let r = DS_ROW.firstData; r <= worksheet.rowCount; r++) {
    const excelRow = worksheet.getRow(r);
    const values = {};
    let hasAnyValue = false;
    let hasFormula = false;

    for (const col of columns) {
      const cell = excelRow.getCell(col.index);
      if (cell.formula || (cell.value && typeof cell.value === 'object' && 'formula' in cell.value)) hasFormula = true;
      const value = cellText(cell.value);
      values[col.index] = value;
      if (!isBlank(value)) hasAnyValue = true;
    }

    if (hasAnyValue) rows.push({ rowNumber: r, values, hasFormula });
  }

  return {
    name: worksheet.name,
    sapStructure: asString(structureRow.getCell(1).value) || null,
    columns,
    rows,
    hiddenRowsIntact: {
      structure: !isBlank(structureRow.getCell(1).value),
      techField: columns.some((c) => c.techField),
      typeSpec: columns.some((c) => c.typeSpec),
    },
    rowVisibility: {
      structureHidden: structureRow.hidden === true,
      techFieldHidden: techRow.hidden === true,
      typeSpecHidden: specRow.hidden === true,
    },
  };
}

/**
 * SpreadsheetML 2003 stores every row/cell as XML with optional ss:Index jumps for
 * sparse data, so positions must be tracked manually rather than by array order.
 */
function worksheetFromSpreadsheetML(xmlWorksheet) {
  const table = xmlWorksheet.Table;
  if (!table) return null;

  const xmlRows = table.Row ? (Array.isArray(table.Row) ? table.Row : [table.Row]) : [];
  const grid = new Map();
  const hiddenRows = new Set();
  let maxCol = 0;
  let rowIndex = 0;

  for (const xmlRow of xmlRows) {
    rowIndex = xmlRow['@_ss:Index'] ? Number(xmlRow['@_ss:Index']) : rowIndex + 1;
    if (xmlRow['@_ss:Hidden'] === '1' || xmlRow['@_ss:Hidden'] === 1) hiddenRows.add(rowIndex);

    const cells = xmlRow.Cell ? (Array.isArray(xmlRow.Cell) ? xmlRow.Cell : [xmlRow.Cell]) : [];
    let colIndex = 0;

    for (const cell of cells) {
      colIndex = cell['@_ss:Index'] ? Number(cell['@_ss:Index']) : colIndex + 1;
      const data = cell.Data;
      let value = null;
      if (data !== undefined && data !== null) {
        value = typeof data === 'object' ? (data['#text'] !== undefined ? data['#text'] : null) : data;
      }
      const formula = cell['@_ss:Formula'] || null;
      grid.set(`${rowIndex}:${colIndex}`, { value, formula });
      if (colIndex > maxCol) maxCol = colIndex;
      const merge = Number(cell['@_ss:MergeAcross'] || 0);
      if (merge > 0) colIndex += merge;
    }
  }

  const rowCount = Math.max(0, ...Array.from(grid.keys()).map((k) => Number(k.split(':')[0])));

  return {
    name: xmlWorksheet['@_ss:Name'],
    rowCount,
    columnCount: maxCol,
    getRow(r) {
      return {
        hidden: hiddenRows.has(r),
        getCell(c) {
          const entry = grid.get(`${r}:${c}`);
          return { value: entry ? entry.value : null, formula: entry ? entry.formula : null };
        },
      };
    },
  };
}

async function loadWorkbook(buffer, originalName) {
  const isXmlSpreadsheet = /\.xml$/i.test(originalName || '');

  if (isXmlSpreadsheet) {
    // htmlEntities decodes the numeric references Excel writes (&#10; for the newlines
    // that separate a row-8 header's field name from its description block).
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseTagValue: false,
      trimValues: false,
      processEntities: true,
      htmlEntities: true,
    });
    const doc = parser.parse(buffer.toString('utf-8'));
    const workbookNode = doc.Workbook;
    if (!workbookNode) throw new Error('Not a valid XML Spreadsheet 2003 file (missing <Workbook> root).');

    const rawSheets = workbookNode.Worksheet
      ? (Array.isArray(workbookNode.Worksheet) ? workbookNode.Worksheet : [workbookNode.Worksheet])
      : [];

    const worksheets = rawSheets.map(worksheetFromSpreadsheetML).filter(Boolean);
    return {
      format: 'xml2003',
      worksheets,
      getWorksheet: (name) => worksheets.find((w) => w.name === name) || null,
    };
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const worksheets = [];
  wb.eachSheet((sheet) => worksheets.push(sheet));
  return {
    format: 'xlsx',
    worksheets,
    getWorksheet: (name) => wb.getWorksheet(name) || null,
  };
}

async function parseTemplate(buffer, originalName) {
  const workbook = await loadWorkbook(buffer, originalName);

  const sheetNames = workbook.worksheets.map((w) => w.name);
  const fieldListSheet = workbook.getWorksheet(FIELD_LIST_SHEET);
  const fieldList = fieldListSheet ? parseFieldList(fieldListSheet) : null;

  const fieldListIndex = sheetNames.indexOf(FIELD_LIST_SHEET);
  const dataSheetNames = fieldListIndex >= 0 ? sheetNames.slice(fieldListIndex + 1) : [];

  const dataSheets = dataSheetNames
    .map((name) => workbook.getWorksheet(name))
    .filter(Boolean)
    .map(parseDataSheet);

  return {
    format: workbook.format,
    fileName: originalName,
    sheetNames,
    fieldList,
    dataSheets,
    mainSheet: dataSheets[0] || null,
  };
}

module.exports = {
  parseTemplate,
  parseTypeSpec,
  parseHeaderCell,
  stripMandatorySuffix,
  isBlank,
  asString,
  cellText,
  FIELD_LIST_SHEET,
  DS_ROW,
};
