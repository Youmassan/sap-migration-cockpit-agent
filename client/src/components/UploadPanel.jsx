import { useRef, useState } from 'react';

export default function UploadPanel({ onValidate, validating }) {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  }

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Validate Migration Template</h2>
        <p className="panel__description">
          Upload an SAP S/4HANA Migration Cockpit template. The agent reads the template&apos;s own
          <strong> Field List </strong> sheet and reports every issue the cockpit would raise during
          Prepare, Convert Values, and Simulate — before you upload.
        </p>
      </div>

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
          accept=".xml,.xlsx,.xls"
          style={{ display: 'none' }}
          onChange={(e) => setFile(e.target.files[0])}
        />
        {file ? (
          <div className="dropzone__file">
            <strong>{file.name}</strong>
            <span className="text-muted">{(file.size / 1024).toFixed(1)} KB</span>
          </div>
        ) : (
          <div className="dropzone__prompt">
            Drop your template here, or click to browse
            <span className="dropzone__hint">XML Spreadsheet 2003 (.xml) — the format the cockpit requires. .xlsx accepted for early checks.</span>
          </div>
        )}
      </div>

      <div className="panel__actions">
        <button className="btn btn--primary" disabled={!file || validating} onClick={() => onValidate(file)}>
          {validating ? 'Validating…' : 'Run Validation'}
        </button>
        {file && (
          <button className="btn btn--tertiary" disabled={validating} onClick={() => setFile(null)}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
