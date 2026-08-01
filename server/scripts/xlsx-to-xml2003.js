/** Test helper: converts an .xlsx cockpit template to XML Spreadsheet 2003 so the
 *  SpreadsheetML parser path can be exercised without Excel installed. */
const ExcelJS = require('exceljs');

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function cellVal(c){ const x=c.value; if(x==null)return null;
  if(typeof x==='object'){ if('richText' in x) return x.richText.map(r=>r.text).join('');
    if('result' in x) return x.result; if('text' in x) return x.text; }
  return x; }

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(process.argv[2]);
  const out = [];
  out.push('<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>');
  out.push('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">');

  wb.eachSheet((sheet) => {
    out.push(`<Worksheet ss:Name="${esc(sheet.name)}">`);
    out.push('<Table>');
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const hidden = row.hidden ? ' ss:Hidden="1"' : '';
      const cells = [];
      for (let c = 1; c <= sheet.columnCount; c++) {
        const v = cellVal(row.getCell(c));
        if (v === null || v === undefined || v === '') continue;
        const type = typeof v === 'number' ? 'Number' : 'String';
        const text = v instanceof Date ? v.toISOString().slice(0,10) : v;
        cells.push(`<Cell ss:Index="${c}"><Data ss:Type="${type}">${esc(text)}</Data></Cell>`);
      }
      if (cells.length === 0 && !row.hidden) continue;
      out.push(`<Row ss:Index="${r}"${hidden}>${cells.join('')}</Row>`);
    }
    out.push('</Table>');
    out.push('</Worksheet>');
  });

  out.push('</Workbook>');
  require('fs').writeFileSync(process.argv[3], out.join('\n'), 'utf-8');
  console.log('wrote', process.argv[3]);
})();
