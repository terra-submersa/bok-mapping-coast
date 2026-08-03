import { type Aoi, type ContourRing, findRingContaining } from "@bok/core";
import {
  type GeoJSONSource,
  type ImageSource,
  Map as MapLibreMap,
  NavigationControl,
  type StyleSpecification,
} from "maplibre-gl";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Outlet } from "react-router";
import { TerraDraw, TerraDrawPolygonMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { BoundaryProvider, useBoundaryState } from "./BoundaryContext.js";
import type { Composite } from "./composite.js";
import type { LayerView } from "./DepthPanel.js";
import { renderComposite, renderSceneCount, sceneCountRange, waterRange } from "./depth-ramp.js";
import { useProject } from "./ProjectContext.js";
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
 * Satellite imagery, not a street basemap: story 2.3 exists so the Planner can judge
 * the contour against sand, rock and Posidonia they recognise. Esri World Imagery
 * needs no API key; attribution is required.
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

function emptyFeatureCollection(): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return { type: "FeatureCollection", features: [] };
}

/**
 * Every candidate ring as its own feature, tagged so the selected one (or, with "all
 * rings" chosen, every one) can be styled apart from the offshore noise (story 4.1).
 */
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

function aoiFeatureCollection(aoi: Aoi | null): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  if (!aoi) return emptyFeatureCollection();
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: aoi }],
  };
}

/** The drawing controls a sidebar panel needs. The map instance itself stays private. */
export interface MapContextValue {
  startDraw: () => void;
  stopDraw: () => void;
}

const MapContext = createContext<MapContextValue | null>(null);

export function useMapControls(): MapContextValue {
  const ctx = useContext(MapContext);
  if (!ctx) throw new Error("useMapControls must be called inside MapLayout.");
  return ctx;
}

/**
 * The map, and the sidebar slot the current step fills.
 *
 * This is a react-router *layout* route, which is the whole point: `/area` and
 * `/boundary` render different sidebars over one MapLibre instance that is never torn
 * down between them (issue #38). Every layer is painted here rather than in a page, so
 * the boundary you are tuning on the Boundary step is still on screen when you go back
 * to Area to trim the AOI.
 */
export function MapLayout() {
  return (
    <BoundaryProvider>
      <MapSurface />
    </BoundaryProvider>
  );
}

function MapSurface() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const [overlaysReady, setOverlaysReady] = useState(false);

  const {
    aoi,
    applyAoi,
    isDrawing,
    setIsDrawing,
    composite,
    opacity,
    layerView,
    setSelectedAnchor,
    setAllRingsSelected,
    allRingsSelected,
  } = useProject();
  const { rings, selectedRing, boundary } = useBoundaryState();

  /** Read by handlers registered once at mount, which cannot see current state. */
  const isDrawingRef = useRef(isDrawing);
  const ringsRef = useRef<ContourRing[]>(rings);
  useEffect(() => {
    isDrawingRef.current = isDrawing;
  }, [isDrawing]);
  useEffect(() => {
    ringsRef.current = rings;
  }, [rings]);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only setup; the handlers it registers read refs and stable setters, so re-running on every render would be wrong
  useEffect(() => {
    // Created once and kept for the lifetime of the page. React StrictMode invokes this
    // effect twice against the same container; tearing the map down and rebuilding it
    // left two instances fighting over one canvas, with the visible one missing every
    // source added during setup.
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
      // A polygon, not a rectangle: Kiladha Bay is not box-shaped, and reducing
      // whatever was drawn to its min/max corners is what D10 undoes.
      modes: [new TerraDrawPolygonMode()],
    });
    drawRef.current = draw;

    draw.on("finish", (id) => {
      const feature = draw.getSnapshot().find((f) => f.id === id);
      draw.clear();
      draw.stop();
      setIsDrawing(false);
      if (feature?.geometry.type === "Polygon") {
        applyAoi(feature.geometry);
      }
    });

    // Driven by styledata rather than a one-shot "load" listener, and made idempotent by
    // the getSource guard. React StrictMode mounts this effect twice against the same
    // container, and "load" can fire on the instance that gets discarded — which
    // previously left the surviving map with no AOI or contour sources at all, so
    // setData silently did nothing.
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

      setOverlaysReady(true);
    };

    // "load" is the normal path; "idle" is the safety net — it fires whenever the map
    // has finished rendering, so the overlays land even if "load" was missed.
    map.on("load", ensureOverlays);
    map.on("idle", ensureOverlays);
  }, []);

  useEffect(() => {
    if (!overlaysReady) return;
    const source = mapRef.current?.getSource(AOI_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(aoiFeatureCollection(aoi));
  }, [overlaysReady, aoi]);

  useEffect(() => {
    if (!overlaysReady) return;
    const source = mapRef.current?.getSource(RINGS_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(ringsFeatureCollection(rings, selectedRing, allRingsSelected));
  }, [overlaysReady, rings, selectedRing, allRingsSelected]);

  useEffect(() => {
    if (!overlaysReady) return;
    const source = mapRef.current?.getSource(BOUNDARY_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(boundaryFeature(boundary));
  }, [overlaysReady, boundary]);

  // Dropping the composite has to take its layer with it, or a stale depth ramp stays
  // painted over an AOI it no longer belongs to — the bug issue #2's closing note is about.
  // biome-ignore lint/correctness/useExhaustiveDependencies: paintLayer is redefined every render and reads opacity from render scope on purpose — see the opacity effect below for live updates
  useEffect(() => {
    if (!overlaysReady) return;
    const map = mapRef.current;
    if (composite) {
      paintLayer(composite, layerView);
      return;
    }
    if (map?.getLayer(DEPTH_LAYER_ID)) map.removeLayer(DEPTH_LAYER_ID);
    if (map?.getSource(DEPTH_SOURCE_ID)) map.removeSource(DEPTH_SOURCE_ID);
  }, [overlaysReady, composite, layerView]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer(DEPTH_LAYER_ID)) {
      map.setPaintProperty(DEPTH_LAYER_ID, "raster-opacity", opacity);
    }
  }, [opacity]);

  const controls: MapContextValue = {
    startDraw: () => {
      const draw = drawRef.current;
      if (!draw) return;
      draw.start();
      draw.setMode("polygon");
      setIsDrawing(true);
    },
    stopDraw: () => {
      const draw = drawRef.current;
      if (!draw || !isDrawing) return;
      draw.clear();
      draw.stop();
      setIsDrawing(false);
    },
  };

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div className="sidebar">
        <MapContext.Provider value={controls}>
          <Outlet />
        </MapContext.Provider>
      </div>
    </div>
  );
}
