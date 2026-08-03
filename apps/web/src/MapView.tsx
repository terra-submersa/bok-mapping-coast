import {
  type BBox,
  bboxAreaKm2,
  bufferPolygon,
  type ContourRing,
  checkProcessingApiLimit,
  clipToBbox,
  coastalRibbon,
  contourRings,
  countVertices,
  findRingContaining,
  landMask,
  MIN_RING_AREA_M2,
  type ProcessingApiLimitCheck,
  parseBboxInput,
  sameBbox,
  shallowWaterContour,
  simplifyContour,
  toMultiPolygon,
  unionPolygons,
} from "@bok/core";
import {
  type GeoJSONSource,
  type ImageSource,
  Map as MapLibreMap,
  NavigationControl,
  type StyleSpecification,
} from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { TerraDraw, TerraDrawRectangleMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { AccordionContext } from "./AccordionContext.js";
import { AoiPanel } from "./AoiPanel.js";
import { clearStoredAoi, loadStoredAoi, storeAoi } from "./aoi-storage.js";
import { BufferPanel } from "./BufferPanel.js";
import { type Composite, fetchComposite } from "./composite.js";
import { DepthPanel, type LayerView } from "./DepthPanel.js";
import { renderComposite, renderSceneCount, sceneCountRange, waterRange } from "./depth-ramp.js";
import { ExportPanel } from "./ExportPanel.js";
import { loadStoredNumber, storeNumber } from "./param-storage.js";
import { RingPanel } from "./RingPanel.js";
import { SimplifyPanel } from "./SimplifyPanel.js";
import { ThresholdPanel } from "./ThresholdPanel.js";
import "maplibre-gl/dist/maplibre-gl.css";

// Kiladha Bay, Argolic Gulf — same AOI as scripts/spike-sdb-kiladha.mjs.
const KILADHA_CENTER: [number, number] = [23.1225, 37.4265];
const KILADHA_ZOOM = 14;

const AOI_SOURCE_ID = "aoi";
const DEPTH_SOURCE_ID = "depth";
const DEPTH_LAYER_ID = "depth-raster";
const RINGS_SOURCE_ID = "rings";
const BOUNDARY_SOURCE_ID = "boundary";

/**
 * Satellite imagery, not a street basemap: story 2.3 exists so the Planner can
 * judge the contour against sand, rock and Posidonia they recognise. Esri World
 * Imagery needs no API key; attribution is required.
 */
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
  },
  layers: [{ id: "satellite", type: "raster", source: "satellite" }],
};

/** Default composite window: the most recent complete summer, as in the spike. */
const DEFAULT_FROM = "2025-06-01";
const DEFAULT_TO = "2025-09-15";

/** Buffer default sits inside the recommended 20-50 m window (story 4.3). */
const DEFAULT_BUFFER_METRES = 30;

/** Coastal ribbon default — same order of magnitude as the landward buffer (issue #27). */
const DEFAULT_COAST_METRES = 30;

function emptyFeatureCollection(): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return { type: "FeatureCollection", features: [] };
}

/** Every candidate ring as its own feature, tagged so the selected one (or,
 * with "all rings" chosen, every one) can be styled apart from the offshore
 * noise (story 4.1). */
function ringsFeatureCollection(
  rings: ContourRing[],
  selected: ContourRing | null,
  allSelected: boolean,
): GeoJSON.FeatureCollection<GeoJSON.Polygon, { selected: boolean }> {
  return {
    type: "FeatureCollection",
    features: rings.map((ring) => ({
      type: "Feature",
      properties: { selected: allSelected || ring === selected },
      geometry: ring.polygon,
    })),
  };
}

function boundaryFeature(
  geometry: GeoJSON.MultiPolygon | null,
): GeoJSON.FeatureCollection<GeoJSON.MultiPolygon> {
  return {
    type: "FeatureCollection",
    features:
      geometry && geometry.coordinates.length > 0
        ? [{ type: "Feature", properties: {}, geometry }]
        : [],
  };
}

/**
 * Vertex and area totals across *every* piece. The buffer panel used to read
 * these off the largest ring alone, which understated a boundary made of
 * several disjoint survey areas (issue #33).
 */
function polygonStats(geometry: GeoJSON.MultiPolygon | null): {
  vertexCount: number;
  areaM2: number;
} {
  if (!geometry || geometry.coordinates.length === 0) return { vertexCount: 0, areaM2: 0 };
  return {
    vertexCount: countVertices(geometry),
    areaM2: contourRings(geometry, 0).reduce((total, ring) => total + ring.areaM2, 0),
  };
}

function bboxToFeatureCollection(bbox: BBox): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [minLon, minLat],
              [maxLon, minLat],
              [maxLon, maxLat],
              [minLon, maxLat],
              [minLon, minLat],
            ],
          ],
        },
      },
    ],
  };
}

/** The rectangle mode draws an axis-aligned lon/lat box, so its ring's min/max corners are the bbox. */
function polygonToBbox(coordinates: number[][][]): BBox {
  const ring = coordinates[0] ?? [];
  const lons = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);

  const [bbox, setBboxState] = useState<BBox | null>(null);
  /**
   * Mirrors `bbox`. The terra-draw "finish" handler is registered once at mount,
   * so its closure would otherwise read a `bbox` that is forever null.
   */
  const bboxRef = useRef<BBox | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const isDrawingRef = useRef(false);

  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [composite, setComposite] = useState<Composite | null>(null);
  const [loadingComposite, setLoadingComposite] = useState(false);
  const [compositeError, setCompositeError] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.8);
  const [layerView, setLayerView] = useState<LayerView>("depth");
  const [ratioRange, setRatioRange] = useState<{ min: number; max: number } | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  // Simplification tolerance, landward buffer, and the ring-noise filter are
  // tuned per AOI but tend to converge on a good value for a given site, so
  // they're persisted across sessions rather than reset to a default every load.
  const [tolerance, setTolerance] = useState(() => loadStoredNumber("tolerance", 0));
  const [bufferMetres, setBufferMetres] = useState(() =>
    loadStoredNumber("bufferMetres", DEFAULT_BUFFER_METRES),
  );
  const [coastMetres, setCoastMetres] = useState(() =>
    loadStoredNumber("coastMetres", DEFAULT_COAST_METRES),
  );
  const [minRingAreaM2, setMinRingAreaM2] = useState(() =>
    loadStoredNumber("minRingAreaM2", MIN_RING_AREA_M2),
  );

  /**
   * The point a Planner last picked, geographically — not a ring index, which
   * has no stable meaning once the contour is rebuilt from scratch on a
   * threshold change. Recomputed selection re-finds whichever new ring still
   * contains this point (story 4.1's "survives a threshold change" criterion).
   */
  const [selectedAnchor, setSelectedAnchor] = useState<GeoJSON.Position | null>(null);
  /** "All rings" mode: the flight area is every candidate ring, unioned, rather
   * than the one `selectedAnchor` picks out. */
  const [allRingsSelected, setAllRingsSelected] = useState(false);

  /** Which sidebar section is expanded — exactly one at a time, "aoi" on load. */
  const [activeSection, setActiveSection] = useState("aoi");

  function showBbox(next: BBox | null) {
    bboxRef.current = next;
    setBboxState(next);
    const source = mapRef.current?.getSource(AOI_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(next ? bboxToFeatureCollection(next) : emptyFeatureCollection());
  }

  function applyBbox(next: BBox) {
    // Everything downstream is computed for one specific bbox: the composite is
    // fetched for it, the contour comes from that composite, and the KML comes
    // from that contour. Moving the AOI invalidates the lot, so drop it rather
    // than leave a raster and a contour pinned to the previous box — a Planner
    // would otherwise happily export a flight boundary for the wrong stretch of
    // coast, with nothing on screen saying so.
    if (!sameBbox(bboxRef.current, next)) clearComposite();
    showBbox(next);
    storeAoi(next);
  }

  function handleStartDraw() {
    const draw = drawRef.current;
    if (!draw) return;
    draw.start();
    draw.setMode("rectangle");
    setIsDrawing(true);
  }

  function handleClear() {
    const draw = drawRef.current;
    if (isDrawing && draw) {
      draw.clear();
      draw.stop();
      setIsDrawing(false);
    }
    showBbox(null);
    clearStoredAoi();
    clearComposite();
  }

  function clearComposite() {
    setComposite(null);
    setCompositeError(null);
    setRatioRange(null);
    setThreshold(null);
    setSelectedAnchor(null);
    setAllRingsSelected(false);
    // The later sections this invalidates are about to unmount — fall back to
    // the first one rather than leaving the accordion pointed at nothing.
    setActiveSection("aoi");
    const map = mapRef.current;
    if (map?.getLayer(DEPTH_LAYER_ID)) map.removeLayer(DEPTH_LAYER_ID);
    if (map?.getSource(DEPTH_SOURCE_ID)) map.removeSource(DEPTH_SOURCE_ID);
  }

  /** Paints the active layer (depth or scene count) into an image source pinned to its own bbox corners. */
  function paintLayer(next: Composite, mode: LayerView) {
    const map = mapRef.current;
    if (!map) return;

    const range = mode === "depth" ? waterRange(next) : sceneCountRange(next);
    if (!range) return;

    const canvas = document.createElement("canvas");
    canvas.width = next.width;
    canvas.height = next.height;
    const imageData =
      mode === "depth" ? renderComposite(next, range) : renderSceneCount(next, range);
    canvas.getContext("2d")?.putImageData(imageData, 0, 0);

    const [minLon, minLat, maxLon, maxLat] = next.bbox;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [minLon, maxLat],
      [maxLon, maxLat],
      [maxLon, minLat],
      [minLon, minLat],
    ];
    const url = canvas.toDataURL("image/png");

    const existing = map.getSource(DEPTH_SOURCE_ID) as ImageSource | undefined;
    if (existing) {
      existing.updateImage({ url, coordinates });
    } else {
      map.addSource(DEPTH_SOURCE_ID, { type: "image", url, coordinates });
      // Below the AOI outline so the boundary stays visible on top of the ramp.
      map.addLayer(
        {
          id: DEPTH_LAYER_ID,
          type: "raster",
          source: DEPTH_SOURCE_ID,
          paint: { "raster-opacity": opacity, "raster-resampling": "nearest" },
        },
        map.getLayer("aoi-fill") ? "aoi-fill" : undefined,
      );
    }
  }

  async function handleLoadComposite() {
    if (!bbox) return;
    setLoadingComposite(true);
    setCompositeError(null);
    try {
      const next = await fetchComposite({ bbox, from, to });
      const range = waterRange(next);
      if (!range) {
        setCompositeError("The composite has no water pixels — check the AOI and the date range.");
        return;
      }
      setRatioRange(range);
      // Start mid-range: an arbitrary but visible starting point the Planner drags from.
      setThreshold((current) => current ?? (range.min + range.max) / 2);
      setComposite(next);
    } catch (err) {
      setCompositeError(err instanceof Error ? err.message : "Could not load the composite.");
    } finally {
      setLoadingComposite(false);
    }
  }

  function handlePasteApply(text: string): string | null {
    try {
      const parsed = parseBboxInput(text);
      if (isDrawing) {
        drawRef.current?.clear();
        drawRef.current?.stop();
        setIsDrawing(false);
      }
      applyBbox(parsed);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Could not parse that input.";
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only setup; applyBbox/showBbox read refs, not state, so re-running on every render would be wrong
  useEffect(() => {
    // Created once and kept for the lifetime of the page. React StrictMode invokes
    // this effect twice against the same container; tearing the map down and
    // rebuilding it left two instances fighting over one canvas, with the visible
    // one missing every source added during setup.
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: KILADHA_CENTER,
      zoom: KILADHA_ZOOM,
    });
    map.addControl(new NavigationControl(), "top-right");
    mapRef.current = map;

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [new TerraDrawRectangleMode()],
    });
    drawRef.current = draw;

    draw.on("finish", (id) => {
      const feature = draw.getSnapshot().find((f) => f.id === id);
      draw.clear();
      draw.stop();
      setIsDrawing(false);
      if (feature?.geometry.type === "Polygon") {
        applyBbox(polygonToBbox(feature.geometry.coordinates));
      }
    });

    // Driven by styledata rather than a one-shot "load" listener, and made
    // idempotent by the getSource guard. React StrictMode mounts this effect
    // twice against the same container, and "load" can fire on the instance that
    // gets discarded — which previously left the surviving map with no AOI or
    // contour sources at all, so setData silently did nothing.
    const ensureOverlays = () => {
      if (!map.isStyleLoaded() || map.getSource(AOI_SOURCE_ID)) return;

      map.addSource(AOI_SOURCE_ID, { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({
        id: "aoi-fill",
        type: "fill",
        source: AOI_SOURCE_ID,
        paint: { "fill-color": "#1e88e5", "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: "aoi-outline",
        type: "line",
        source: AOI_SOURCE_ID,
        paint: { "line-color": "#1e88e5", "line-width": 2 },
      });

      // All candidate rings, styled apart by the "selected" flag (story 4.1).
      map.addSource(RINGS_SOURCE_ID, {
        type: "geojson",
        data: ringsFeatureCollection([], null, false),
      });
      map.addLayer({
        id: "rings-fill",
        type: "fill",
        source: RINGS_SOURCE_ID,
        paint: {
          "fill-color": ["case", ["get", "selected"], "#ffb300", "#9e9e9e"],
          "fill-opacity": ["case", ["get", "selected"], 0.25, 0.12],
        },
      });
      map.addLayer({
        id: "rings-outline",
        type: "line",
        source: RINGS_SOURCE_ID,
        paint: {
          "line-color": ["case", ["get", "selected"], "#ffb300", "#9e9e9e"],
          "line-width": ["case", ["get", "selected"], 2, 1],
        },
      });

      // The final flight boundary: selected ring, buffered, then simplified.
      map.addSource(BOUNDARY_SOURCE_ID, { type: "geojson", data: boundaryFeature(null) });
      map.addLayer({
        id: "boundary-fill",
        type: "fill",
        source: BOUNDARY_SOURCE_ID,
        paint: { "fill-color": "#2e7d32", "fill-opacity": 0.2 },
      });
      map.addLayer({
        id: "boundary-line",
        type: "line",
        source: BOUNDARY_SOURCE_ID,
        paint: { "line-color": "#2e7d32", "line-width": 3 },
      });

      map.on("mouseenter", "rings-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "rings-fill", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", "rings-fill", (e) => {
        if (isDrawingRef.current) return;
        const point: GeoJSON.Position = [e.lngLat.lng, e.lngLat.lat];
        const match = findRingContaining(ringsRef.current, point);
        if (match) {
          setAllRingsSelected(false);
          setSelectedAnchor(match.anchor);
        }
      });

      const stored = loadStoredAoi();
      if (stored) showBbox(stored);
    };

    // "load" is the normal path; "idle" is the safety net — it fires whenever the
    // map has finished rendering, so the overlays land even if "load" was missed.
    map.on("load", ensureOverlays);
    map.on("idle", ensureOverlays);
  }, []);

  useEffect(() => {
    isDrawingRef.current = isDrawing;
  }, [isDrawing]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer(DEPTH_LAYER_ID)) {
      map.setPaintProperty(DEPTH_LAYER_ID, "raster-opacity", opacity);
    }
  }, [opacity]);

  useEffect(() => storeNumber("tolerance", tolerance), [tolerance]);
  useEffect(() => storeNumber("bufferMetres", bufferMetres), [bufferMetres]);
  useEffect(() => storeNumber("coastMetres", coastMetres), [coastMetres]);
  useEffect(() => storeNumber("minRingAreaM2", minRingAreaM2), [minRingAreaM2]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: paintLayer is redefined every render and reads opacity from render scope on purpose — see the opacity effect above for live opacity updates
  useEffect(() => {
    if (composite) paintLayer(composite, layerView);
  }, [composite, layerView]);

  /**
   * Recomputed synchronously as the slider moves. A Kiladha-sized grid contours in
   * a few milliseconds, comfortably inside the story's 200 ms budget; if a much
   * larger AOI ever makes this stutter, this is the thing to move off the main thread.
   */
  const contour = useMemo(() => {
    if (!composite || threshold === null) return null;
    return shallowWaterContour(composite, threshold);
  }, [composite, threshold]);

  /** Every ring of the raw contour, largest first — the Planner's candidates (story 4.1). */
  const rings = useMemo(
    () => (contour ? contourRings(contour, minRingAreaM2) : []),
    [contour, minRingAreaM2],
  );
  const ringsRef = useRef<ContourRing[]>([]);
  useEffect(() => {
    ringsRef.current = rings;
  }, [rings]);

  /** The ring containing the last picked point, or the largest ring by default. */
  const selectedRing = useMemo(() => {
    if (rings.length === 0) return null;
    if (selectedAnchor) {
      const match = findRingContaining(rings, selectedAnchor);
      if (match) return match;
    }
    return rings[0];
  }, [rings, selectedAnchor]);

  // Keeps the tracked point pinned to whichever ring ends up selected, so the
  // *next* threshold change matches against this ring's current shape rather
  // than an increasingly stale click position.
  useEffect(() => {
    if (selectedRing) setSelectedAnchor(selectedRing.anchor);
  }, [selectedRing]);

  /**
   * The raw geometry the buffer step grows: either the one selected ring, or
   * every ring unioned together when the Planner picked "All rings" — e.g. a
   * survey area that a Posidonia gap split into a few adjacent fragments.
   */
  const combinedPolygon = useMemo<GeoJSON.MultiPolygon | null>(() => {
    if (!allRingsSelected) return selectedRing ? toMultiPolygon(selectedRing.polygon) : null;
    if (rings.length === 0) return null;
    return rings
      .map((ring) => toMultiPolygon(ring.polygon))
      .reduce((acc, polygon) => unionPolygons(acc, polygon));
  }, [allRingsSelected, selectedRing, rings]);

  /** Stats for the buffer step's "before" column — the combined ring(s) as
   * picked above, unbuffered. */
  const combinedStats = useMemo(() => polygonStats(combinedPolygon), [combinedPolygon]);

  /**
   * Grown outward so flight lines reach past the raw contour and catch
   * shoreline features — SfM has no tie points over open water (story 4.3).
   * Derived, never applied in place: `combinedPolygon` stays unbuffered so
   * dragging the distance back to 0 restores it exactly.
   */
  const bufferedPolygon = useMemo(
    () => (combinedPolygon ? bufferPolygon(combinedPolygon, bufferMetres) : null),
    [combinedPolygon, bufferMetres],
  );

  const bufferedStats = useMemo(() => polygonStats(bufferedPolygon), [bufferedPolygon]);

  /**
   * The composite's land/no-data mask, standing in for a coastline since the
   * repo has no coastline data source (issue #27).
   */
  const land = useMemo(() => (composite ? landMask(composite) : null), [composite]);

  /**
   * A continuous strip along the whole coastline out to `coastMetres`,
   * guaranteeing near-shore coverage even where the depth contour has a gap.
   */
  const ribbon = useMemo(
    // The composite's own bbox, not the AOI state: `land` is traced from that
    // grid, so that is the rectangle its artificial cuts lie on (issue #32).
    () => (land && composite ? coastalRibbon(land, coastMetres, composite.bbox) : null),
    [land, composite, coastMetres],
  );

  /**
   * The depth-contour ring and the coastal ribbon, merged. Every disjoint
   * piece survives to the export as its own Placemark (issue #33). Derived,
   * never applied in place, same as the buffer step above.
   */
  const mergedPolygon = useMemo(() => {
    if (!bufferedPolygon) return null;
    return ribbon ? unionPolygons(bufferedPolygon, ribbon) : bufferedPolygon;
  }, [bufferedPolygon, ribbon]);

  /**
   * The buffer step grows geometry outward in unbounded space, so wherever
   * the raw contour touches the AOI's edge, the grown result juts past it
   * (issue #29). Clipping back to the AOI here — after the union, equivalent
   * to clipping each side beforehand — restores that edge as the boundary's
   * hard limit. (The ribbon arrives already bounded, since issue #32.)
   */
  const clippedPolygon = useMemo(() => {
    if (!mergedPolygon || !bbox) return mergedPolygon;
    return clipToBbox(mergedPolygon, bbox);
  }, [mergedPolygon, bbox]);

  /**
   * Simplification is derived, never applied in place: `clippedPolygon` stays
   * at full resolution so dragging the tolerance back restores every vertex
   * (story 4.2's non-destructive requirement).
   */
  const boundary = useMemo(
    () => (clippedPolygon ? simplifyContour(clippedPolygon, tolerance) : null),
    [clippedPolygon, tolerance],
  );

  useEffect(() => {
    const source = mapRef.current?.getSource(RINGS_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(ringsFeatureCollection(rings, selectedRing, allRingsSelected));
  }, [rings, selectedRing, allRingsSelected]);

  useEffect(() => {
    const source = mapRef.current?.getSource(BOUNDARY_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(boundaryFeature(boundary));
  }, [boundary]);

  const areaKm2 = useMemo(() => (bbox ? bboxAreaKm2(bbox) : null), [bbox]);
  const limitCheck: ProcessingApiLimitCheck | null = useMemo(
    () => (bbox ? checkProcessingApiLimit(bbox) : null),
    [bbox],
  );

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div className="sidebar">
        <AccordionContext.Provider
          value={{ activeId: activeSection, setActiveId: setActiveSection }}
        >
          <AoiPanel
            bbox={bbox}
            areaKm2={areaKm2}
            limitCheck={limitCheck}
            isDrawing={isDrawing}
            onStartDraw={handleStartDraw}
            onClear={handleClear}
            onPasteApply={handlePasteApply}
          />
          <DepthPanel
            hasAoi={bbox !== null}
            from={from}
            to={to}
            onFromChange={setFrom}
            onToChange={setTo}
            onLoad={handleLoadComposite}
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
      </div>
    </div>
  );
}
