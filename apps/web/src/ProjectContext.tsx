import { type BBox, MIN_RING_AREA_M2, sameBbox } from "@bok/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { clearStoredAoi, loadStoredAoi, storeAoi } from "./aoi-storage.js";
import { type Composite, fetchComposite } from "./composite.js";
import type { LayerView } from "./DepthPanel.js";
import { waterRange } from "./depth-ramp.js";
import { loadStoredNumber, storeNumber } from "./param-storage.js";

/** Default composite window: the most recent complete summer, as in the spike. */
const DEFAULT_FROM = "2025-06-01";
const DEFAULT_TO = "2025-09-15";

/** Buffer default sits inside the recommended 20-50 m window (story 4.3). */
const DEFAULT_BUFFER_METRES = 30;

/** Coastal ribbon default — same order of magnitude as the landward buffer (issue #27). */
const DEFAULT_COAST_METRES = 30;

export interface ProjectContextValue {
  /** The AOI, and the drawing mode that produces one. */
  bbox: BBox | null;
  isDrawing: boolean;
  setIsDrawing: (drawing: boolean) => void;
  applyBbox: (next: BBox) => void;
  clearAoi: () => void;

  /** Composite window and the raster fetched for it. */
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  composite: Composite | null;
  loadingComposite: boolean;
  compositeError: string | null;
  loadComposite: () => Promise<void>;

  /** How the raster is displayed. */
  opacity: number;
  setOpacity: (value: number) => void;
  layerView: LayerView;
  setLayerView: (value: LayerView) => void;

  /** Threshold, and the range the slider spans. */
  ratioRange: { min: number; max: number } | null;
  threshold: number | null;
  setThreshold: (value: number) => void;

  /** Tuning parameters, persisted across sessions (issue #26). */
  tolerance: number;
  setTolerance: (value: number) => void;
  bufferMetres: number;
  setBufferMetres: (value: number) => void;
  coastMetres: number;
  setCoastMetres: (value: number) => void;
  minRingAreaM2: number;
  setMinRingAreaM2: (value: number) => void;

  /** Which contour ring is the flight area (story 4.1). */
  selectedAnchor: GeoJSON.Position | null;
  setSelectedAnchor: (anchor: GeoJSON.Position | null) => void;
  allRingsSelected: boolean;
  setAllRingsSelected: (all: boolean) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be called inside a ProjectProvider.");
  return ctx;
}

/**
 * Everything the two planning steps share: the AOI, the composite fetched for it,
 * and the parameters that turn one into the other.
 *
 * Lifted out of `MapView` so that Area and Boundary can be separate routes over a
 * single map (issue #38). Nothing here touches MapLibre — the map reacts to this
 * state in `MapLayout`, which is what lets the state outlive any one route.
 */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const [bbox, setBboxState] = useState<BBox | null>(() => loadStoredAoi());
  /**
   * Mirrors `bbox`. The terra-draw "finish" handler is registered once at mount, so
   * its closure would otherwise read a `bbox` that is forever whatever it was then.
   */
  const bboxRef = useRef<BBox | null>(bbox);
  const [isDrawing, setIsDrawing] = useState(false);

  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [composite, setComposite] = useState<Composite | null>(null);
  const [loadingComposite, setLoadingComposite] = useState(false);
  const [compositeError, setCompositeError] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.8);
  const [layerView, setLayerView] = useState<LayerView>("depth");
  const [ratioRange, setRatioRange] = useState<{ min: number; max: number } | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  // Simplification tolerance, landward buffer, and the ring-noise filter are tuned
  // per AOI but tend to converge on a good value for a given site, so they're
  // persisted across sessions rather than reset to a default every load.
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
   * The point a Planner last picked, geographically — not a ring index, which has no
   * stable meaning once the contour is rebuilt from scratch on a threshold change.
   */
  const [selectedAnchor, setSelectedAnchor] = useState<GeoJSON.Position | null>(null);
  const [allRingsSelected, setAllRingsSelected] = useState(false);

  useEffect(() => storeNumber("tolerance", tolerance), [tolerance]);
  useEffect(() => storeNumber("bufferMetres", bufferMetres), [bufferMetres]);
  useEffect(() => storeNumber("coastMetres", coastMetres), [coastMetres]);
  useEffect(() => storeNumber("minRingAreaM2", minRingAreaM2), [minRingAreaM2]);

  /** Everything downstream of the raster, dropped. Pure state — the map's own layers
   * are torn down by the effect in `MapLayout` that watches `composite`. */
  const clearComposite = useCallback(() => {
    setComposite(null);
    setCompositeError(null);
    setRatioRange(null);
    setThreshold(null);
    setSelectedAnchor(null);
    setAllRingsSelected(false);
  }, []);

  const applyBbox = useCallback(
    (next: BBox) => {
      // Everything downstream is computed for one specific bbox: the composite is
      // fetched for it, the contour comes from that composite, and the KML comes from
      // that contour. Moving the AOI invalidates the lot, so drop it rather than leave
      // a raster and a contour pinned to the previous box — a Planner would otherwise
      // happily export a flight boundary for the wrong stretch of coast, with nothing
      // on screen saying so. Re-applying an identical bbox costs nothing.
      if (!sameBbox(bboxRef.current, next)) clearComposite();
      bboxRef.current = next;
      setBboxState(next);
      storeAoi(next);
    },
    [clearComposite],
  );

  const clearAoi = useCallback(() => {
    bboxRef.current = null;
    setBboxState(null);
    clearStoredAoi();
    clearComposite();
  }, [clearComposite]);

  const loadComposite = useCallback(async () => {
    const current = bboxRef.current;
    if (!current) return;
    setLoadingComposite(true);
    setCompositeError(null);
    try {
      const next = await fetchComposite({ bbox: current, from, to });
      const range = waterRange(next);
      if (!range) {
        setCompositeError("The composite has no water pixels — check the AOI and the date range.");
        return;
      }
      setRatioRange(range);
      // Start mid-range: an arbitrary but visible starting point the Planner drags from.
      setThreshold((value) => value ?? (range.min + range.max) / 2);
      setComposite(next);
    } catch (err) {
      setCompositeError(err instanceof Error ? err.message : "Could not load the composite.");
    } finally {
      setLoadingComposite(false);
    }
  }, [from, to]);

  return (
    <ProjectContext.Provider
      value={{
        bbox,
        isDrawing,
        setIsDrawing,
        applyBbox,
        clearAoi,
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
        selectedAnchor,
        setSelectedAnchor,
        allRingsSelected,
        setAllRingsSelected,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}
