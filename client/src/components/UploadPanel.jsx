import { useRef, useState } from 'react';

export default function UploadPanel({ config, onValidate, validating }) {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  function pickFile(f) {
    if (!f) return;
    setFile(f);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]);
  }

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>{config.name}</h2>
        <p className="panel__description">{config.description}</p>
      </div>

      <div className="panel__section">
        <h3>Template Fields</h3>
        <div className="table-scroll">
          <table className="field-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Mandatory</th>
                <th>Constraints</th>
              </tr>
            </thead>
            <tbody>
              {config.fields.map((f) => (
                <tr key={f.name}>
                  <td>
                    <span className="field-name">{f.label || f.name}</span>
                    <span className="field-technical">{f.name}</span>
                  </td>
                  <td>{f.type}</td>
                  <td>{f.mandatory ? <span className="badge badge--mandatory">Required</span> : <span className="text-muted">Optional</span>}</td>
                  <td className="constraints-cell">
                    {f.maxLength && <div>Max length: {f.maxLength}</div>}
                    {f.min !== undefined && <div>Min value: {f.min}</div>}
                    {f.formatDescription && <div>Format: {f.formatDescription}</div>}
                    {f.lookup && <div>Allowed: {f.lookup.join(', ')}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel__section">
        <h3>Upload Data File</h3>
        <div
          className={`dropzone${dragOver ? ' dropzone--active' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={(e) => pickFile(e.target.files[0])}
          />
          {file ? (
            <div className="dropzone__file">
              <strong>{file.name}</strong>
              <span className="text-muted">{(file.size / 1024).toFixed(1)} KB</span>
            </div>
          ) : (
            <div className="dropzone__prompt">
              Drop an .xlsx, .xls, or .csv file here, or click to browse
            </div>
          )}
        </div>
        <div className="panel__actions">
          <button
            className="btn btn--primary"
            disabled={!file || validating}
            onClick={() => onValidate(file)}
          >
            {validating ? 'Checking…' : 'Run Check'}
          </button>
          {file && (
            <button className="btn btn--tertiary" disabled={validating} onClick={() => setFile(null)}>
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
