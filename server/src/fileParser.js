const ExcelJS = require('exceljs');
const { Readable } = require('stream');

function cellToPlainValue(cellValue) {
  if (cellValue === null || cellValue === undefined) return null;
  if (cellValue instanceof Date) return cellValue;
  if (typeof cellValue === 'object') {
    if ('result' in cellValue) return cellToPlainValue(cellValue.result); // formula cell
    if ('text' in cellValue) return cellValue.text; // rich text
    if ('richText' in cellValue) return cellValue.richText.map((r) => r.text).join('');
  }
  return cellValue;
}

async function parseFile(buffer, originalName) {
  const isCsv = /\.csv$/i.test(originalName || '');
  const workbook = new ExcelJS.Workbook();

  if (isCsv) {
    const stream = Readable.from(buffer.toString('utf-8'));
    await workbook.csv.read(stream);
  } else {
    await workbook.xlsx.load(buffer);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return { headers: [], rows: [] };

  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    const value = cellToPlainValue(cell.value);
    headers.push(value == null ? '' : String(value).trim());
  });

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = {};
    let hasAnyValue = false;
    headers.forEach((header, idx) => {
      if (!header) return;
      const cell = row.getCell(idx + 1);
      const value = cellToPlainValue(cell.value);
      if (value !== null && value !== undefined && value !== '') hasAnyValue = true;
      obj[header] = value === undefined ? null : value;
    });
    if (hasAnyValue) rows.push(obj);
  });

  return { headers: headers.filter((h) => h !== ''), rows };
}

module.exports = { parseFile };
