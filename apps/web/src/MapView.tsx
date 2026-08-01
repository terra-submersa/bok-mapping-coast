import {
  type BBox,
  bboxAreaKm2,
  checkProcessingApiLimit,
  type ProcessingApiLimitCheck,
  parseBboxInput,
} from "@bok/core";
import {
  type GeoJSONSource,
  Map as MapLibreMap,
  NavigationControl,
  type StyleSpecification,
} from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { TerraDraw, TerraDrawRectangleMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { AoiPanel } from "./AoiPanel.js";
import { clearStoredAoi, loadStoredAoi, storeAoi } from "./aoi-storage.js";
import "maplibre-gl/dist/maplibre-gl.css";

// Kiladha Bay, Argolic Gulf — same AOI as scripts/spike-sdb-kiladha.mjs.
const KILADHA_CENTER: [number, number] = [23.1225, 37.4265];
const KILADHA_ZOOM = 14;

const AOI_SOURCE_ID = "aoi";

// Plain OSM raster tiles — no API key required. Swap for a vector style once
// one is chosen (story 2.3 needs imagery, not a street basemap).
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

function emptyFeatureCollection(): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return { type: "FeatureCollection", features: [] };
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
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: OSM_STYLE,
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

    map.on("load", () => {
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

      const stored = loadStoredAoi();
      if (stored) showBbox(stored);
    });

    return () => {
      draw.stop();
      map.remove();
    };
  }, []);

  const areaKm2 = useMemo(() => (bbox ? bboxAreaKm2(bbox) : null), [bbox]);
  const limitCheck: ProcessingApiLimitCheck | null = useMemo(
    () => (bbox ? checkProcessingApiLimit(bbox) : null),
    [bbox],
  );

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <AoiPanel
        bbox={bbox}
        areaKm2={areaKm2}
        limitCheck={limitCheck}
        isDrawing={isDrawing}
        onStartDraw={handleStartDraw}
        onClear={handleClear}
        onPasteApply={handlePasteApply}
      />
    </div>
  );
}
