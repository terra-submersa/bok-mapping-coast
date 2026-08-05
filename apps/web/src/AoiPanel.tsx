import type { Aoi, CompositeTilePlan } from "@bok/core";
import { useState } from "react";
import { CollapsibleSection } from "./CollapsibleSection.js";

interface AoiPanelProps {
  aoi: Aoi | null;
  /** The shape that gets flown. */
  areaKm2: number | null;
  /** The rectangle that has to be fetched to cover it. */
  envelopeKm2: number | null;
  /** How the envelope will be fetched, or null when it cannot be. */
  plan: CompositeTilePlan | null;
  /** Why no plan is possible — currently only the memory ceiling. */
  planError: string | null;
  isDrawing: boolean;
  isEditing: boolean;
  /** Set when a paste was accepted but not exactly as given — e.g. several polygons. */
  note: string | null;
  /** Why the last reshaping gesture was refused. */
  editError: string | null;
  onStartDraw: () => void;
  onToggleEdit: () => void;
  onClear: () => void;
  onPasteApply: (text: string) => string | null;
}

export function AoiPanel({
  aoi,
  areaKm2,
  envelopeKm2,
  plan,
  planError,
  isDrawing,
  isEditing,
  note,
  editError,
  onStartDraw,
  onToggleEdit,
  onClear,
  onPasteApply,
}: AoiPanelProps) {
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  function handleApply() {
    const error = onPasteApply(pasteText);
    setPasteError(error);
    if (!error) setPasteText("");
  }

  // The closing position repeats the first, so it is not a corner you drew.
  const vertexCount = aoi ? Math.max((aoi.coordinates[0]?.length ?? 1) - 1, 0) : 0;

  return (
    <CollapsibleSection id="aoi" title="Area of interest">
      <div className="row">
        <button type="button" onClick={onStartDraw} disabled={isDrawing}>
          {isDrawing ? "Drawing… click each corner, then close" : "Draw AOI"}
        </button>
        <button type="button" onClick={onToggleEdit} disabled={!aoi || isDrawing}>
          {isEditing ? "Done" : "Reshape"}
        </button>
        <button type="button" onClick={onClear} disabled={!aoi && !isDrawing}>
          Clear
        </button>
      </div>

      {isEditing && (
        <p className="hint">
          Drag a corner to move it, click a midpoint to add one, shift-click (or right-click) a
          corner to delete it.
        </p>
      )}
      {editError && <p className="error">{editError}</p>}

      <div style={{ marginTop: 10 }}>
        <label htmlFor="aoi-paste">Or paste a bbox / GeoJSON:</label>
        <textarea
          id="aoi-paste"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="23.105,37.418,23.14,37.435"
          rows={2}
        />
        <button type="button" onClick={handleApply} disabled={!pasteText.trim()}>
          Apply
        </button>
        {pasteError && <p className="error">{pasteError}</p>}
        {note && <p className="hint">{note}</p>}
      </div>

      {aoi && areaKm2 !== null && (
        <div className="stat">
          <div>
            Area: {areaKm2.toFixed(2)} km² · {vertexCount} vertices
          </div>
          {/* The envelope still bounds the merged raster and is what the memory ceiling
              and the pixel grid are measured against, so it stays on screen — but since
              issue #46 it is no longer what gets billed, and saying so is the difference
              between a cost the Planner can act on and a number that looks like waste. */}
          {envelopeKm2 !== null && (
            <div className="hint">Spans a {envelopeKm2.toFixed(2)} km² box</div>
          )}
          {/* A cost note, not a warning: an envelope over the single-request cap is tiled
              rather than refused (issue #41), and a diagonal one is fetched as strips that
              skip the open sea (issue #46). Each is its own metered request. */}
          {plan && (
            <div className="hint">
              {plan.width}×{plan.height} px · {plan.tiles.length} metered{" "}
              {plan.tiles.length === 1 ? "request" : "requests"}, fetching{" "}
              {Math.round((100 * plan.coveredPx) / (plan.width * plan.height))}% of it · ~
              {Math.round((plan.coveredPx * 8) / 1e6)} MB
            </div>
          )}
          {planError && <p className="error">{planError}</p>}
        </div>
      )}
    </CollapsibleSection>
  );
}
