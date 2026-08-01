import { useMemo, useState } from 'react';

const STATUS_FILL = {
  error: 'var(--diagram-error-bg)',
  blocked: 'var(--diagram-blocked-bg)',
  clean: 'var(--diagram-clean-bg)',
  empty: 'var(--diagram-empty-bg)',
};

const STATUS_STROKE = {
  error: 'var(--sap-negative)',
  blocked: 'var(--sap-critical)',
  clean: 'var(--sap-positive)',
  empty: 'var(--sap-border)',
};

const BOX_W = 190;
const BOX_H = 64;
const GAP_X = 26;
const GAP_Y = 72;
const PER_ROW = 3;

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Sheet-level cascade inside one template: a failed header blocks its child rows. */
function TemplateCascade({ graph }) {
  const main = graph.nodes.find((n) => n.role === 'main');
  const children = graph.nodes.filter((n) => n.role === 'child');

  const rows = Math.max(1, Math.ceil(children.length / PER_ROW));
  const perRow = Math.min(children.length, PER_ROW) || 1;
  const width = perRow * BOX_W + (perRow - 1) * GAP_X;
  const height = BOX_H + GAP_Y + rows * BOX_H + (rows - 1) * (GAP_Y - 28);

  const mainX = (width - BOX_W) / 2;

  const childPositions = children.map((node, i) => {
    const row = Math.floor(i / PER_ROW);
    const col = i % PER_ROW;
    const inRow = Math.min(children.length - row * PER_ROW, PER_ROW);
    const rowWidth = inRow * BOX_W + (inRow - 1) * GAP_X;
    return {
      node,
      x: (width - rowWidth) / 2 + col * (BOX_W + GAP_X),
      y: BOX_H + GAP_Y + row * (BOX_H + GAP_Y - 28),
    };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="diagram-svg" role="img"
         aria-label={`Cascade from ${graph.mainSheet} to dependent sheets`}>
      {childPositions.map(({ node, x, y }) => {
        const startX = mainX + BOX_W / 2;
        const startY = BOX_H;
        const endX = x + BOX_W / 2;
        const midY = (startY + y) / 2;
        return (
          <g key={`edge-${node.id}`}>
            <path
              d={`M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${y}`}
              fill="none"
              stroke={node.blockedRows > 0 ? 'var(--sap-critical)' : 'var(--sap-border)'}
              strokeWidth={node.blockedRows > 0 ? 2 : 1.25}
              strokeDasharray={node.blockedRows > 0 ? '5 3' : undefined}
            />
          </g>
        );
      })}

      <NodeBox node={main} x={mainX} y={0} subtitle={`key: ${graph.keyField}`} />

      {childPositions.map(({ node, x, y }) => (
        <NodeBox key={node.id} node={node} x={x} y={y} />
      ))}
    </svg>
  );
}

function NodeBox({ node, x, y, subtitle }) {
  const detail = node.blockedRows > 0
    ? `${node.blockedRows} row(s) blocked`
    : node.ownErrorRows > 0
      ? `${node.ownErrorRows} row(s) with errors`
      : `${node.totalRows} row(s) OK`;

  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect width={BOX_W} height={BOX_H} rx="6"
            fill={STATUS_FILL[node.status]} stroke={STATUS_STROKE[node.status]} strokeWidth="1.5" />
      <text x="12" y="22" className="diagram-node-title">{truncate(node.sheet, 24)}</text>
      <text x="12" y="39" className="diagram-node-meta">{detail}</text>
      <text x="12" y="54" className="diagram-node-meta">{subtitle || `${node.totalRows} row(s) total`}</text>
    </g>
  );
}

/** Object-level cascade: prerequisites feed this object, dependents wait on it. */
function ObjectCascade({ downstream }) {
  const byLevel = useMemo(() => {
    const map = new Map();
    for (const item of downstream.transitiveDependents) {
      if (!map.has(item.level)) map.set(item.level, []);
      map.get(item.level).push(item.name);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [downstream]);

  const colW = 168;
  const rowH = 34;
  const maxRows = Math.max(
    downstream.dependsOn.length,
    ...byLevel.map(([, names]) => Math.min(names.length, 5)),
    3
  );
  const width = colW * (byLevel.length + 2) + 40;
  const height = Math.max(220, maxRows * rowH + 110);
  const centerY = height / 2;

  const rootX = colW + 20;
  const blocked = downstream.blocked;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="diagram-svg" role="img"
         aria-label={`Migration objects blocked when ${downstream.object} fails`}>
      {/* upstream prerequisites */}
      {downstream.dependsOn.slice(0, 5).map((name, i) => {
        const y = centerY - (Math.min(downstream.dependsOn.length, 5) * rowH) / 2 + i * rowH;
        return (
          <g key={`pre-${name}`}>
            <rect x="10" y={y} width={colW - 30} height={rowH - 8} rx="4"
                  fill="var(--diagram-empty-bg)" stroke="var(--sap-border)" />
            <text x="20" y={y + 17} className="diagram-chip-text">{truncate(name, 20)}</text>
            <path d={`M ${colW - 20} ${y + (rowH - 8) / 2} L ${rootX} ${centerY}`}
                  stroke="var(--sap-border)" strokeWidth="1" fill="none" />
          </g>
        );
      })}
      {downstream.dependsOn.length > 0 && (
        <text x="10" y="18" className="diagram-col-label">Prerequisites</text>
      )}

      {/* the object under validation */}
      <rect x={rootX} y={centerY - 34} width={colW - 24} height={68} rx="6"
            fill={blocked ? 'var(--diagram-error-bg)' : 'var(--diagram-clean-bg)'}
            stroke={blocked ? 'var(--sap-negative)' : 'var(--sap-positive)'} strokeWidth="2" />
      <text x={rootX + 12} y={centerY - 12} className="diagram-node-title">{truncate(downstream.object, 18)}</text>
      <text x={rootX + 12} y={centerY + 6} className="diagram-node-meta">
        {blocked ? 'HAS BLOCKING ERRORS' : 'no blocking errors'}
      </text>
      <text x={rootX + 12} y={centerY + 22} className="diagram-node-meta">
        {downstream.totals.transitive} dependent object(s)
      </text>

      {/* dependents grouped by how far down the chain they sit */}
      {byLevel.map(([level, names], colIndex) => {
        const x = rootX + (colIndex + 1) * colW;
        const shown = names.slice(0, 5);
        const startY = centerY - (shown.length * rowH) / 2;
        // Fan out from the right edge of the previous column so connectors stay
        // in the gutter instead of crossing the boxes.
        const sourceX = colIndex === 0 ? rootX + colW - 24 : x - colW + (colW - 30);
        return (
          <g key={`lvl-${level}`}>
            <text x={x} y="18" className="diagram-col-label">
              {level === 1 ? 'Direct dependents' : `Level ${level}`} ({names.length})
            </text>
            {shown.map((name, i) => {
              const y = startY + i * rowH;
              const endY = y + (rowH - 8) / 2;
              const midX = (sourceX + x) / 2;
              return (
                <g key={name}>
                  <path d={`M ${sourceX} ${centerY} C ${midX} ${centerY}, ${midX} ${endY}, ${x} ${endY}`}
                        stroke={blocked ? 'var(--sap-negative)' : 'var(--sap-border)'}
                        strokeWidth="1" fill="none" opacity="0.5"
                        strokeDasharray={blocked ? '4 3' : undefined} />
                  <rect x={x} y={y} width={colW - 30} height={rowH - 8} rx="4"
                        fill={blocked ? 'var(--diagram-blocked-bg)' : 'var(--diagram-empty-bg)'}
                        stroke={blocked ? 'var(--sap-critical)' : 'var(--sap-border)'} />
                  <text x={x + 10} y={y + 17} className="diagram-chip-text">{truncate(name, 20)}</text>
                </g>
              );
            })}
            {names.length > shown.length && (
              <text x={x + 10} y={startY + shown.length * rowH + 14} className="diagram-more-text">
                +{names.length - shown.length} more
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function buildMermaid(graph, downstream) {
  const lines = ['flowchart TD'];

  if (graph) {
    const id = (name) => name.replace(/[^A-Za-z0-9]/g, '_');
    lines.push('  subgraph template["Within the template"]');
    for (const node of graph.nodes) {
      const detail = node.blockedRows > 0
        ? `${node.blockedRows} blocked`
        : node.ownErrorRows > 0 ? `${node.ownErrorRows} failing` : `${node.totalRows} OK`;
      lines.push(`    ${id(node.id)}["${node.sheet}<br/>${detail}"]`);
    }
    for (const edge of graph.edges) {
      lines.push(`    ${id(edge.from)} -->|${edge.viaField}| ${id(edge.to)}`);
    }
    lines.push('  end');

    for (const node of graph.nodes) {
      if (node.status === 'error') lines.push(`  class ${id(node.id)} failed;`);
      else if (node.status === 'blocked') lines.push(`  class ${id(node.id)} blocked;`);
    }
  }

  if (downstream && downstream.totals.direct > 0) {
    const oid = downstream.object.replace(/[^A-Za-z0-9]/g, '_');
    lines.push(`  ${oid}["${downstream.object}"]`);
    for (const prereq of downstream.dependsOn) {
      const pid = prereq.replace(/[^A-Za-z0-9]/g, '_');
      lines.push(`  ${pid}["${prereq}"] --> ${oid}`);
    }
    for (const name of downstream.directDependents.slice(0, 12)) {
      const did = name.replace(/[^A-Za-z0-9]/g, '_');
      lines.push(`  ${oid} --> ${did}["${name}"]`);
      if (downstream.blocked) lines.push(`  class ${did} blocked;`);
    }
    if (downstream.directDependents.length > 12) {
      lines.push(`  ${oid} --> more["+${downstream.directDependents.length - 12} more dependent objects"]`);
    }
    if (downstream.blocked) lines.push(`  class ${oid} failed;`);
  }

  lines.push('  classDef failed fill:#ffebeb,stroke:#bb0000,stroke-width:2px;');
  lines.push('  classDef blocked fill:#fef6f1,stroke:#e9730c,stroke-width:2px;');
  return lines.join('\n');
}

export default function ImpactDiagram({ graph, downstream }) {
  const [view, setView] = useState('template');
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const mermaid = useMemo(() => buildMermaid(graph, downstream), [graph, downstream]);

  const hasTemplate = graph && graph.nodes.length > 1;
  const hasObjects = downstream && downstream.totals.direct > 0;
  if (!hasTemplate && !hasObjects) return null;

  async function copyMermaid() {
    try {
      await navigator.clipboard.writeText(mermaid);
      setCopied('yes');
    } catch {
      // The clipboard API refuses when the document is not focused; the source
      // block below stays available so the diagram can always be copied by hand.
      setCopied('failed');
    }
    setTimeout(() => setCopied(false), 2500);
  }

  const active = view === 'template' && hasTemplate ? 'template' : hasObjects ? 'objects' : 'template';

  return (
    <div className="panel">
      <div className="section-head">
        <div>
          <h3>Failure Impact</h3>
          <p className="section-hint">What else cannot load because of the failures found here</p>
        </div>
        <button className="btn btn--tertiary btn--small" onClick={copyMermaid}>
          {copied === 'yes' ? 'Copied' : copied === 'failed' ? 'Copy blocked — use source below' : 'Copy Mermaid'}
        </button>
      </div>

      <div className="filter-bar">
        {hasTemplate && (
          <button className={`filter-chip${active === 'template' ? ' filter-chip--active' : ''}`}
                  onClick={() => setView('template')}>
            Within the template
          </button>
        )}
        {hasObjects && (
          <button className={`filter-chip${active === 'objects' ? ' filter-chip--active' : ''}`}
                  onClick={() => setView('objects')}>
            Dependent migration objects ({downstream.totals.direct})
          </button>
        )}
      </div>

      {active === 'template' && hasTemplate && (
        <>
          {graph.totals.failedRecords === 0 ? (
            <p className="state-message">
              No record failed, so no dependent rows are blocked. The diagram shows how the sheets relate
              through <code>{graph.keyField}</code>.
            </p>
          ) : (
            <p className="state-message state-message--inline">
              <strong>{graph.totals.failedRecords}</strong> failed record(s) block{' '}
              <strong>{graph.totals.blockedRows}</strong> otherwise-valid row(s) across{' '}
              <strong>{graph.totals.affectedSheets}</strong> dependent sheet(s).
            </p>
          )}

          <div className="diagram-scroll"><TemplateCascade graph={graph} /></div>
          <Legend items={[['error', 'Has errors'], ['blocked', 'Blocked by a failed parent'], ['clean', 'No errors']]} />

          {graph.cascades.length > 0 && (
            <div className="cascade-list">
              {graph.cascades.map((c) => (
                <div key={c.key} className="cascade">
                  <div className="cascade__head">
                    <span className="badge badge--error">Failed</span>
                    <span className="cascade__key">{graph.keyField} “{c.key}” (row {c.mainRow})</span>
                  </div>
                  <ul className="cascade__reasons">
                    {c.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                  {c.blocked.length > 0 && (
                    <div className="cascade__blocked">
                      Blocks {c.blocked.length} dependent row(s):{' '}
                      {c.blocked.map((b) => `${b.sheet} row ${b.row}`).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {active === 'objects' && hasObjects && (
        <>
          <p className={`state-message${downstream.blocked ? ' state-message--error' : ' state-message--inline'}`}>
            {downstream.blocked ? (
              <>
                <strong>{downstream.object}</strong> has blocking errors, so{' '}
                <strong>{downstream.totals.direct}</strong> object(s) that list it as a prerequisite cannot be
                migrated — <strong>{downstream.totals.transitive}</strong> once the chain is followed
                ({downstream.totals.maxDepth} level{downstream.totals.maxDepth === 1 ? '' : 's'} deep).
              </>
            ) : (
              <>
                <strong>{downstream.totals.direct}</strong> object(s) list{' '}
                <strong>{downstream.object}</strong> as a prerequisite and must be migrated after it
                ({downstream.totals.transitive} including indirect dependents). None are blocked, because this
                template has no errors.
              </>
            )}
          </p>

          <div className="diagram-scroll"><ObjectCascade downstream={downstream} /></div>
          <Legend items={[
            ['error', downstream.blocked ? 'Failing object' : 'This object'],
            ['blocked', downstream.blocked ? 'Cannot be migrated' : 'Waits on this object'],
          ]} />

          <button className="btn btn--tertiary btn--small" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Hide full list' : `Show all ${downstream.totals.transitive} dependent objects`}
          </button>

          {showAll && (
            <div className="dependent-list">
              {[...new Set(downstream.transitiveDependents.map((d) => d.level))].map((level) => (
                <div key={level} className="dependent-level">
                  <h4>{level === 1 ? 'Direct dependents' : `Level ${level} (indirect)`}</h4>
                  <div className="dependent-chips">
                    {downstream.transitiveDependents.filter((d) => d.level === level).map((d) => (
                      <span key={d.name} className={`chip${downstream.blocked ? ' chip--blocked' : ''}`}>{d.name}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="diagram-source">
            Dependencies read from each object&apos;s “Prerequisites” section in the SAP Help Portal
            (retrieved {downstream.retrieved}).
          </p>
        </>
      )}

      <details className="mermaid-source">
        <summary>Mermaid source</summary>
        <pre>{mermaid}</pre>
      </details>
    </div>
  );
}

function Legend({ items }) {
  return (
    <div className="diagram-legend">
      {items.map(([status, label]) => (
        <span key={status} className="legend-item">
          <span className="legend-swatch" style={{ background: STATUS_FILL[status], borderColor: STATUS_STROKE[status] }} />
          {label}
        </span>
      ))}
    </div>
  );
}
