import { useEffect, useState } from 'react';
import ShellBar from './components/ShellBar';
import ObjectTiles from './components/ObjectTiles';
import UploadPanel from './components/UploadPanel';
import ValidationReport from './components/ValidationReport';
import { fetchObjects, fetchObject, validateFile } from './api/client';
import './App.css';

export default function App() {
  const [objects, setObjects] = useState([]);
  const [loadingObjects, setLoadingObjects] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [selectedConfig, setSelectedConfig] = useState(null);
  const [report, setReport] = useState(null);
  const [validating, setValidating] = useState(false);
  const [validateError, setValidateError] = useState(null);

  useEffect(() => {
    fetchObjects()
      .then(setObjects)
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoadingObjects(false));
  }, []);

  async function handleSelect(objectId) {
    setValidateError(null);
    setReport(null);
    try {
      const config = await fetchObject(objectId);
      setSelectedConfig(config);
    } catch (err) {
      setLoadError(err.message);
    }
  }

  async function handleValidate(file) {
    setValidating(true);
    setValidateError(null);
    try {
      const result = await validateFile(selectedConfig.id, file);
      setReport(result);
    } catch (err) {
      setValidateError(err.message);
    } finally {
      setValidating(false);
    }
  }

  function handleBack() {
    setSelectedConfig(null);
    setReport(null);
    setValidateError(null);
  }

  return (
    <div className="app">
      <ShellBar objectName={selectedConfig?.name} onBack={selectedConfig ? handleBack : null} />
      <main className="app__content">
        {!selectedConfig && (
          <>
            <h1 className="page-title">Migration Objects</h1>
            <p className="page-subtitle">Select an object template, upload your migration data, and run the check.</p>
            <ObjectTiles objects={objects} onSelect={handleSelect} loading={loadingObjects} error={loadError} />
          </>
        )}

        {selectedConfig && (
          <div className="workspace">
            <UploadPanel config={selectedConfig} onValidate={handleValidate} validating={validating} />
            {validateError && <div className="state-message state-message--error">{validateError}</div>}
            {report && <ValidationReport report={report} />}
          </div>
        )}
      </main>
    </div>
  );
}
