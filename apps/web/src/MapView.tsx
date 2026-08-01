import {
  type BBox,
  bboxAreaKm2,
  checkProcessingApiLimit,
  countVertices,
  type ProcessingApiLimitCheck,
  parseBboxInput,
  type Range,
  shallowWaterContour,
  simplifyContour,
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
import { AoiPanel } from "./AoiPanel.js";
import { clearStoredAoi, loadStoredAoi, storeAoi } from "./aoi-storage.js";
import { type Composite, fetchComposite } from "./composite.js";
import { DepthPanel } from "./DepthPanel.js";
import { renderComposite, waterRange } from "./depth-ramp.js";
import { SimplifyPanel } from "./SimplifyPanel.js";
import { ThresholdPanel } from "./ThresholdPanel.js";
import "maplibre-gl/dist/maplibre-gl.css";

// Kiladha Bay, Argolic Gulf — same AOI as scripts/spike-sdb-kiladha.mjs.
const KILADHA_CENTER: [number, number] = [23.1225, 37.4265];
const KILADHA_ZOOM = 14;

const AOI_SOURCE_ID = "aoi";
const DEPTH_SOURCE_ID = "depth";
const DEPTH_LAYER_ID = "depth-raster";
const CONTOUR_SOURCE_ID = "contour";

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

function emptyFeatureCollection(): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return { type: "FeatureCollection", features: [] };
}

/** MapLibre's GeoJSON source wants a Feature or FeatureCollection, not a bare geometry. */
function contourFeature(
  geometry: GeoJSON.MultiPolygon | null,
): GeoJSON.FeatureCollection<GeoJSON.MultiPolygon> {
  return {
    type: "FeatureCollection",
    features: geometry ? [{ type: "Feature", properties: {}, geometry }] : [],
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
  const [isDrawing, setIsDrawing] = useState(false);

  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [composite, setComposite] = useState<Composite | null>(null);
  const [loadingComposite, setLoadingComposite] = useState(false);
  const [compositeError, setCompositeError] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.8);
  const [ratioRange, setRatioRange] = useState<Range | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [tolerance, setTolerance] = useState(0);

  function showBbox(next: BBox | null) {
    setBboxState(next);
    const source = mapRef.current?.getSource(AOI_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(next ? bboxToFeatureCollection(next) : emptyFeatureCollection());
  }

  function applyBbox(next: BBox) {
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
    const map = mapRef.current;
    if (map?.getLayer(DEPTH_LAYER_ID)) map.removeLayer(DEPTH_LAYER_ID);
    if (map?.getSource(DEPTH_SOURCE_ID)) map.removeSource(DEPTH_SOURCE_ID);
  }

  /** Paints the composite into an image source pinned to its own bbox corners. */
  function paintComposite(next: Composite) {
    const map = mapRef.current;
    if (!map) return;

    const range = waterRange(next);
    if (!range) {
      setCompositeError("The composite has no water pixels — check the AOI and the date range.");
      return;
    }
    setRatioRange(range);
    // Start mid-range: an arbitrary but visible starting point the Planner drags from.
    setThreshold((current) => current ?? (range.min + range.max) / 2);

    const canvas = document.createElement("canvas");
    canvas.width = next.width;
    canvas.height = next.height;
    canvas.getContext("2d")?.putImageData(renderComposite(next, range), 0, 0);

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
      setComposite(next);
      paintComposite(next);
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

      map.addSource(CONTOUR_SOURCE_ID, { type: "geojson", data: contourFeature(null) });
      map.addLayer({
        id: "contour-fill",
        type: "fill",
        source: CONTOUR_SOURCE_ID,
        paint: { "fill-color": "#ffd54f", "fill-opacity": 0.25 },
      });
      map.addLayer({
        id: "contour-line",
        type: "line",
        source: CONTOUR_SOURCE_ID,
        paint: { "line-color": "#ffb300", "line-width": 2 },
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
    const map = mapRef.current;
    if (map?.getLayer(DEPTH_LAYER_ID)) {
      map.setPaintProperty(DEPTH_LAYER_ID, "raster-opacity", opacity);
    }
  }, [opacity]);

  /**
   * Recomputed synchronously as the slider moves. A Kiladha-sized grid contours in
   * a few milliseconds, comfortably inside the story's 200 ms budget; if a much
   * larger AOI ever makes this stutter, this is the thing to move off the main thread.
   */
  const contour = useMemo(() => {
    if (!composite || threshold === null) return null;
    return shallowWaterContour(composite, threshold);
  }, [composite, threshold]);

  /**
   * Simplification is derived, never applied in place: `contour` stays at full
   * resolution so dragging the tolerance back restores every vertex (story 4.2's
   * non-destructive requirement).
   */
  const simplified = useMemo(
    () => (contour ? simplifyContour(contour, tolerance) : null),
    [contour, tolerance],
  );

  useEffect(() => {
    const source = mapRef.current?.getSource(CONTOUR_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(contourFeature(simplified));
  }, [simplified]);

  const areaKm2 = useMemo(() => (bbox ? bboxAreaKm2(bbox) : null), [bbox]);
  const limitCheck: ProcessingApiLimitCheck | null = useMemo(
    () => (bbox ? checkProcessingApiLimit(bbox) : null),
    [bbox],
  );

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div className="sidebar">
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
        />
        {ratioRange && threshold !== null && (
          <ThresholdPanel
            range={ratioRange}
            threshold={threshold}
            onThresholdChange={setThreshold}
            vertexCount={contour ? countVertices(contour) : 0}
            ringCount={contour ? contour.coordinates.length : 0}
          />
        )}
        {contour && simplified && (
          <SimplifyPanel
            tolerance={tolerance}
            onToleranceChange={setTolerance}
            originalVertices={countVertices(contour)}
            simplifiedVertices={countVertices(simplified)}
            ringCount={simplified.coordinates.length}
          />
        )}
      </div>
    </div>
  );
}
