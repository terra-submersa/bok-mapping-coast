import { countVertices } from "@bok/core";
import { useEffect, useState } from "react";
import { useMapControls } from "../map/MapContext.js";
import { AccordionContext } from "../panels/AccordionContext.js";
import { BufferPanel } from "../panels/BufferPanel.js";
import { DepthPanel } from "../panels/DepthPanel.js";
import { ExportPanel } from "../panels/ExportPanel.js";
import { RingPanel } from "../panels/RingPanel.js";
import { SimplifyPanel } from "../panels/SimplifyPanel.js";
import { ThresholdPanel } from "../panels/ThresholdPanel.js";
import { ZonePanel } from "../panels/ZonePanel.js";
import { useBoundaryState } from "../state/BoundaryContext.js";
import { useCalibrationState } from "../state/CalibrationContext.js";
import { useProject } from "../state/ProjectContext.js";

/**
 * Step two: *how deep*. Everything between the AOI and a downloadable KML — the
 * composite window, the threshold, which ring, the landward buffer, simplification
 * and export (issue #38).
 */
export function BoundaryPage() {
  const {
    aoi,
    from,
    to,
    setFrom,
    setTo,
    composite,
    loadingComposite,
    compositeProgress,
    compositeError,
    loadComposite,
    opacity,
    setOpacity,
    layerView,
    setLayerView,
    ratioRange,
    threshold,
    setThreshold,
    tolerance,
    setTolerance,
    bufferMetres,
    setBufferMetres,
    coastMetres,
    setCoastMetres,
    minRingAreaM2,
    setMinRingAreaM2,
    setSelectedAnchor,
    allRingsSelected,
    setAllRingsSelected,
    isDrawing,
    exclusions,
    inclusions,
    removeInclusion,
    clearInclusions,
  } = useProject();

  const { startDraw, drawTarget } = useMapControls();

  const {
    contour,
    rings,
    selectedRing,
    combinedStats,
    bufferedStats,
    mergedPolygon,
    simplified,
    clippedInclusions,
    boundary,
  } = useBoundaryState();

  /** The ratio→metres fit, so the threshold can be read and set in metres (issue #50). */
  const { fit } = useCalibrationState();

  // An inclusion drawn outside the AOI is clipped away to nothing. Saying so beats
  // leaving the Planner to wonder why the boundary did not move (issue #16).
  const strandedInclusions = clippedInclusions.filter(
    (zone) => zone.coordinates.length === 0,
  ).length;

  const [activeSection, setActiveSection] = useState("depth");

  // Dropping the composite unmounts every section after this one, so an accordion left
  // pointing at (say) "export" would collapse to nothing expanded at all.
  useEffect(() => {
    if (!composite) setActiveSection("depth");
  }, [composite]);

  return (
    <AccordionContext.Provider value={{ activeId: activeSection, setActiveId: setActiveSection }}>
      <DepthPanel
        hasAoi={aoi !== null}
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onLoad={loadComposite}
        loading={loadingComposite}
        progress={compositeProgress}
        error={compositeError}
        composite={composite}
        opacity={opacity}
        onOpacityChange={setOpacity}
        layerView={layerView}
        onLayerViewChange={setLayerView}
      />
      {ratioRange && threshold !== null && (
        <ThresholdPanel
          range={ratioRange}
          threshold={threshold}
          onThresholdChange={setThreshold}
          vertexCount={rings.reduce((sum, ring) => sum + ring.vertexCount, 0)}
          ringCount={rings.length}
          coastMetres={coastMetres}
          onCoastMetresChange={setCoastMetres}
          fit={fit}
        />
      )}
      {rings.length > 0 && (
        <RingPanel
          rings={rings}
          selectedRing={selectedRing}
          allSelected={allRingsSelected}
          onSelect={(ring) => {
            setAllRingsSelected(false);
            setSelectedAnchor(ring.anchor);
          }}
          onSelectAll={() => setAllRingsSelected(true)}
        />
      )}
      {selectedRing && threshold !== null && (
        <ZonePanel
          id="inclusions"
          title="Inclusion zones"
          drawLabel="Draw inclusion"
          zones={inclusions}
          isDrawing={isDrawing && drawTarget === "inclusion"}
          onStartDraw={() => startDraw("inclusion")}
          onRemove={removeInclusion}
          onClearAll={clearInclusions}
          warning={
            strandedInclusions > 0 ? (
              <>
                {strandedInclusions} zone{strandedInclusions === 1 ? " falls" : "s fall"} outside
                the AOI and {strandedInclusions === 1 ? "is" : "are"} ignored. The AOI is the hard
                limit on where a mission can go — widen it on the Area step first.
              </>
            ) : undefined
          }
          emptyHint="Nothing added. Draw over water the contour missed — a Posidonia meadow read as deep is the usual reason."
          footerHint={
            <>
              Added to the boundary, and stored with the project. Because a zone is an input rather
              than an edit, changing the threshold re-applies it instead of wiping it — which is
              what settled story 4.4 (D10). Exclusions are cut afterwards, so a cut always beats an
              overlapping addition.
            </>
          }
        />
      )}
      {selectedRing && threshold !== null && (
        <BufferPanel
          metres={bufferMetres}
          onMetresChange={setBufferMetres}
          beforeVertices={combinedStats.vertexCount}
          beforeAreaM2={combinedStats.areaM2}
          afterVertices={bufferedStats.vertexCount}
          afterAreaM2={bufferedStats.areaM2}
        />
      )}
      {threshold !== null && (
        <SimplifyPanel
          minRingAreaM2={minRingAreaM2}
          onMinRingAreaM2Change={setMinRingAreaM2}
          candidateRingCount={contour ? contour.coordinates.length : 0}
          survivingRingCount={rings.length}
          tolerance={tolerance}
          onToleranceChange={setTolerance}
          originalVertices={mergedPolygon ? countVertices(mergedPolygon) : 0}
          simplifiedVertices={simplified ? countVertices(simplified) : 0}
          ringCount={boundary?.coordinates.length ?? 0}
          exportedVertices={boundary ? countVertices(boundary) : 0}
          zoneCount={exclusions.length}
        />
      )}
      {selectedRing && threshold !== null && (
        <ExportPanel
          boundary={boundary && boundary.coordinates.length > 0 ? boundary : null}
          otherRingCount={allRingsSelected ? 0 : Math.max(rings.length - 1, 0)}
          threshold={threshold}
          tolerance={tolerance}
          bufferMetres={bufferMetres}
          coastMetres={coastMetres}
          from={from}
          to={to}
        />
      )}
    </AccordionContext.Provider>
  );
}
