import { Map as MapLibreMap, NavigationControl, type StyleSpecification } from "maplibre-gl";
import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

// Kiladha Bay, Argolic Gulf — same AOI as scripts/spike-sdb-kiladha.mjs.
const KILADHA_CENTER: [number, number] = [23.1225, 37.4265];
const KILADHA_ZOOM = 14;

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

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: OSM_STYLE,
      center: KILADHA_CENTER,
      zoom: KILADHA_ZOOM,
    });
    map.addControl(new NavigationControl(), "top-right");

    return () => map.remove();
  }, []);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
