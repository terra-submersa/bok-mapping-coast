import { PILOT2_VERTEX_CEILING } from "@bok/core";

export interface SimplifyPanelProps {
  tolerance: number;
  onToleranceChange: (value: number) => void;
  originalVertices: number;
  simplifiedVertices: number;
  ringCount: number;
}

export function SimplifyPanel({
  tolerance,
  onToleranceChange,
  originalVertices,
  simplifiedVertices,
  ringCount,
}: SimplifyPanelProps) {
  const overCeiling = simplifiedVertices > PILOT2_VERTEX_CEILING;
  const reduction =
    originalVertices > 0 ? Math.round((1 - simplifiedVertices / originalVertices) * 100) : 0;

  return (
    <section className="panel">
      <h2>Simplify</h2>

      <div className="field">
        <label htmlFor="tolerance">Tolerance: {tolerance} m</label>
        <input
          id="tolerance"
          type="range"
          min={0}
          max={100}
          step={1}
          value={tolerance}
          onChange={(e) => onToleranceChange(Number(e.target.value))}
        />
      </div>

      <div className="stat">
        <div>
          <strong>{simplifiedVertices.toLocaleString()}</strong> vertices in {ringCount} ring
          {ringCount === 1 ? "" : "s"}
        </div>
        <div>
          from {originalVertices.toLocaleString()}
          {reduction > 0 && ` · ${reduction}% fewer`}
        </div>

        {overCeiling ? (
          <p className="error">
            Above the {PILOT2_VERTEX_CEILING}-vertex ceiling Pilot 2 is expected to handle. Raise
            the tolerance, or narrow the threshold so fewer rings survive.
          </p>
        ) : (
          <p className="hint">Within the {PILOT2_VERTEX_CEILING}-vertex ceiling.</p>
        )}

        <p className="hint">
          Non-destructive: the full-resolution contour is kept, so moving this slider back restores
          every vertex.
        </p>
      </div>
    </section>
  );
}
