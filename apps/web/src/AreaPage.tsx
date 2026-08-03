import { bboxAreaKm2, checkProcessingApiLimit, parseBboxInput } from "@bok/core";
import { useMemo, useState } from "react";
import { AccordionContext } from "./AccordionContext.js";
import { AoiPanel } from "./AoiPanel.js";
import { useMapControls } from "./MapLayout.js";
import { useProject } from "./ProjectContext.js";

/**
 * Step one: *where*. Draw the AOI, and — once #17 lands — cut the exclusion zones and
 * open or save the project. Deliberately free of anything to do with depth: the whole
 * point of the split (issue #38) is that defining the area is a separate act from
 * tuning how deep it goes.
 */
export function AreaPage() {
  const { bbox, isDrawing, applyBbox, clearAoi } = useProject();
  const { startDraw, stopDraw } = useMapControls();
  const [activeSection, setActiveSection] = useState("aoi");

  const areaKm2 = useMemo(() => (bbox ? bboxAreaKm2(bbox) : null), [bbox]);
  const limitCheck = useMemo(() => (bbox ? checkProcessingApiLimit(bbox) : null), [bbox]);

  function handleClear() {
    stopDraw();
    clearAoi();
  }

  function handlePasteApply(text: string): string | null {
    try {
      const parsed = parseBboxInput(text);
      stopDraw();
      applyBbox(parsed);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Could not parse that input.";
    }
  }

  return (
    <AccordionContext.Provider value={{ activeId: activeSection, setActiveId: setActiveSection }}>
      <AoiPanel
        bbox={bbox}
        areaKm2={areaKm2}
        limitCheck={limitCheck}
        isDrawing={isDrawing}
        onStartDraw={startDraw}
        onClear={handleClear}
        onPasteApply={handlePasteApply}
      />
    </AccordionContext.Provider>
  );
}
