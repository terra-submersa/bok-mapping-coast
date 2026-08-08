/**
 * Which raster the map paints over the satellite imagery.
 *
 * `depth` is the Stumpf ratio through the colour ramp; `sceneCount` is the per-pixel
 * number of clear scenes behind the median. The second exists because a shallow shelf
 * built on two cloudy scenes looks exactly like a real one until you check.
 *
 * This lives on its own rather than in `DepthPanel` because `ProjectContext` owns the
 * `layerView` state and `MapLayout` reads it to decide what to paint. Declaring it in
 * the panel meant the state hub imported a type from a UI component.
 */
export type LayerView = "depth" | "sceneCount";
