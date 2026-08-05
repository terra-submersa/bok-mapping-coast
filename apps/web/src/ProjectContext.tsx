import {
  type Aoi,
  aoiEnvelope,
  MIN_RING_AREA_M2,
  PROJECT_SCHEMA_VERSION,
  type ProjectDocument,
  projectSlug,
  sameBbox,
} from "@bok/core";
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
import { type Composite, type CompositeProgress, fetchTiledComposite } from "./composite.js";
import type { LayerView } from "./DepthPanel.js";
import { waterRange } from "./depth-ramp.js";
import { loadStoredNumber, storeNumber } from "./param-storage.js";
import {
  deleteProject as deleteProjectRequest,
  fetchProject,
  listProjects,
  loadLastOpened,
  type ProjectSummary,
  saveProject,
  storeLastOpened,
} from "./projects.js";
import {
  loadStoredExclusions,
  loadStoredInclusions,
  storeExclusions,
  storeInclusions,
} from "./zone-storage.js";

/** Default composite window: the most recent complete summer, as in the spike. */
const DEFAULT_FROM = "2025-06-01";
const DEFAULT_TO = "2025-09-15";

/** Buffer default sits inside the recommended 20-50 m window (story 4.3). */
const DEFAULT_BUFFER_METRES = 30;

/** Coastal ribbon default — same order of magnitude as the landward buffer (issue #27). */
const DEFAULT_COAST_METRES = 30;

export interface ProjectContextValue {
  /** The AOI, and the drawing mode that produces one. */
  aoi: Aoi | null;
  isDrawing: boolean;
  setIsDrawing: (drawing: boolean) => void;
  applyAoi: (next: Aoi) => void;
  clearAoi: () => void;

  /**
   * Hand-drawn areas cut out of the flight boundary — the harbour, the moorings,
   * the swimming area (issue #17). Inputs, not edits: a recompute re-applies them
   * rather than wiping them (D10).
   */
  exclusions: GeoJSON.Polygon[];
  addExclusion: (zone: GeoJSON.Polygon) => void;
  removeExclusion: (index: number) => void;
  clearExclusions: () => void;

  /**
   * Hand-drawn areas *added* to the flight boundary — where SDB read a Posidonia
   * meadow as deep and bit the contour inward (issue #16). The mirror of an
   * exclusion, and the reason story 4.4 stopped being contested: a correction that
   * is an input cannot be destroyed by a recompute, so there is nothing to warn
   * about and no diff to replay.
   */
  inclusions: GeoJSON.Polygon[];
  addInclusion: (zone: GeoJSON.Polygon) => void;
  removeInclusion: (index: number) => void;
  clearInclusions: () => void;

  /** Composite window and the raster fetched for it. */
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  composite: Composite | null;
  loadingComposite: boolean;
  compositeError: string | null;
  /** Tiles done, while a load is running (issue #43). Null when nothing is in flight. */
  compositeProgress: CompositeProgress | null;
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

  /**
   * Named projects (issue #8). The working draft lives in localStorage and survives a
   * reload whether or not it has been saved; a *project* is a named snapshot of it on
   * the API, which is what makes Kiladha and a later site separable.
   */
  projectName: string;
  setProjectName: (name: string) => void;
  projects: ProjectSummary[];
  projectError: string | null;
  refreshProjects: () => Promise<void>;
  saveCurrentProject: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

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
  const [aoi, setAoiState] = useState<Aoi | null>(() => loadStoredAoi());
  /**
   * Mirrors `aoi`. The terra-draw "finish" handler is registered once at mount, so
   * its closure would otherwise read an `aoi` that is forever whatever it was then.
   */
  const aoiRef = useRef<Aoi | null>(aoi);
  const [isDrawing, setIsDrawing] = useState(false);
  const [exclusions, setExclusions] = useState<GeoJSON.Polygon[]>(() => loadStoredExclusions());
  const [inclusions, setInclusions] = useState<GeoJSON.Polygon[]>(() => loadStoredInclusions());

  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [composite, setComposite] = useState<Composite | null>(null);
  const [loadingComposite, setLoadingComposite] = useState(false);
  const [compositeError, setCompositeError] = useState<string | null>(null);
  const [compositeProgress, setCompositeProgress] = useState<CompositeProgress | null>(null);
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

  const [projectName, setProjectName] = useState(() => loadLastOpened() ?? "Kiladha");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectError, setProjectError] = useState<string | null>(null);

  useEffect(() => storeExclusions(exclusions), [exclusions]);
  useEffect(() => storeInclusions(inclusions), [inclusions]);
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

  const applyAoi = useCallback(
    (next: Aoi) => {
      // The composite is fetched, cached and billed on the AOI's *envelope*, and the
      // raster's pixel grid is pinned to that box — so it is the envelope, not the
      // shape, that decides whether everything downstream is stale. Reshaping inside
      // the box the raster already covers costs a re-clip and nothing else (D10).
      //
      // When the envelope does move, drop the lot rather than leave a raster and a
      // contour pinned to the previous box: a Planner would otherwise happily export
      // a flight boundary for the wrong stretch of coast, with nothing on screen
      // saying so.
      const before = aoiRef.current;
      if (!before || !sameBbox(aoiEnvelope(before), aoiEnvelope(next))) clearComposite();
      aoiRef.current = next;
      setAoiState(next);
      storeAoi(next);
    },
    [clearComposite],
  );

  const addExclusion = useCallback((zone: GeoJSON.Polygon) => {
    setExclusions((current) => [...current, zone]);
  }, []);

  const removeExclusion = useCallback((index: number) => {
    setExclusions((current) => current.filter((_, i) => i !== index));
  }, []);

  const clearExclusions = useCallback(() => setExclusions([]), []);

  const addInclusion = useCallback((zone: GeoJSON.Polygon) => {
    setInclusions((current) => [...current, zone]);
  }, []);

  const removeInclusion = useCallback((index: number) => {
    setInclusions((current) => current.filter((_, i) => i !== index));
  }, []);

  const clearInclusions = useCallback(() => setInclusions([]), []);

  const clearAoi = useCallback(() => {
    aoiRef.current = null;
    setAoiState(null);
    clearStoredAoi();
    clearComposite();
  }, [clearComposite]);

  /**
   * The current working state as a storable document — inputs only. The boundary is
   * derived and deliberately absent: storing it would let a saved file disagree with
   * the parameters sitting beside it (D10).
   */
  const toDocument = useCallback(
    (): ProjectDocument => ({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      name: projectName.trim() || "Untitled",
      aoi,
      exclusions,
      inclusions,
      dateRange: { from, to },
      params: { threshold, tolerance, bufferMetres, coastMetres, minRingAreaM2 },
    }),
    [
      projectName,
      aoi,
      exclusions,
      inclusions,
      from,
      to,
      threshold,
      tolerance,
      bufferMetres,
      coastMetres,
      minRingAreaM2,
    ],
  );

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await listProjects());
      setProjectError(null);
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : "Could not list projects.");
    }
  }, []);

  const saveCurrentProject = useCallback(async () => {
    const document = toDocument();
    try {
      await saveProject(projectSlug(document.name), document);
      storeLastOpened(document.name);
      setProjectError(null);
      await refreshProjects();
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : "Could not save the project.");
    }
  }, [toDocument, refreshProjects]);

  const openProject = useCallback(
    async (id: string) => {
      try {
        const document = await fetchProject(id);
        // Switching projects must not carry state across (issue #2's criterion, and
        // #8's). Dropping the composite is the blunt version of that and the right
        // one: the new AOI has its own envelope, so the old raster is meaningless.
        clearComposite();
        aoiRef.current = document.aoi;
        setAoiState(document.aoi);
        if (document.aoi) storeAoi(document.aoi);
        else clearStoredAoi();
        setExclusions(document.exclusions);
        setInclusions(document.inclusions);
        setFrom(document.dateRange.from);
        setTo(document.dateRange.to);
        setTolerance(document.params.tolerance);
        setBufferMetres(document.params.bufferMetres);
        setCoastMetres(document.params.coastMetres);
        setMinRingAreaM2(document.params.minRingAreaM2);
        setProjectName(document.name);
        storeLastOpened(document.name);
        setProjectError(null);
      } catch (err) {
        setProjectError(err instanceof Error ? err.message : "Could not open the project.");
      }
    },
    [clearComposite],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      try {
        await deleteProjectRequest(id);
        setProjectError(null);
        await refreshProjects();
      } catch (err) {
        setProjectError(err instanceof Error ? err.message : "Could not delete the project.");
      }
    },
    [refreshProjects],
  );

  // One listing at mount. A missing or unreachable API leaves `projectError` set and
  // everything else working — the draft is in localStorage, so planning is possible
  // without the project store.
  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const loadComposite = useCallback(async () => {
    const current = aoiRef.current;
    if (!current) return;
    setLoadingComposite(true);
    setCompositeError(null);
    setCompositeProgress(null);
    try {
      // Strips that follow the polygon (issue #46), split further when the envelope is
      // wider than one request allows (issue #41), and one plain request when neither
      // applies. The AOI goes in whole: the plan is a function of its shape, not just of
      // the envelope it spans.
      const next = await fetchTiledComposite(
        { aoi: current, from, to },
        { onProgress: setCompositeProgress },
      );
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
      // Cleared however it ended. A bar left sitting at 7 of 9 beside an error message
      // reads as "still going", which is the one thing it definitely is not.
      setCompositeProgress(null);
    }
  }, [from, to]);

  return (
    <ProjectContext.Provider
      value={{
        aoi,
        isDrawing,
        setIsDrawing,
        applyAoi,
        clearAoi,
        exclusions,
        addExclusion,
        removeExclusion,
        clearExclusions,
        inclusions,
        addInclusion,
        removeInclusion,
        clearInclusions,
        from,
        to,
        setFrom,
        setTo,
        composite,
        loadingComposite,
        compositeError,
        compositeProgress,
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
        projectName,
        setProjectName,
        projects,
        projectError,
        refreshProjects,
        saveCurrentProject,
        openProject,
        deleteProject,
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
