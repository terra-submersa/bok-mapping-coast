import type { Composite } from "./composite.js";

export interface DepthPanelProps {
  hasAoi: boolean;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onLoad: () => void;
  loading: boolean;
  error: string | null;
  composite: Composite | null;
  opacity: number;
  onOpacityChange: (value: number) => void;
}

/** Share of pixels backed by at least one scene — the rest is land, cloud, or nothing. */
function waterCoverage(composite: Composite): { water: number; medianScenes: number } {
  const counts: number[] = [];
  for (const count of composite.sceneCount) {
    if (count > 0) counts.push(count);
  }
  counts.sort((a, b) => a - b);
  return {
    water: counts.length,
    medianScenes: counts.length === 0 ? 0 : counts[Math.floor(counts.length / 2)],
  };
}

export function DepthPanel({
  hasAoi,
  from,
  to,
  onFromChange,
  onToChange,
  onLoad,
  loading,
  error,
  composite,
  opacity,
  onOpacityChange,
}: DepthPanelProps) {
  const stats = composite ? waterCoverage(composite) : null;

  return (
    <section className="panel">
      <h2>Relative depth</h2>

      <div className="row">
        <div className="field">
          <label htmlFor="from">From</label>
          <input
            id="from"
            type="date"
            value={from}
            onChange={(e) => onFromChange(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="to">To</label>
          <input id="to" type="date" value={to} onChange={(e) => onToChange(e.target.value)} />
        </div>
      </div>

      <p className="hint">
        A summer's worth of scenes. The composite is a per-pixel median, so a wider range means
        fewer glint and wake artefacts.
      </p>

      <button type="button" onClick={onLoad} disabled={!hasAoi || loading} style={{ marginTop: 6 }}>
        {loading ? "Building composite…" : "Load composite"}
      </button>
      {!hasAoi && <p className="hint">Define an AOI first.</p>}
      {error && <p className="error">{error}</p>}

      {composite && stats && (
        <div className="stat">
          <div>
            {composite.width}×{composite.height} px · {stats.water.toLocaleString()} water pixels
          </div>
          <div>Median scene count: {stats.medianScenes}</div>
          {stats.medianScenes < 5 && (
            <p className="error">
              Few contributing scenes. Treat the shape of this composite with suspicion — widen the
              date range.
            </p>
          )}

          <div className="ramp-legend">
            <span>shallow</span>
            <span className="bar" />
            <span>deep</span>
          </div>

          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="opacity">Opacity</label>
            <input
              id="opacity"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => onOpacityChange(Number(e.target.value))}
            />
          </div>
        </div>
      )}
    </section>
  );
}
