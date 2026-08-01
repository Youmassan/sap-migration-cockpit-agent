const DATE_FORMATS_HINT = 'YYYY-MM-DD (or a valid Excel date)';

function isEmptyValue(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function parseDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    // Excel serial date (days since 1899-12-30)
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = value * 24 * 60 * 60 * 1000;
    const d = new Date(excelEpoch.getTime() + ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const str = String(value).trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (isoMatch) {
    const d = new Date(Date.UTC(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function checkField(field, rawValue, headers, issues, rowNumber) {
  if (!headers.includes(field.name)) return; // structural issue already reported

  const empty = isEmptyValue(rawValue);

  if (field.mandatory && empty) {
    issues.push({ row: rowNumber, field: field.name, severity: 'error', message: `${field.label || field.name} is mandatory and must not be empty` });
    return;
  }
  if (empty) return;

  const strValue = String(rawValue).trim();

  if (field.type === 'string') {
    if (field.maxLength && strValue.length > field.maxLength) {
      issues.push({ row: rowNumber, field: field.name, severity: 'error', message: `${field.label || field.name} exceeds maximum length of ${field.maxLength} (got ${strValue.length})` });
    }
    if (field.format) {
      const re = new RegExp(field.format);
      if (!re.test(strValue)) {
        issues.push({ row: rowNumber, field: field.name, severity: 'error', message: `${field.label || field.name} does not match required format${field.formatDescription ? ` (${field.formatDescription})` : ''}` });
      }
    }
    if (field.lookup && !field.lookup.includes(strValue)) {
      issues.push({ row: rowNumber, field: field.name, severity: 'error', message: `${field.label || field.name} value "${strValue}" is not a valid reference value (allowed: ${field.lookup.join(', ')})` });
    }
  } else if (field.type === 'number') {
    const num = Number(strValue);
    if (Number.isNaN(num)) {
      issues.push({ row: rowNumber, field: field.name, severity: 'error', message: `${field.label || field.name} must be a valid number` });
    } else if (typeof field.min === 'number' && num < field.min) {
      issues.push({ row: rowNumber, field: field.name, severity: 'error', message: `${field.label || field.name} must be >= ${field.min}` });
    }
  } else if (field.type === 'date') {
    const d = parseDate(rawValue);
    if (!d) {
      issues.push({ row: rowNumber, field: field.name, severity: 'error', message: `${field.label || field.name} must be a valid date (${DATE_FORMATS_HINT})` });
    }
  }
}

function getFieldValue(config, row, fieldName) {
  const field = config.fields.find((f) => f.name === fieldName);
  return { field, value: row[fieldName] };
}

function checkCrossFieldRules(config, headers, row, issues, rowNumber) {
  for (const rule of config.crossFieldRules || []) {
    if (rule.type === 'compare') {
      const { value: leftRaw } = getFieldValue(config, row, rule.left);
      const { value: rightRaw } = getFieldValue(config, row, rule.right);
      if (isEmptyValue(leftRaw) || isEmptyValue(rightRaw)) continue;
      const left = Number(leftRaw);
      const right = Number(rightRaw);
      if (Number.isNaN(left) || Number.isNaN(right)) continue;
      let ok = true;
      switch (rule.operator) {
        case '<=': ok = left <= right; break;
        case '<': ok = left < right; break;
        case '>=': ok = left >= right; break;
        case '>': ok = left > right; break;
        case '==': ok = left === right; break;
        default: ok = true;
      }
      if (!ok) {
        issues.push({ row: rowNumber, field: rule.left, severity: 'error', message: rule.message || `${rule.left} ${rule.operator} ${rule.right} check failed` });
      }
    } else if (rule.type === 'requiredIf') {
      const { value: condValue } = getFieldValue(config, row, rule.if.field);
      const conditionMet = rule.if.present ? !isEmptyValue(condValue) : isEmptyValue(condValue);
      if (conditionMet) {
        const { value: thenValue } = getFieldValue(config, row, rule.then);
        if (isEmptyValue(thenValue)) {
          issues.push({ row: rowNumber, field: rule.then, severity: 'error', message: rule.message || `${rule.then} is required` });
        }
      }
    } else if (rule.type === 'dateNotFuture') {
      const { value: raw } = getFieldValue(config, row, rule.field);
      if (isEmptyValue(raw)) continue;
      const d = parseDate(raw);
      if (d && d.getTime() > Date.now()) {
        issues.push({ row: rowNumber, field: rule.field, severity: 'error', message: rule.message || `${rule.field} cannot be in the future` });
      }
    }
  }
}

function validate(config, headers, dataRows) {
  const expectedFieldNames = config.fields.map((f) => f.name);
  const missingMandatoryColumns = config.fields
    .filter((f) => f.mandatory && !headers.includes(f.name))
    .map((f) => f.name);
  const unknownColumns = headers.filter((h) => !expectedFieldNames.includes(h));

  const rowIssues = [];

  dataRows.forEach((row, idx) => {
    const rowNumber = idx + 2; // +1 for 1-index, +1 for header row
    for (const field of config.fields) {
      checkField(field, row[field.name], headers, rowIssues, rowNumber);
    }
    checkCrossFieldRules(config, headers, row, rowIssues, rowNumber);
  });

  // Duplicate key detection across all rows
  const keyFields = config.keyFields || [];
  if (keyFields.length > 0) {
    const keyMap = new Map();
    dataRows.forEach((row, idx) => {
      const rowNumber = idx + 2;
      const keyParts = keyFields.map((kf) => (row[kf] === undefined || row[kf] === null ? '' : String(row[kf]).trim()));
      if (keyParts.some((p) => p === '')) return; // missing key already flagged as mandatory error
      const key = keyParts.join('|');
      if (!keyMap.has(key)) keyMap.set(key, []);
      keyMap.get(key).push(rowNumber);
    });
    for (const [key, rows] of keyMap.entries()) {
      if (rows.length > 1) {
        for (const rowNumber of rows) {
          const others = rows.filter((r) => r !== rowNumber);
          rowIssues.push({
            row: rowNumber,
            field: keyFields.join('+'),
            severity: 'error',
            message: `Duplicate key value "${key.split('|').join(' / ')}" also found in row(s) ${others.join(', ')}`,
          });
        }
      }
    }
  }

  const rowsWithErrors = new Set(rowIssues.filter((i) => i.severity === 'error').map((i) => i.row));
  const rowsWithWarnings = new Set(rowIssues.filter((i) => i.severity === 'warning').map((i) => i.row));

  const summary = {
    totalRows: dataRows.length,
    errorCount: rowIssues.filter((i) => i.severity === 'error').length,
    warningCount: rowIssues.filter((i) => i.severity === 'warning').length,
    rowsWithErrors: rowsWithErrors.size,
    rowsWithWarnings: rowsWithWarnings.size,
    validRows: dataRows.length - rowsWithErrors.size,
  };

  return {
    summary,
    structural: { missingMandatoryColumns, unknownColumns },
    rowIssues: rowIssues.sort((a, b) => a.row - b.row),
  };
}

module.exports = { validate, isEmptyValue, parseDate };
