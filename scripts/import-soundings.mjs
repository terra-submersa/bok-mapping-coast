#!/usr/bin/env node
// Import measured depth soundings into the API (issue #48).
//
// The data arrives in two halves that only a human joins up: a Garmin exports
// waypoints as GPX, carrying names and per-waypoint UTC times but no depth,
// and someone then types the depths into a CSV beside the names. So this reads
// the CSV for position and depth, and — if a GPX is given — joins it by
// waypoint name to recover the times, which D13 wants kept so a tide
// correction stays possible later.
//
// Usage:
//   node scripts/import-soundings.mjs <file.csv> [file.gpx]
//   node scripts/import-soundings.mjs ~/Downloads/Bathymetry_argolide.csv \
//                                     "~/Downloads/Bathymetry argolide.gpx"
//
// The API must be running (pnpm dev). Override with API=http://host:port.
// Re-running is safe: rows upsert on an id derived from the name, so a
// corrected CSV corrects the table rather than doubling it.

import { readFile } from "node:fs/promises";
import { parseSoundingCsv } from "../packages/core/dist/index.js";

const API = process.env.API ?? "http://localhost:8787";

const [csvPath, gpxPath] = process.argv.slice(2);
if (!csvPath) {
  console.error("Usage: node scripts/import-soundings.mjs <file.csv> [file.gpx]");
  process.exit(1);
}

const soundings = parseSoundingCsv(await readFile(csvPath, "utf8"));
console.log(`read ${soundings.length} soundings from ${csvPath}`);

if (gpxPath) {
  const times = waypointTimes(await readFile(gpxPath, "utf8"));
  let joined = 0;
  for (const sounding of soundings) {
    const time = times.get(sounding.name);
    if (time && !sounding.measuredAt) {
      sounding.measuredAt = time;
      joined++;
    }
  }
  console.log(`joined ${joined} timestamps from ${gpxPath}`);
  const missed = soundings.filter((s) => !s.measuredAt).map((s) => s.name);
  if (missed.length > 0) console.warn(`no timestamp for: ${missed.join(", ")}`);
}

if (!soundings.every((s) => s.source)) {
  // Nothing else knows how the number was obtained, and "" reads as "nobody said".
  for (const sounding of soundings) sounding.source ||= "echo-sounder";
  console.log('defaulted a blank source to "echo-sounder"');
}

const res = await fetch(`${API}/api/soundings`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(soundings),
});

if (!res.ok) {
  const body = await res.text();
  console.error(`import failed (${res.status}): ${body}`);
  process.exit(1);
}

const { soundings: stored } = await res.json();
console.log(`stored ${stored.length} soundings in ${API}`);
for (const s of stored) {
  console.log(`  ${s.id.padEnd(12)} ${s.lat.toFixed(6)} ${s.lon.toFixed(6)}  ${s.depthM} m`);
}

/**
 * Waypoint name → ISO time, from a GPX file.
 *
 * A regex rather than an XML parser, deliberately: this is a one-off script over a
 * known-shape Garmin export, and adding a DOM dependency to the repo for it would be
 * out of proportion. If it ever stops matching, the timestamps go missing loudly
 * (the warning above) rather than arriving wrong.
 */
function waypointTimes(xml) {
  const times = new Map();
  for (const [, body] of xml.matchAll(/<wpt\b[^>]*>([\s\S]*?)<\/wpt>/g)) {
    const name = body.match(/<name>([^<]*)<\/name>/)?.[1];
    const time = body.match(/<time>([^<]*)<\/time>/)?.[1];
    if (name && time) times.set(name.trim(), time.trim());
  }
  return times;
}
