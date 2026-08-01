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
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 1,
        background: "white",
        borderRadius: 8,
        padding: 12,
        width: 280,
        boxShadow: "0 1px 4px rgba(0, 0, 0, 0.3)",
        fontFamily: "sans-serif",
        fontSize: 13,
      }}
    >
      <strong>Area of interest</strong>

      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
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
          style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }}
        />
        <button
          type="button"
          onClick={handleApply}
          disabled={!pasteText.trim()}
          style={{ marginTop: 4 }}
        >
          Apply
        </button>
        {pasteError && <p style={{ color: "#b00020", marginTop: 4 }}>{pasteError}</p>}
      </div>

      {bbox && areaKm2 !== null && (
        <div style={{ marginTop: 10, borderTop: "1px solid #ddd", paddingTop: 8 }}>
          <div>Area: {areaKm2.toFixed(2)} km²</div>
          {limitCheck?.exceeds && (
            <p style={{ color: "#b00020", marginTop: 4 }}>
              This AOI exceeds the Processing API's single-request limit (
              {Math.round(limitCheck.widthPx)}×{Math.round(limitCheck.heightPx)} px at Sentinel-2's
              native 10 m resolution, cap is 2500×2500 px). Draw a smaller box.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
