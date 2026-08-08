import { geodesicInverse } from "@bok/core";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useState } from "react";
import { chooseScaleBar, type ScaleBar } from "./map-scale.js";

/** How far up from the bottom of the canvas the bar's own row sits, in CSS pixels. */
const BAR_ROW_FROM_BOTTOM = 26;

/**
 * The span used to measure metres per pixel. Wide enough that the two unprojected points
 * are not fighting the projection's own rounding, narrow enough that Mercator's scale has
 * not changed across it.
 */
const PROBE_PX = 64;

/** Fraction of the viewport the bar aims at — the ask was "more or less half". */
const TARGET_FRACTION = 0.5;

/**
 * A hard ceiling on the bar's length, as room left over at the far end. Half the viewport
 * is already under that ceiling on any normal window; it only bites when the window is
 * narrow enough that half of it would still run the bar most of the way across.
 */
const MIN_FREE_PX = 336;

/**
 * A checkered survey scale bar along the bottom of the map (issue #55).
 *
 * Over the map rather than in the sidebar, like `ToolCard`, because it belongs to the map
 * on every step rather than to any one step. Unlike the tools it is never armed and never
 * cleared — it is simply always on.
 *
 * Not MapLibre's `ScaleControl`: `maxWidth` is fixed at construction there, so a bar sized
 * to the window would not survive a resize, and the control renders inside MapLibre's own
 * corner stack, where it cannot be placed relative to anything else on the map.
 */
export function MapScale({ map }: { map: MapLibreMap }) {
  const [bar, setBar] = useState<ScaleBar | null>(null);

  useEffect(() => {
    function recompute() {
      const canvas = map.getCanvas();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) return;

      /*
       * Metres per pixel measured on the bar's *own* row, not at the map centre. Mercator
       * stretches with latitude, so a bar drawn near the bottom of a tall window and scaled
       * from the centre is wrong by the difference — a percent or so over a viewport that
       * spans the gulf, which is exactly the error a scale bar exists to prevent.
       */
      const y = Math.max(0, height - BAR_ROW_FROM_BOTTOM);
      const x = Math.max(0, width / 2 - PROBE_PX / 2);
      const left = map.unproject([x, y]);
      const right = map.unproject([x + PROBE_PX, y]);
      const metresPerPixel =
        geodesicInverse([left.lng, left.lat], [right.lng, right.lat]).distanceM / PROBE_PX;

      const target = Math.min(width * TARGET_FRACTION, width - MIN_FREE_PX);
      const next = chooseScaleBar(metresPerPixel, target);

      // `move` fires every frame of a pan and drops a new bar on maybe one of them, so
      // compare before setting state rather than re-rendering the whole overlay at 60 Hz.
      setBar((prev) =>
        prev && next && prev.distanceM === next.distanceM && prev.widthPx === next.widthPx
          ? prev
          : next,
      );
    }

    recompute();
    map.on("move", recompute);
    map.on("resize", recompute);
    return () => {
      map.off("move", recompute);
      map.off("resize", recompute);
    };
  }, [map]);

  if (!bar) return null;

  return (
    <div
      className="map-scale"
      style={{ width: `${bar.widthPx}px` }}
      // One label for the whole thing: read aloud, "0 0.25 0.5 0.75 1 km" is noise, and
      // the only fact the bar carries is what its full length is worth.
      role="img"
      aria-label={`Map scale: the bar is ${bar.labels.at(-1)} long`}
    >
      <div className="map-scale-bar">
        {Array.from({ length: bar.segments }, (_, i) => (
          <span
            // Index is the identity here: the blocks are positions on a ruler, nothing
            // more, and re-keying them on the distance would rebuild the bar every zoom.
            // biome-ignore lint/suspicious/noArrayIndexKey: the index *is* the block
            key={i}
            className={i % 2 === 0 ? "map-scale-block filled" : "map-scale-block"}
          />
        ))}
      </div>
      <div className="map-scale-labels">
        {bar.labels.map((label, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: ticks are positions, not values
            key={i}
            className="map-scale-label"
            style={{ left: `${(i / bar.segments) * 100}%` }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
