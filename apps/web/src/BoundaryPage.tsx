import { countVertices } from "@bok/core";
import { useEffect, useState } from "react";
import { AccordionContext } from "./AccordionContext.js";
import { useBoundaryState } from "./BoundaryContext.js";
import { BufferPanel } from "./BufferPanel.js";
import { DepthPanel } from "./DepthPanel.js";
import { ExportPanel } from "./ExportPanel.js";
import { useProject } from "./ProjectContext.js";
import { RingPanel } from "./RingPanel.js";
import { SimplifyPanel } from "./SimplifyPanel.js";
import { ThresholdPanel } from "./ThresholdPanel.js";

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
  } = useProject();

  const { contour, rings, selectedRing, combinedStats, bufferedStats, mergedPolygon, boundary } =
    useBoundaryState();

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
          simplifiedVertices={boundary ? countVertices(boundary) : 0}
          ringCount={boundary?.coordinates.length ?? 0}
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
