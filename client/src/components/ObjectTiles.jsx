export default function ObjectTiles({ objects, onSelect, loading, error }) {
  if (loading) return <div className="state-message">Loading migration objects…</div>;
  if (error) return <div className="state-message state-message--error">{error}</div>;
  if (!objects || objects.length === 0) return <div className="state-message">No migration objects configured.</div>;

  return (
    <div className="tile-grid">
      {objects.map((obj) => (
        <button key={obj.id} className="tile" onClick={() => onSelect(obj.id)}>
          <div className="tile__icon">{obj.name.charAt(0)}</div>
          <div className="tile__body">
            <div className="tile__title">{obj.name}</div>
            <div className="tile__subtitle">{obj.description}</div>
            <div className="tile__meta">
              {obj.fieldCount} fields · Key: {obj.keyFields.join(', ')}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
