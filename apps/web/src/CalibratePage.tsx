import { useState } from "react";
import { AccordionContext } from "./AccordionContext.js";
import { useCalibrationState } from "./CalibrationContext.js";
import { CalibrationPanel } from "./CalibrationPanel.js";
import { useMapControls } from "./MapLayout.js";
import { useProject } from "./ProjectContext.js";
import { SoundingPanel } from "./SoundingPanel.js";

/**
 * Step three: *how deep*. Known-depth readings, and the fit that turns the Stumpf ratio
 * into metres.
 *
 * A sidebar over the shared map rather than a page of its own (issue #49), because every
 * judgement this step supports is made by looking: whether a 2.1 m reading sits over a
 * patch the composite calls shallow, whether a point that fits badly is over Posidonia.
 * None of that survives being moved off the map.
 */
export function CalibratePage() {
  const {
    soundings,
    soundingError,
    importSoundings,
    removeSounding,
    addSounding,
    composite,
    excludedSoundingIds,
    toggleSoundingExcluded,
  } = useProject();
  const {
    isDroppingSounding,
    startDropSounding,
    stopDropSounding,
    droppedPoint,
    clearDroppedPoint,
  } = useMapControls();
  const calibration = useCalibrationState();
  const [activeSection, setActiveSection] = useState("calibration");

  return (
    <AccordionContext.Provider value={{ activeId: activeSection, setActiveId: setActiveSection }}>
      <CalibrationPanel
        calibration={calibration}
        hasComposite={composite !== null}
        excludedIds={excludedSoundingIds}
        onToggleExcluded={toggleSoundingExcluded}
        isDropping={isDroppingSounding}
        onStartDrop={startDropSounding}
        onStopDrop={stopDropSounding}
        droppedPoint={droppedPoint}
        onSave={async (sounding) => {
          await addSounding(sounding);
          clearDroppedPoint();
        }}
        onCancelDrop={clearDroppedPoint}
      />
      <SoundingPanel
        soundings={soundings}
        error={soundingError}
        onImport={importSoundings}
        onRemove={removeSounding}
      />
    </AccordionContext.Provider>
  );
}
