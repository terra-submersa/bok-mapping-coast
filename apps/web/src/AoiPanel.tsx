import type { BBox, ProcessingApiLimitCheck } from "@bok/core";
import { useState } from "react";

interface AoiPanelProps {
  bbox: BBox | null;
  areaKm2: number | null;
  limitCheck: ProcessingApiLimitCheck | null;
  isDrawing: boolean;
  onStartDraw: () => void;
  onClear: () => void;
  onPasteApply: (text: string) => string | null;
}

export function AoiPanel({
  bbox,
  areaKm2,
  limitCheck,
  isDrawing,
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

  return (
    <section className="panel">
      <h2>Area of interest</h2>

      <div className="row">
        <button type="button" onClick={onStartDraw} disabled={isDrawing}>
          {isDrawing ? "Drawing… click and drag" : "Draw AOI"}
        </button>
        <button type="button" onClick={onClear} disabled={!bbox && !isDrawing}>
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
      </div>

      {bbox && areaKm2 !== null && (
        <div className="stat">
          <div>Area: {areaKm2.toFixed(2)} km²</div>
          {limitCheck?.exceeds && (
            <p className="error">
              This AOI exceeds the Processing API's single-request limit (
              {Math.round(limitCheck.widthPx)}×{Math.round(limitCheck.heightPx)} px at Sentinel-2's
              native 10 m resolution, cap is 2500×2500 px). Draw a smaller box.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
