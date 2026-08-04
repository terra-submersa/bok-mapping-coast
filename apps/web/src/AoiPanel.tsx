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
          {/* The envelope is what actually gets requested and billed, and for anything
              but a rectangle it is the larger of the two — and the only one the cap
              applies to. Showing it is what keeps the warning below from reading as a
              bug when a small diagonal AOI trips it. */}
          {envelopeKm2 !== null && (
            <div className="hint">Fetches a {envelopeKm2.toFixed(2)} km² box</div>
          )}
          {/* An envelope over the single-request cap is now fetched as several tiles
              rather than refused (issue #41), so this is a cost note, not a warning —
              each tile is its own metered Processing API request. */}
          {plan && plan.tiles.length > 1 && (
            <div className="hint">
              {plan.width}×{plan.height} px, fetched as {plan.cols}×{plan.rows} ={" "}
              {plan.tiles.length} tiles · ~{Math.round((plan.width * plan.height * 8) / 1e6)} MB ·{" "}
              {plan.tiles.length} metered requests
            </div>
          )}
          {planError && <p className="error">{planError}</p>}
        </div>
      )}
    </CollapsibleSection>
  );
}
