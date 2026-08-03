import {
  aoiEnvelope,
  bboxAreaKm2,
  checkProcessingApiLimit,
  parseAoiInput,
  polygonAreaKm2,
} from "@bok/core";
import { useMemo, useState } from "react";
import { AccordionContext } from "./AccordionContext.js";
import { AoiPanel } from "./AoiPanel.js";
import { useMapControls } from "./MapLayout.js";
import { useProject } from "./ProjectContext.js";

/**
 * Step one: *where*. Draw and reshape the AOI, and — once #17 lands — cut the
 * exclusion zones and open or save the project. Deliberately free of anything to do
 * with depth: the whole point of the split (issue #38) is that defining the area is a
 * separate act from tuning how deep it goes.
 */
export function AreaPage() {
  const { aoi, isDrawing, applyAoi, clearAoi } = useProject();
  const { startDraw, stopDraw, isEditing, startEdit, stopEdit, editError } = useMapControls();
  const [activeSection, setActiveSection] = useState("aoi");
  const [note, setNote] = useState<string | null>(null);

  /**
   * Two areas, both shown, because since D10 they are different numbers and the
   * Processing API limit is checked against the second one. A long diagonal AOI can be
   * small to fly and still trip the 2500 px cap, and a warning about a box the Planner
   * never drew reads as a bug unless the box is on screen next to it.
   */
  const areaKm2 = useMemo(() => (aoi ? polygonAreaKm2(aoi) : null), [aoi]);
  const envelope = useMemo(() => (aoi ? aoiEnvelope(aoi) : null), [aoi]);
  const envelopeKm2 = useMemo(() => (envelope ? bboxAreaKm2(envelope) : null), [envelope]);
  const limitCheck = useMemo(
    () => (envelope ? checkProcessingApiLimit(envelope) : null),
    [envelope],
  );

  function handleClear() {
    stopDraw();
    stopEdit();
    setNote(null);
    clearAoi();
  }

  function handlePasteApply(text: string): string | null {
    try {
      const parsed = parseAoiInput(text);
      stopDraw();
      // A pasted shape replaces whatever was being reshaped, so terra-draw's copy of
      // the old one has to go with it.
      stopEdit();
      applyAoi(parsed.polygon);
      setNote(parsed.note ?? null);
      return null;
    } catch (err) {
      setNote(null);
      return err instanceof Error ? err.message : "Could not parse that input.";
    }
  }

  return (
    <AccordionContext.Provider value={{ activeId: activeSection, setActiveId: setActiveSection }}>
      <AoiPanel
        aoi={aoi}
        areaKm2={areaKm2}
        envelopeKm2={envelopeKm2}
        limitCheck={limitCheck}
        isDrawing={isDrawing}
        isEditing={isEditing}
        note={note}
        editError={editError}
        onStartDraw={startDraw}
        onToggleEdit={isEditing ? stopEdit : startEdit}
        onClear={handleClear}
        onPasteApply={handlePasteApply}
      />
    </AccordionContext.Provider>
  );
}
