const path = require('path');
const ExcelJS = require('exceljs');

const OUT_DIR = path.join(__dirname, '..', 'sample-data');

async function writeSheet(fileName, headers, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  await workbook.xlsx.writeFile(path.join(OUT_DIR, fileName));
  console.log(`wrote ${fileName}`);
}

async function main() {
  const customerHeaders = ['CustomerNumber', 'Name', 'Country', 'Currency', 'PaymentTerms', 'Email', 'CreditLimit', 'ValidFrom'];

  await writeSheet('customer-master-valid.xlsx', customerHeaders, [
    ['CUST0001', 'Acme Corporation', 'US', 'USD', '0001', 'ap@acme.example.com', 50000, '2024-01-15'],
    ['CUST0002', 'Beta Industries', 'DE', 'EUR', 'NT30', 'finance@beta.example.com', 25000, '2024-03-01'],
    ['CUST0003', 'Cyan Retail Ltd', 'GB', 'GBP', '0002', 'billing@cyan.example.com', 10000, '2023-11-20'],
  ]);

  await writeSheet('customer-master-invalid.xlsx', customerHeaders, [
    // missing mandatory Name
    ['CUST0010', '', 'US', 'USD', '0001', 'a@b.com', 1000, '2024-01-01'],
    // invalid country + currency lookup, bad email format
    ['CUST0011', 'Delta LLC', 'ZZ', 'XXX', '0001', 'not-an-email', 2000, '2024-01-01'],
    // negative credit limit, future valid-from date
    ['CUST0012', 'Epsilon GmbH', 'DE', 'EUR', '0002', 'x@epsilon.example.com', -500, '2099-01-01'],
    // duplicate customer number of CUST0012
    ['CUST0012', 'Epsilon GmbH Duplicate', 'DE', 'EUR', '0002', 'y@epsilon.example.com', 500, '2024-01-01'],
  ]);

  const materialHeaders = ['MaterialNumber', 'Description', 'MaterialType', 'BaseUnit', 'Plant', 'GrossWeight', 'NetWeight', 'WeightUnit', 'CreatedOn'];

  await writeSheet('material-master-valid.xlsx', materialHeaders, [
    ['MAT-00001', 'Steel Bracket 10mm', 'FERT', 'EA', '1000', 2.5, 2.1, 'KG', '2024-02-10'],
    ['MAT-00002', 'Raw Aluminium Sheet', 'ROH', 'KG', '2000', 15, 14.5, 'KG', '2024-04-05'],
    ['MAT-00003', 'Packaging Box Large', 'HAWA', 'BOX', '1000', null, null, null, '2023-12-01'],
  ]);

  await writeSheet('material-master-invalid.xlsx', materialHeaders, [
    // net weight greater than gross weight
    ['MAT-10001', 'Faulty Widget', 'FERT', 'EA', '1000', 1.0, 5.0, 'KG', '2024-01-01'],
    // gross weight present but no weight unit
    ['MAT-10002', 'Missing Unit Widget', 'FERT', 'EA', '1000', 3.0, 2.0, '', '2024-01-01'],
    // invalid material type + invalid plant lookup, future created-on date
    ['MAT-10003', 'Bad Type Widget', 'XYZ', 'EA', '9999', 1.0, 0.8, 'KG', '2099-06-01'],
    // duplicate material number of MAT-10003
    ['MAT-10003', 'Bad Type Widget Duplicate', 'FERT', 'EA', '1000', 1.0, 0.8, 'KG', '2024-01-01'],
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
