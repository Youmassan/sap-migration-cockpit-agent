import { useState } from 'react';
import ShellBar from './components/ShellBar';
import UploadPanel from './components/UploadPanel';
import ValidationReport from './components/ValidationReport';
import { validateTemplate } from './api/client';
import './App.css';

export default function App() {
  const [report, setReport] = useState(null);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState(null);

  async function handleValidate(file) {
    setValidating(true);
    setError(null);
    setReport(null);
    try {
      setReport(await validateTemplate(file));
    } catch (err) {
      setError(err.message);
    } finally {
      setValidating(false);
    }
  }

  return (
    <div className="app">
      <ShellBar objectName={report?.objectName} />
      <main className="app__content">
        <h1 className="page-title">AI Migration Cockpit Agent</h1>
        <p className="page-subtitle">
          Pre-load validation for SAP S/4HANA Migration Cockpit templates.
        </p>

        <UploadPanel onValidate={handleValidate} validating={validating} />

        {error && <div className="panel state-message state-message--error">{error}</div>}
        {report && <ValidationReport report={report} />}
      </main>
    </div>
  );
}
