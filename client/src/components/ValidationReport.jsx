import { useMemo, useState } from 'react';

export default function ValidationReport({ report }) {
  const [severityFilter, setSeverityFilter] = useState('all');
  const { summary, structural, rowIssues, fileName } = report;

  const filteredIssues = useMemo(() => {
    if (severityFilter === 'all') return rowIssues;
    return rowIssues.filter((i) => i.severity === severityFilter);
  }, [rowIssues, severityFilter]);

  const overallStatus = summary.errorCount === 0 ? 'success' : 'error';

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Check Results</h2>
        <p className="panel__description">File: {fileName}</p>
      </div>

      <div className={`report-banner report-banner--${overallStatus}`}>
        {overallStatus === 'success'
          ? 'All rows passed validation.'
          : `${summary.rowsWithErrors} of ${summary.totalRows} row(s) contain errors that must be fixed before migration.`}
      </div>

      <div className="stat-grid">
        <StatTile label="Total Rows" value={summary.totalRows} />
        <StatTile label="Valid Rows" value={summary.validRows} tone="success" />
        <StatTile label="Rows with Errors" value={summary.rowsWithErrors} tone="error" />
        <StatTile label="Errors" value={summary.errorCount} tone="error" />
        <StatTile label="Warnings" value={summary.warningCount} tone="warning" />
      </div>

      {(structural.missingMandatoryColumns.length > 0 || structural.unknownColumns.length > 0) && (
        <div className="panel__section">
          <h3>Structural Check</h3>
          {structural.missingMandatoryColumns.length > 0 && (
            <div className="structural-issue structural-issue--error">
              Missing mandatory column(s): {structural.missingMandatoryColumns.join(', ')}
            </div>
          )}
          {structural.unknownColumns.length > 0 && (
            <div className="structural-issue structural-issue--warning">
              Unrecognized column(s) ignored during check: {structural.unknownColumns.join(', ')}
            </div>
          )}
        </div>
      )}

      <div className="panel__section">
        <div className="section-header-row">
          <h3>Row-Level Issues</h3>
          <div className="filter-group">
            {['all', 'error', 'warning'].map((sev) => (
              <button
                key={sev}
                className={`filter-chip${severityFilter === sev ? ' filter-chip--active' : ''}`}
                onClick={() => setSeverityFilter(sev)}
              >
                {sev === 'all' ? 'All' : sev.charAt(0).toUpperCase() + sev.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {filteredIssues.length === 0 ? (
          <div className="state-message">No issues to display.</div>
        ) : (
          <div className="table-scroll">
            <table className="issues-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Field</th>
                  <th>Severity</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {filteredIssues.map((issue, idx) => (
                  <tr key={idx}>
                    <td>{issue.row}</td>
                    <td>{issue.field}</td>
                    <td>
                      <span className={`badge badge--${issue.severity}`}>{issue.severity}</span>
                    </td>
                    <td>{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value, tone }) {
  return (
    <div className={`stat-tile${tone ? ` stat-tile--${tone}` : ''}`}>
      <div className="stat-tile__value">{value}</div>
      <div className="stat-tile__label">{label}</div>
    </div>
  );
}
