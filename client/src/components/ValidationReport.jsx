import { useMemo, useState } from 'react';
import ImpactDiagram from './ImpactDiagram';

const SECTIONS = [
  { key: 'prerequisites', title: 'Prerequisites', hint: 'File format, size, and template requirements' },
  { key: 'migrationObject', title: 'Migration Object Scope', hint: 'Staging Table availability, restrictions, and load behaviour' },
  { key: 'structure', title: 'Structure Integrity', hint: 'Layer 1 — sheets, columns, hidden technical rows' },
  { key: 'mandatory', title: 'Mandatory Coverage', hint: 'Layer 2 — active rows must fill all mandatory fields' },
  { key: 'keyUniqueness', title: 'Key Uniqueness', hint: 'Layer 2c — every active record must have a unique key' },
  { key: 'referential', title: 'Foreign Key / Referential Integrity', hint: 'Layer 2b — child rows must point at a real header' },
  { key: 'downstream', title: 'Dependent Migration Objects', hint: 'Objects that list this one as a prerequisite' },
  { key: 'types', title: 'Data Type & Length', hint: 'Layer 3 — conformance with the declared type and length' },
  { key: 'mapping', title: 'Value Mapping (Convert Values)', hint: 'Layer 4 — source values needing target mapping' },
  { key: 'checkTables', title: 'Check Tables / Configuration (Simulate)', hint: 'Layer 5 — requires a connected SAP system' },
];

const SEVERITY_RANK = { Error: 0, Warning: 1, Information: 2, Success: 3 };

export default function ValidationReport({ report }) {
  const [filter, setFilter] = useState('all');

  const { summary } = report;
  const ready = summary.migrationReady;

  const filterMessages = useMemo(() => (messages) => {
    const sorted = [...messages].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    if (filter === 'all') return sorted;
    return sorted.filter((m) => m.severity === filter);
  }, [filter]);

  return (
    <div className="report">
      <div className="panel">
        <div className="panel__header">
          <h2>Validation Report</h2>
        </div>

        <dl className="meta-grid">
          <MetaItem label="Template" value={report.fileName} />
          <MetaItem label="Migration Object" value={report.objectName || '—'} />
          <MetaItem label="Saved As" value={report.format} />
          <MetaItem label="Field List" value={report.fieldListDetected ? 'Detected / intact' : 'Missing'} />
          <MetaItem label="Main (key) sheet" value={report.mainSheet || '—'} />
          <MetaItem label="Key field" value={report.keyField || '—'} />
          <MetaItem label="Records" value={report.recordCount} />
          <MetaItem label="Sheets" value={report.sheetCount} />
        </dl>

        <div className={`verdict verdict--${ready ? 'ready' : 'blocked'}`}>
          <span className="verdict__label">Migration-ready</span>
          <span className="verdict__value">{ready ? 'YES' : 'NO'}</span>
          <span className="verdict__detail">
            {ready
              ? 'No blocking errors found. The cockpit should accept this template.'
              : `${summary.errors} blocking error${summary.errors === 1 ? '' : 's'} must be fixed before upload.`}
          </span>
        </div>

        <div className="stat-grid">
          <StatTile label="Errors" value={summary.errors} tone="error" />
          <StatTile label="Warnings" value={summary.warnings} tone="warning" />
          <StatTile label="Information" value={summary.information} tone="info" />
        </div>

        {report.sheetsWithData.length > 0 && (
          <div className="data-sheets">
            <span className="data-sheets__label">Sheets containing data:</span>
            {report.sheetsWithData.map((s) => (
              <span key={s.name} className="chip">{s.name} <em>{s.rows}</em></span>
            ))}
          </div>
        )}
      </div>

      <ImpactDiagram graph={report.impactGraph} downstream={report.downstream} />

      <div className="filter-bar">
        {['all', 'Error', 'Warning', 'Information'].map((sev) => (
          <button
            key={sev}
            className={`filter-chip${filter === sev ? ' filter-chip--active' : ''}`}
            onClick={() => setFilter(sev)}
          >
            {sev === 'all' ? 'All messages' : `${sev}s`}
          </button>
        ))}
      </div>

      {SECTIONS.map(({ key, title, hint }) => {
        const messages = report.sections[key] || [];
        const visible = filterMessages(messages);
        const errorCount = messages.filter((m) => m.severity === 'Error').length;
        const warnCount = messages.filter((m) => m.severity === 'Warning').length;

        const status = errorCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass';

        return (
          <div className="panel" key={key}>
            <div className="section-head">
              <div>
                <h3>{title}</h3>
                <p className="section-hint">{hint}</p>
              </div>
              <span className={`status-pill status-pill--${status}`}>
                {status === 'fail' ? `FAIL · ${errorCount}` : status === 'warn' ? `REVIEW · ${warnCount}` : 'PASS'}
              </span>
            </div>

            {visible.length === 0 ? (
              <p className="state-message">No messages match the current filter.</p>
            ) : (
              <ul className="message-list">
                {visible.map((m, i) => (
                  <li key={i} className={`message message--${m.severity.toLowerCase()}`}>
                    <span className={`badge badge--${m.severity.toLowerCase()}`}>{m.severity}</span>
                    <div className="message__body">
                      {(m.sheet || m.cell || m.row || m.field) && (
                        <div className="message__location">
                          {m.sheet && <span className="loc loc--sheet">{m.sheet}</span>}
                          {m.cell && <span className="loc loc--cell">{m.cell}</span>}
                          {!m.cell && m.row && <span className="loc loc--cell">row {m.row}</span>}
                          {m.field && <span className="loc loc--field">{m.field}</span>}
                        </div>
                      )}
                      <div className="message__text">{m.message}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MetaItem({ label, value }) {
  return (
    <div className="meta-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StatTile({ label, value, tone }) {
  return (
    <div className={`stat-tile stat-tile--${tone}`}>
      <div className="stat-tile__value">{value}</div>
      <div className="stat-tile__label">{label}</div>
    </div>
  );
}
