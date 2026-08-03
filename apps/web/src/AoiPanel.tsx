import type { Aoi, ProcessingApiLimitCheck } from "@bok/core";
import { useState } from "react";
import { CollapsibleSection } from "./CollapsibleSection.js";

interface AoiPanelProps {
  aoi: Aoi | null;
  /** The shape that gets flown. */
  areaKm2: number | null;
  /** The rectangle that has to be fetched to cover it. */
  envelopeKm2: number | null;
  limitCheck: ProcessingApiLimitCheck | null;
  isDrawing: boolean;
  /** Set when a paste was accepted but not exactly as given — e.g. several polygons. */
  note: string | null;
  onStartDraw: () => void;
  onClear: () => void;
  onPasteApply: (text: string) => string | null;
}

export function AoiPanel({
  aoi,
  areaKm2,
  envelopeKm2,
  limitCheck,
  isDrawing,
  note,
  onStartDraw,
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
          {isDrawing ? "Drawing… click each corner, then close the shape" : "Draw AOI"}
        </button>
        <button type="button" onClick={onClear} disabled={!aoi && !isDrawing}>
          Clear
        </button>
      </div>

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
          {limitCheck?.exceeds && (
            <p className="error">
              This AOI's bounding box exceeds the Processing API's single-request limit (
              {Math.round(limitCheck.widthPx)}×{Math.round(limitCheck.heightPx)} px at Sentinel-2's
              native 10 m resolution, cap is 2500×2500 px). Draw a smaller area — it is the box
              around your shape that counts, not the shape itself.
            </p>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}
