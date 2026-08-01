export default function ShellBar({ objectName }) {
  return (
    <header className="shell-bar">
      <div className="shell-bar__left">
        <span className="shell-bar__logo">SAP</span>
        <span className="shell-bar__divider" />
        <span className="shell-bar__title">AI Migration Cockpit Agent</span>
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
