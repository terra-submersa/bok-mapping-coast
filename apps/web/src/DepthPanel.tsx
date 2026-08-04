import { CollapsibleSection } from "./CollapsibleSection.js";
import type { Composite, CompositeProgress } from "./composite.js";

export type LayerView = "depth" | "sceneCount";

export interface DepthPanelProps {
  hasAoi: boolean;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onLoad: () => void;
  loading: boolean;
  progress: CompositeProgress | null;
  error: string | null;
  composite: Composite | null;
  opacity: number;
  onOpacityChange: (value: number) => void;
  layerView: LayerView;
  onLayerViewChange: (value: LayerView) => void;
}

/**
 * Share of pixels backed by at least one scene — the rest is land, cloud, or nothing.
 *
 * The count is exact and the median is sampled. Pushing every water pixel of a tiled
 * composite into a JS array and sorting it is hundreds of megabytes of boxed doubles
 * (issue #42), but the count is a number on screen and should not wobble, so it gets its
 * own counter loop over the whole band.
 */
function waterCoverage(composite: Composite): { water: number; medianScenes: number } {
  const { sceneCount } = composite;

  let water = 0;
  for (let i = 0; i < sceneCount.length; i++) {
    if (sceneCount[i] > 0) water++;
  }

  const stride = Math.max(1, Math.ceil(sceneCount.length / MEDIAN_SAMPLES));
  const sample = new Float64Array(Math.ceil(sceneCount.length / stride));
  let sampled = 0;
  for (let i = 0; i < sceneCount.length; i += stride) {
    if (sceneCount[i] > 0) sample[sampled++] = sceneCount[i];
  }
  const sorted = sample.subarray(0, sampled).sort();

  return {
    water,
    medianScenes: sampled === 0 ? 0 : sorted[Math.floor(sampled / 2)],
  };
}

/** Enough to place a median to well within one scene; see waterCoverage. */
const MEDIAN_SAMPLES = 1_000_000;

export function DepthPanel({
  hasAoi,
  from,
  to,
  onFromChange,
  onToChange,
  onLoad,
  loading,
  progress,
  error,
  composite,
  opacity,
  onOpacityChange,
  layerView,
  onLayerViewChange,
}: DepthPanelProps) {
  const stats = composite ? waterCoverage(composite) : null;

  // The count goes in the title because `CollapsibleSection` unmounts its body when
  // collapsed — open another section mid-load and the bar below vanishes, but the header
  // is always mounted. Same idiom as ZonePanel's `${title} (${count})`.
  const title = progress
    ? `Relative depth (${progress.completed}/${progress.total})`
    : "Relative depth";

  return (
    <CollapsibleSection id="depth" title={title}>
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
      {progress && (
        <>
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={progress.completed}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label="Composite tiles fetched"
          >
            <span
              className="fill"
              style={{ width: `${(progress.completed / progress.total) * 100}%` }}
            />
          </div>
          <p className="hint" aria-live="polite">
            {progress.completed} of {progress.total} {progress.total === 1 ? "tile" : "tiles"}
            {/* Cache hits are why some tiles land instantly and others take half a
                minute. Without this the bar looks like it is stalling. */}
            {progress.cached > 0 && ` · ${progress.cached} from cache`}
          </p>
        </>
      )}
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

          <div className="row" style={{ marginTop: 6 }}>
            <button
              type="button"
              className={layerView === "depth" ? "toggle active" : "toggle"}
              onClick={() => onLayerViewChange("depth")}
            >
              Depth
            </button>
            <button
              type="button"
              className={layerView === "sceneCount" ? "toggle active" : "toggle"}
              onClick={() => onLayerViewChange("sceneCount")}
            >
              Scene count
            </button>
          </div>

          {layerView === "depth" ? (
            <div className="ramp-legend">
              <span>shallow</span>
              <span className="bar" />
              <span>deep</span>
            </div>
          ) : (
            <>
              <div className="ramp-legend">
                <span>thin</span>
                <span className="bar scene-count" />
                <span>many</span>
              </div>
              <p className="hint">
                Per-pixel count of scenes behind the median (story 2.2). Red areas are backed by one
                or two scenes — a cloudy-scene artefact can look exactly like a real shallow shelf,
                so distrust the contour there.
              </p>
            </>
          )}

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
    </CollapsibleSection>
  );
}
