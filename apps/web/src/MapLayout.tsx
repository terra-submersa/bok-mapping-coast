import {
  type Aoi,
  type ContourRing,
  type DepthContourLine,
  findRingContaining,
  nearestVertexIndex,
  normalise,
  removeVertex,
  type Sounding,
} from "@bok/core";
import {
  type GeoJSONSource,
  type ImageSource,
  Map as MapLibreMap,
  NavigationControl,
  type StyleSpecification,
} from "maplibre-gl";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Outlet } from "react-router";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { BoundaryProvider, useBoundaryState } from "./BoundaryContext.js";
import type { Composite } from "./composite.js";
import type { LayerView } from "./DepthPanel.js";
import {
  rampColour,
  renderComposite,
  renderSceneCount,
  sceneCountRange,
  waterRange,
} from "./depth-ramp.js";
import { resetDraw } from "./draw-lifecycle.js";
import { formatDepthM } from "./format.js";
import { useProject } from "./ProjectContext.js";
import { ToolCard } from "./ToolCard.js";
import { type ActiveTool, useTool } from "./ToolContext.js";
import { useDepthContours } from "./useDepthContours.js";
import "maplibre-gl/dist/maplibre-gl.css";

// Kiladha Bay, Argolic Gulf — same AOI as scripts/spike-sdb-kiladha.mjs.
const KILADHA_CENTER: [number, number] = [23.1225, 37.4265];
const KILADHA_ZOOM = 14;

const AOI_SOURCE_ID = "aoi";
const DEPTH_SOURCE_ID = "depth";
const DEPTH_LAYER_ID = "depth-raster";
const RINGS_SOURCE_ID = "rings";
const BOUNDARY_SOURCE_ID = "boundary";
const ZONES_SOURCE_ID = "zones";
const INCLUSIONS_SOURCE_ID = "inclusions";
const CONTOURS_SOURCE_ID = "depth-contours";
const SOUNDINGS_SOURCE_ID = "soundings";
const TOOLS_SOURCE_ID = "tools";

/**
 * Violet, because it is the one hue not already meaning something: blue is the AOI, amber
 * the candidate rings, green the boundary, red an exclusion, teal an inclusion, white a
 * sounding, and the depth ramp owns the contour lines. It also holds up over both dark
 * Posidonia and blown-out sand, which is the whole span of this basemap.
 */
const TOOL_COLOUR = "#e040fb";

/**
 * How close a shift-click has to land to count as "on" a vertex. A screen distance,
 * not a geographic one — a corner is grabbable at the same effort whether you are
 * zoomed to the whole gulf or to one jetty.
 */
const VERTEX_GRAB_PX = 12;

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

function zonesFeatureCollection(
  zones: GeoJSON.Polygon[],
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return {
    type: "FeatureCollection",
    features: zones.map((geometry) => ({ type: "Feature", properties: {}, geometry })),
  };
}

/**
 * Each measured depth as a point, labelled with its own reading (issue #49).
 *
 * The label is the whole point of the layer. A dot says a boat went there; "2.1" next to
 * a dot over a dark patch says whether the SDB agrees with the seabed, which is the
 * judgement Calibrate exists to support.
 */
function soundingsFeatureCollection(
  soundings: readonly Sounding[],
  excludedIds: readonly string[] = [],
): GeoJSON.FeatureCollection<GeoJSON.Point, { label: string; depthM: number; excluded: boolean }> {
  const excluded = new Set(excludedIds);
  return {
    type: "FeatureCollection",
    features: soundings.map((sounding) => ({
      type: "Feature",
      properties: {
        label: `${sounding.depthM} m`,
        depthM: sounding.depthM,
        // Greyed rather than hidden: a point left out of the fit is still a measurement,
        // and seeing where the excluded ones are is how you notice you have quietly
        // dropped one whole cluster (issue #12).
        excluded: excluded.has(sounding.id),
      },
      geometry: { type: "Point", coordinates: [sounding.lon, sounding.lat] },
    })),
  };
}

interface ContourProperties {
  depthM: number;
  label: string;
  colour: string;
  /** The cartographic index contour — every fifth line, drawn thicker. */
  index: boolean;
}

/**
 * One feature per depth level, carrying its own colour (issue #51).
 *
 * The colour is a property rather than an `["interpolate", …]` paint expression because
 * the stops would depend on the depth extent, which moves whenever the fit or the
 * composite changes — that would need a `setPaintProperty` effect, where `setData`
 * carries this for free. It is also literally `rampColour`, the function that painted
 * the raster underneath, so the lines cannot disagree with it.
 */
function contoursFeatureCollection(
  lines: readonly DepthContourLine[],
  extentM: { min: number; max: number } | null,
): GeoJSON.FeatureCollection<GeoJSON.MultiLineString, ContourProperties> {
  const interval = lines.length > 1 ? lines[1].depthM - lines[0].depthM : 0;
  return {
    type: "FeatureCollection",
    features: lines
      .filter((line) => line.geometry.coordinates.length > 0)
      .map((line) => {
        const [r, g, b] = rampColour(extentM ? normalise(line.depthM, extentM) : 0.5);
        return {
          type: "Feature",
          properties: {
            depthM: line.depthM,
            label: formatDepthM(line.depthM),
            colour: `rgb(${r} ${g} ${b})`,
            index: interval > 0 && Math.abs(line.depthM % (interval * 5)) < interval / 2,
          },
          geometry: line.geometry,
        };
      }),
  };
}

/**
 * Whatever the armed tool has collected, as one source feeding three layers (issue #53).
 *
 * Points and the segment joining them share a source because they are one overlay that
 * appears and disappears together; the layers filter on geometry type. Same shape as the
 * contour and sounding sources, so a single `setData` keeps all three in step.
 */
function toolsFeatureCollection(
  measurePoints: readonly GeoJSON.Position[],
  utmPoint: GeoJSON.Position | null,
): GeoJSON.FeatureCollection<GeoJSON.Point | GeoJSON.LineString, { label: string }> {
  const features: GeoJSON.Feature<GeoJSON.Point | GeoJSON.LineString, { label: string }>[] = [];

  measurePoints.forEach((position, index) => {
    features.push({
      type: "Feature",
      // A and B rather than 1 and 2: the card names them that way, and a bearing is read
      // as "A to B".
      properties: { label: index === 0 ? "A" : "B" },
      geometry: { type: "Point", coordinates: position },
    });
  });

  // A straight line between the two, which is what a geodesic this short is to within a
  // pixel. Over hundreds of kilometres it would visibly bow away from the true path — not
  // a case two clicks on one map view can reach, but the reason this is a rendering
  // convenience and not the thing being measured.
  if (measurePoints.length === 2) {
    features.push({
      type: "Feature",
      properties: { label: "" },
      geometry: { type: "LineString", coordinates: [...measurePoints] },
    });
  }

  if (utmPoint) {
    features.push({
      type: "Feature",
      properties: { label: "" },
      geometry: { type: "Point", coordinates: utmPoint },
    });
  }

  return { type: "FeatureCollection", features };
}

function aoiFeatureCollection(aoi: Aoi | null): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  if (!aoi) return emptyFeatureCollection();
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: aoi }],
  };
}

/** The drawing controls a sidebar panel needs. The map instance itself stays private. */
/** What a new polygon becomes when the Planner finishes drawing it. */
export type DrawTarget = "aoi" | "exclusion" | "inclusion";

export interface MapContextValue {
  startDraw: (target: DrawTarget) => void;
  drawTarget: DrawTarget | null;
  stopDraw: () => void;
  /** Reshaping mode: drag a corner, click a midpoint to insert, shift-click to delete. */
  isEditing: boolean;
  startEdit: () => void;
  stopEdit: () => void;
  /** Why the last gesture was refused, e.g. deleting the third-from-last corner. */
  editError: string | null;

  /**
   * Dropping a known-depth reference point (issue #12). Deliberately not a terra-draw
   * mode: this is one click producing one position, not a polygon, and terra-draw's
   * point mode would put a feature in its own store that then has to be reconciled with
   * the soundings the API owns.
   */
  isDroppingSounding: boolean;
  startDropSounding: () => void;
  stopDropSounding: () => void;
  /** Where the last drop landed, awaiting a depth. Cleared by the panel once saved. */
  droppedPoint: { lon: number; lat: number } | null;
  clearDroppedPoint: () => void;
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
  // `CalibrationProvider` used to sit here too. It moved up to `App` in issue #51 so the
  // header's contour menu can read the fit; `BoundaryProvider` stays, because the derived
  // chain is expensive and belongs to the routes that actually show a boundary.
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
  const [isEditing, setIsEditing] = useState(false);
  const [drawTarget, setDrawTarget] = useState<DrawTarget | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [isDroppingSounding, setIsDroppingSounding] = useState(false);
  const [droppedPoint, setDroppedPoint] = useState<{ lon: number; lat: number } | null>(null);

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
    exclusions,
    addExclusion,
    inclusions,
    addInclusion,
    soundings,
    excludedSoundingIds,
  } = useProject();
  const { rings, selectedRing, boundary } = useBoundaryState();
  const { activeTool, setActiveTool, measurePoints, utmPoint, pushToolPoint } = useTool();
  // The one call site. Deliberately not part of `useBoundary`: these lines read the
  // seabed and must not move with the threshold, the zones or the export settings.
  const { plan: contourPlan, lines: contourLines } = useDepthContours();

  /** Read by handlers registered once at mount, which cannot see current state. */
  const isDrawingRef = useRef(isDrawing);
  const ringsRef = useRef<ContourRing[]>(rings);
  const aoiRef = useRef<Aoi | null>(aoi);
  const isEditingRef = useRef(isEditing);
  /** terra-draw's id for the AOI while it is being reshaped. */
  const editedFeatureRef = useRef<string | number | undefined>(undefined);
  const drawTargetRef = useRef<DrawTarget | null>(drawTarget);
  const isDroppingSoundingRef = useRef(isDroppingSounding);
  /**
   * The armed tool, for the handlers registered once at mount. `pushToolPoint` goes in a
   * ref too: it is rebuilt whenever `activeTool` changes, and the mount-time closure would
   * otherwise keep calling the very first one, which believed no tool was armed.
   */
  const activeToolRef = useRef<ActiveTool>(activeTool);
  const pushToolPointRef = useRef(pushToolPoint);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  useEffect(() => {
    pushToolPointRef.current = pushToolPoint;
  }, [pushToolPoint]);
  useEffect(() => {
    isDroppingSoundingRef.current = isDroppingSounding;
  }, [isDroppingSounding]);
  useEffect(() => {
    isDrawingRef.current = isDrawing;
  }, [isDrawing]);
  useEffect(() => {
    ringsRef.current = rings;
  }, [rings]);
  useEffect(() => {
    aoiRef.current = aoi;
  }, [aoi]);
  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);
  useEffect(() => {
    drawTargetRef.current = drawTarget;
  }, [drawTarget]);

  /** Paints the active layer (depth or scene count) into an image source pinned to its own bbox corners. */
  function paintLayer(next: Composite, mode: LayerView) {
    const map = mapRef.current;
    if (!map) return;

    const range = mode === "depth" ? waterRange(next) : sceneCountRange(next);
    if (!range) return;

    // Sized from the ImageData, not from the composite: a tiled raster (issue #41) can be
    // 7500 px across, and a canvas that size — plus the toDataURL below — is hundreds of
    // megabytes. The renderers decimate for display; the canvas has to follow them or the
    // pixels land in the wrong place (issue #42).
    const imageData =
      mode === "depth" ? renderComposite(next, range) : renderSceneCount(next, range);
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
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
      modes: [
        // A polygon, not a rectangle: Kiladha Bay is not box-shaped, and reducing
        // whatever was drawn to its min/max corners is what D10 undoes.
        new TerraDrawPolygonMode(),
        // Reshaping, once it exists (issue #37). `midpoints` is what puts a handle
        // between every pair of corners, so inserting one is a click; `deletable`
        // is terra-draw's own right-click delete. The shift-click the story asks
        // for is not reachable from here — select mode hardwires coordinate
        // deletion to onRightClick and never consults the event's held keys — so
        // it is a map-level handler further down.
        new TerraDrawSelectMode({
          flags: {
            polygon: {
              feature: {
                draggable: true,
                coordinates: { draggable: true, midpoints: true, deletable: true },
              },
            },
          },
        }),
      ],
    });
    drawRef.current = draw;

    draw.on("finish", (id, context) => {
      const feature = draw.getSnapshot().find((f) => f.id === id);
      if (feature?.geometry.type !== "Polygon") return;

      if (context.action === "draw") {
        const target = drawTargetRef.current;
        setIsDrawing(false);
        setDrawTarget(null);

        if (target === "exclusion" || target === "inclusion") {
          // Zones are a list, not the one shape being reshaped, so terra-draw's copy
          // goes; the map renders them from state like the AOI outside edit mode.
          resetDraw(draw);
          if (target === "exclusion") addExclusion(feature.geometry);
          else addInclusion(feature.geometry);
          return;
        }

        // A freshly drawn AOI. Kept in the store rather than cleared, so the Planner
        // can go straight on to reshaping it.
        editedFeatureRef.current = id;
        setIsEditing(true);
        draw.setMode("select");
        applyAoi(feature.geometry);
        return;
      }

      // Every other action is an edit of the shape already there: a dragged corner,
      // an inserted midpoint, terra-draw's own right-click delete, or the whole
      // feature moved. `finish` fires once per gesture, not once per frame, which is
      // what keeps the pipeline from recomputing on every mouse move.
      applyAoi(feature.geometry);
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

      // Inclusion zones, under the exclusions: an addition can legitimately be cut
      // by one, and the cut has to be the thing you see (issue #16).
      map.addSource(INCLUSIONS_SOURCE_ID, { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({
        id: "inclusions-fill",
        type: "fill",
        source: INCLUSIONS_SOURCE_ID,
        paint: { "fill-color": "#00838f", "fill-opacity": 0.25 },
      });
      map.addLayer({
        id: "inclusions-outline",
        type: "line",
        source: INCLUSIONS_SOURCE_ID,
        paint: { "line-color": "#00838f", "line-width": 2, "line-dasharray": [2, 1] },
      });

      // Exclusion zones, drawn over the boundary: a cut has to be legible against
      // the green it is taken out of (issue #17).
      map.addSource(ZONES_SOURCE_ID, { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({
        id: "zones-fill",
        type: "fill",
        source: ZONES_SOURCE_ID,
        paint: { "fill-color": "#c62828", "fill-opacity": 0.3 },
      });
      map.addLayer({
        id: "zones-outline",
        type: "line",
        source: ZONES_SOURCE_ID,
        paint: { "line-color": "#c62828", "line-width": 2, "line-dasharray": [2, 1] },
      });

      /**
       * The depth contour stack (issue #51).
       *
       * Above the raster and the translucent boundary and zone fills on purpose — the
       * seabed should be readable *through* the survey polygon, since judging one
       * against the other is the whole reason these lines exist. Still below the
       * soundings, which are the only observed thing on the map.
       */
      map.addSource(CONTOURS_SOURCE_ID, {
        type: "geojson",
        data: contoursFeatureCollection([], null),
      });
      map.addLayer({
        id: "depth-contours-line",
        type: "line",
        source: CONTOURS_SOURCE_ID,
        paint: {
          "line-color": ["get", "colour"],
          "line-width": ["case", ["get", "index"], 1.8, 0.9],
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "depth-contours-label",
        type: "symbol",
        source: CONTOURS_SOURCE_ID,
        // Zoomed out over the whole gulf the lines merge into a wash, and labelling a
        // wash helps nobody.
        minzoom: 13,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 300,
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-max-angle": 30,
          "text-padding": 4,
          // The opposite call to the soundings layer, deliberately. A sounding is a
          // measurement and must not be hidden; a contour label is one of hundreds of
          // repetitions of the same handful of numbers, so let the collider thin them.
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#263238",
          "text-halo-width": 1.5,
        },
      });

      /**
       * Measured depths, drawn last so they sit over every derived layer (issue #49).
       *
       * They are the only thing on the map that was actually observed rather than
       * computed, so nothing gets to cover them. White on a dark halo because the
       * background is satellite imagery of water, which ranges from near-black over
       * Posidonia to glare over sand.
       */
      map.addSource(SOUNDINGS_SOURCE_ID, {
        type: "geojson",
        data: soundingsFeatureCollection([]),
      });
      map.addLayer({
        id: "soundings-point",
        type: "circle",
        source: SOUNDINGS_SOURCE_ID,
        paint: {
          "circle-radius": 5,
          "circle-color": ["case", ["get", "excluded"], "#78909c", "#ffffff"],
          "circle-stroke-color": "#37474f",
          "circle-stroke-width": 2,
          "circle-opacity": ["case", ["get", "excluded"], 0.5, 1],
        },
      });
      map.addLayer({
        id: "soundings-label",
        type: "symbol",
        source: SOUNDINGS_SOURCE_ID,
        layout: {
          "text-field": ["get", "label"],
          "text-size": 12,
          "text-offset": [0, -1.2],
          // Fourteen points in two tight clusters: at low zoom the labels would
          // overplot and MapLibre would silently drop most of them. Better to show all
          // of them overlapping than to show four and imply that is the survey.
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#263238",
          "text-halo-width": 1.5,
        },
      });

      /**
       * The armed tool's overlay (issue #53).
       *
       * Above the soundings, which is the one layer that claims nothing may cover it. The
       * exception is deliberate and narrow: a tool overlay exists only while you are
       * actively pointing at something with it, and it is one click from gone, so it is
       * never what is quietly hiding a measurement from you.
       */
      map.addSource(TOOLS_SOURCE_ID, {
        type: "geojson",
        data: toolsFeatureCollection([], null),
      });
      map.addLayer({
        id: "tools-line",
        type: "line",
        source: TOOLS_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": TOOL_COLOUR,
          "line-width": 2,
          // Dashed, so it reads as an annotation rather than as one more derived boundary.
          "line-dasharray": [3, 2],
        },
      });
      map.addLayer({
        id: "tools-point",
        type: "circle",
        source: TOOLS_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 5,
          "circle-color": TOOL_COLOUR,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "tools-label",
        type: "symbol",
        source: TOOLS_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        layout: {
          "text-field": ["get", "label"],
          "text-size": 12,
          "text-offset": [0, -1.2],
          // Two labels at most, and both matter — the collider gets no say.
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#4a148c",
          "text-halo-width": 1.5,
        },
      });

      map.on("mouseenter", "rings-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "rings-fill", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", "rings-fill", (e) => {
        // A click meant to place a reference point, or to feed a tool, must not also
        // reselect a ring under it.
        if (isDrawingRef.current || isDroppingSoundingRef.current || activeToolRef.current) return;
        const point: GeoJSON.Position = [e.lngLat.lng, e.lngLat.lat];
        const match = findRingContaining(ringsRef.current, point);
        if (match) {
          setAllRingsSelected(false);
          setSelectedAnchor(match.anchor);
        }
      });

      /**
       * Click anywhere to place a known-depth reference point (issue #12).
       *
       * The click yields a position and nothing else; the depth is typed into the
       * Calibrate panel, which is also where the point is named and saved. Splitting it
       * that way keeps the map free of a form and means an accidental click costs one
       * "Cancel" rather than a row in the database.
       */
      map.on("click", (e) => {
        if (!isDroppingSoundingRef.current) return;
        setDroppedPoint({ lon: e.lngLat.lng, lat: e.lngLat.lat });
        setIsDroppingSounding(false);
      });

      /**
       * Click to feed the armed tool (issue #53).
       *
       * Arming a tool cancels drawing, reshaping and the sounding drop, and each of those
       * disarms the tool — so this handler and the one above can never both fire on the
       * same click. The guard is belt and braces for a state neither should reach.
       */
      map.on("click", (e) => {
        if (!activeToolRef.current || isDroppingSoundingRef.current) return;
        pushToolPointRef.current([e.lngLat.lng, e.lngLat.lat]);
      });

      /**
       * Shift-click a corner to delete it (issue #37).
       *
       * terra-draw cannot do this itself: select mode hardwires coordinate deletion
       * to `onRightClick`, and although `TerraDrawMouseEvent` carries `heldKeys`, the
       * mode never looks at them. Its right-click delete is enabled too, so both
       * gestures work; this is the one the story asked for.
       */
      map.on("click", (e) => {
        if (!e.originalEvent.shiftKey || !isEditingRef.current) return;
        const current = aoiRef.current;
        const featureId = editedFeatureRef.current;
        if (!current || featureId === undefined) return;

        // The grab radius is in pixels, so convert it here where the zoom is known.
        const origin = map.project(e.lngLat);
        const grabMetres = map
          .unproject(origin)
          .distanceTo(map.unproject([origin.x + VERTEX_GRAB_PX, origin.y]));

        const index = nearestVertexIndex(current, [e.lngLat.lng, e.lngLat.lat], grabMetres);
        if (index === null) return;

        const next = removeVertex(current, index);
        if (!next) {
          setEditError("An area needs at least three corners.");
          return;
        }
        setEditError(null);
        draw.updateFeatureGeometry(featureId, next);
        applyAoi(next);
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
    // Emptied while reshaping: terra-draw renders the AOI itself in select mode, and
    // two copies of the same outline make the vertex handles unreadable.
    source?.setData(isEditing ? emptyFeatureCollection() : aoiFeatureCollection(aoi));
  }, [overlaysReady, aoi, isEditing]);

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

  useEffect(() => {
    if (!overlaysReady) return;
    const source = mapRef.current?.getSource(ZONES_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(zonesFeatureCollection(exclusions));
  }, [overlaysReady, exclusions]);

  useEffect(() => {
    if (!overlaysReady) return;
    const source = mapRef.current?.getSource(INCLUSIONS_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(zonesFeatureCollection(inclusions));
  }, [overlaysReady, inclusions]);

  // No teardown to match: switching the interval off yields no lines and empties the
  // source, unlike the image source the composite needs removing.
  useEffect(() => {
    if (!overlaysReady) return;
    const source = mapRef.current?.getSource(CONTOURS_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(contoursFeatureCollection(contourLines, contourPlan.extentM));
  }, [overlaysReady, contourLines, contourPlan.extentM]);

  useEffect(() => {
    if (!overlaysReady) return;
    const source = mapRef.current?.getSource(SOUNDINGS_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(soundingsFeatureCollection(soundings, excludedSoundingIds));
  }, [overlaysReady, soundings, excludedSoundingIds]);

  useEffect(() => {
    if (!overlaysReady) return;
    const source = mapRef.current?.getSource(TOOLS_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(toolsFeatureCollection(measurePoints, utmPoint));
  }, [overlaysReady, measurePoints, utmPoint]);

  // A crosshair while the next click will place a reference point or feed a tool. Without
  // it the mode is invisible on the map and only the banner says anything is armed.
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = isDroppingSounding || activeTool ? "crosshair" : "";
  }, [isDroppingSounding, activeTool]);

  /**
   * Arming a tool takes the next click away from every other gesture (issue #53).
   *
   * An effect rather than a call in `ToolsMenu`, because the menu lives in the banner and
   * has no way to reach terra-draw. The other half of the exclusion — a gesture disarming
   * the tool — is `releaseTool` below, which the `controls` entry points call.
   *
   * Without this, arming Measure mid-draw leaves terra-draw's polygon mode live, and one
   * click both drops a corner and takes a measurement.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on the arming edge only; leaveEditing is redefined every render and depending on it would re-cancel on each one
  useEffect(() => {
    if (!activeTool) return;
    resetDraw(drawRef.current);
    setIsDrawing(false);
    setDrawTarget(null);
    setIsDroppingSounding(false);
    leaveEditing();
  }, [activeTool, setIsDrawing]);

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

  /** Hands the AOI back, drops terra-draw's copy, and returns to the plain outline. */
  function leaveEditing() {
    resetDraw(drawRef.current);
    editedFeatureRef.current = undefined;
    setIsEditing(false);
    setEditError(null);
  }

  /**
   * Disarms a tool so a drawing gesture can have the click (issue #53).
   *
   * Four things now want the next map click — drawing, reshaping, dropping a sounding, and
   * an armed tool — and exactly one may have it. `startDropSounding` already cancelled the
   * first two; the tool is the fourth, and every entry point into a gesture has to
   * surrender it, or a click both places a polygon corner and moves a measurement.
   *
   * The reverse direction — arming a tool cancelling the gestures — is the effect above,
   * not a call from `ToolsMenu`: the menu is in the banner, outside this component, and
   * cannot reach terra-draw.
   */
  function releaseTool() {
    if (activeTool) setActiveTool(null);
  }

  const controls: MapContextValue = {
    startDraw: (target: DrawTarget) => {
      const draw = drawRef.current;
      if (!draw) return;
      releaseTool();
      leaveEditing();
      drawTargetRef.current = target;
      setDrawTarget(target);
      draw.start();
      draw.setMode("polygon");
      setIsDrawing(true);
    },
    drawTarget,
    stopDraw: () => {
      // Only a draw in progress, never a reshape: `leaveEditing` owns that teardown,
      // and stopping terra-draw without clearing `isEditing` would leave the AOI
      // hidden — the effect below empties its source while a reshape is live.
      if (!isDrawing) return;
      resetDraw(drawRef.current);
      setIsDrawing(false);
      setDrawTarget(null);
    },
    isEditing,
    startEdit: () => {
      const draw = drawRef.current;
      if (!draw || !aoi) return;
      releaseTool();
      draw.start();
      draw.setMode("select");
      draw.clear();
      // terra-draw owns the geometry while it is being reshaped; `mode` has to name
      // the mode whose flags govern the handles, which is why it is "polygon" and not
      // "select" here.
      draw.addFeatures([{ type: "Feature", properties: { mode: "polygon" }, geometry: aoi }]);
      const [added] = draw.getSnapshot();
      if (added?.id === undefined) return;
      editedFeatureRef.current = added.id;
      draw.selectFeature(added.id);
      setEditError(null);
      setIsEditing(true);
    },
    stopEdit: leaveEditing,
    editError,
    isDroppingSounding,
    startDropSounding: () => {
      // Every other gesture owns the next click, so none may be live alongside this.
      releaseTool();
      resetDraw(drawRef.current);
      setIsDrawing(false);
      setDrawTarget(null);
      leaveEditing();
      setDroppedPoint(null);
      setIsDroppingSounding(true);
    },
    stopDropSounding: () => setIsDroppingSounding(false),
    droppedPoint,
    clearDroppedPoint: () => setDroppedPoint(null),
  };

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div className="sidebar">
        <MapContext.Provider value={controls}>
          <Outlet />
        </MapContext.Provider>
      </div>
      {/* Outside the sidebar, so it is the same readout on every step and the step's own
          panels never push it around. */}
      <ToolCard />
    </div>
  );
}
