import { MIN_CALIBRATION_POINTS, parseSounding, type Sounding } from "@bok/core";
import { useState } from "react";
import { CollapsibleSection } from "./CollapsibleSection.js";
import type { CalibrationState } from "./useCalibration.js";

export interface CalibrationPanelProps {
  calibration: CalibrationState;
  hasComposite: boolean;
  excludedIds: string[];
  onToggleExcluded: (id: string) => void;
  /** True while the next map click will place a point. */
  isDropping: boolean;
  onStartDrop: () => void;
  onStopDrop: () => void;
  droppedPoint: { lon: number; lat: number } | null;
  onSave: (sounding: Sounding) => Promise<void>;
  onCancelDrop: () => void;
}

/**
 * The fit, and the residuals it hides (issue #12).
 *
 * The table is the deliverable, not the R². Stumpf's ratio is linear in depth over a
 * *uniform* substrate, and Kiladha has sand, rock and Posidonia in one bay — so a single
 * R² across fourteen points at two sites 12 km apart can look respectable while one
 * cluster is systematically wrong. The per-point residual is what shows that, which is
 * why every point is listed with its own number rather than rolled into a summary.
 */
export function CalibrationPanel({
  calibration,
  hasComposite,
  excludedIds,
  onToggleExcluded,
  isDropping,
  onStartDrop,
  onStopDrop,
  droppedPoint,
  onSave,
  onCancelDrop,
}: CalibrationPanelProps) {
  const { points, fit, usableCount, unsampledCount, shortfall } = calibration;
  const [name, setName] = useState("");
  const [depth, setDepth] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSave() {
    if (!droppedPoint) return;
    try {
      const sounding = parseSounding({
        name: name.trim() || `Point ${points.length + 1}`,
        lon: droppedPoint.lon,
        lat: droppedPoint.lat,
        depthM: depth,
        source: "hand",
      });
      setFormError(null);
      await onSave(sounding);
      setName("");
      setDepth("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not read that depth.");
    }
  }

  return (
    <CollapsibleSection id="calibration" title="Ratio → metres">
      <div className="row">
        <button type="button" onClick={isDropping ? onStopDrop : onStartDrop}>
          {isDropping ? "Click the map… (cancel)" : "Drop a reference point"}
        </button>
      </div>

      {droppedPoint && (
        <div className="stat">
          <p className="hint">
            {droppedPoint.lat.toFixed(5)}, {droppedPoint.lon.toFixed(5)}
          </p>
          <div className="row">
            <div className="field">
              <label htmlFor="sounding-name">Name</label>
              <input
                id="sounding-name"
                value={name}
                placeholder={`Point ${points.length + 1}`}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="sounding-depth">Depth (m)</label>
              <input
                id="sounding-depth"
                value={depth}
                inputMode="decimal"
                onChange={(e) => setDepth(e.target.value)}
              />
            </div>
          </div>
          <div className="row">
            <button type="button" onClick={() => void handleSave()}>
              Save
            </button>
            <button type="button" onClick={onCancelDrop}>
              Cancel
            </button>
          </div>
          {formError && <p className="error">{formError}</p>}
        </div>
      )}

      {!hasComposite ? (
        <p className="hint">
          No composite loaded. The soundings are stored, but nothing can be sampled against them
          until there is a raster — load one on the Boundary step.
        </p>
      ) : (
        <>
          <div className="stat">
            {fit ? (
              <>
                <div>
                  depth = <strong>{fit.m1.toFixed(3)}</strong> · ratio −{" "}
                  <strong>{fit.m0.toFixed(3)}</strong>
                </div>
                <div>
                  R² {fit.r2.toFixed(3)} · RMSE <strong>{fit.rmseM.toFixed(2)} m</strong> · {fit.n}{" "}
                  point{fit.n === 1 ? "" : "s"}
                </div>
                {fit.m1 <= 0 && (
                  <p className="error">
                    The slope is negative: this says the satellite reads deeper water as brighter,
                    which is the opposite of what Stumpf's ratio does. Something is wrong — the
                    wrong composite, the wrong points, or too few of them to constrain a line. Do
                    not trust the metres.
                  </p>
                )}
              </>
            ) : (
              <p className="hint">
                No fit. {usableCount} usable point{usableCount === 1 ? "" : "s"}; at least{" "}
                {MIN_CALIBRATION_POINTS} are needed before metres are shown anywhere (D3), so{" "}
                {shortfall} more.
              </p>
            )}
            {unsampledCount > 0 && (
              <p className="hint">
                {unsampledCount} sounding{unsampledCount === 1 ? " has" : "s have"} no ratio —
                outside the composite, over land, or under permanent cloud.
              </p>
            )}
          </div>

          {points.length > 0 && (
            <ul className="ring-list">
              {points.map(({ sounding, sample, residualM }) => (
                <li key={sounding.id} className="ring-item">
                  <span>
                    <strong>{sounding.depthM} m</strong> · {sounding.name}
                    <br />
                    <span className="hint">
                      {sample
                        ? `ratio ${sample.ratio.toFixed(4)} · ${Math.round(sample.sceneCount)} scenes · ${sample.pixels}/9 px`
                        : "no ratio here"}
                      {residualM !== null &&
                        ` · ${residualM > 0 ? "+" : ""}${residualM.toFixed(2)} m`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleExcluded(sounding.id)}
                    disabled={!sample}
                  >
                    {excludedIds.includes(sounding.id) ? "Include" : "Exclude"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="hint">
        Residual is measured minus fitted: positive means the seabed is deeper than the fit says. A
        cluster whose residuals share a sign is not scatter — it is a second site the one model does
        not describe.
      </p>
    </CollapsibleSection>
  );
}
