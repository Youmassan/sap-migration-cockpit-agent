export default function ShellBar({ objectName, onBack }) {
  return (
    <header className="shell-bar">
      <div className="shell-bar__left">
        {onBack && (
          <button className="shell-bar__back" onClick={onBack} aria-label="Back to object list">
            &#8592;
          </button>
        )}
        <span className="shell-bar__logo">SAP</span>
        <span className="shell-bar__divider" />
        <span className="shell-bar__title">Data Migration Cockpit</span>
        {objectName && (
          <>
            <span className="shell-bar__crumb-sep">/</span>
            <span className="shell-bar__crumb">{objectName}</span>
          </>
        )}
      </div>
      <div className="shell-bar__right">
        <span className="shell-bar__avatar" title="User profile">YM</span>
      </div>
    </header>
  );
}
