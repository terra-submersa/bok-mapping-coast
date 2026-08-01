#!/usr/bin/env node
// Spike 0.1 (docs/user-stories.md, Epic 0) — throwaway, no app, no tests.
// Proves whether a plausible 4 m Stumpf-ratio contour exists for Kiladha Bay
// before any application code is written. Run and inspect the output in QGIS;
// if it looks wrong against the Lambayanna structures, the project is not
// worth building yet.
//
// Usage: node --env-file=.env scripts/spike-sdb-kiladha.mjs

import { writeFile, mkdir } from "node:fs/promises";

const TOKEN_URL =
  "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const PROCESS_URL = "https://sh.dataspace.copernicus.eu/process/v1";

// --- AOI: Kiladha Bay, bay mouth to Lambayanna beach inclusive -------------
// Estimated from published coordinates (Franchthi Cave 37.4233N 23.1322E;
// Lambayanna a few hundred metres north of it) — NOT verified against a map.
// [minLon, minLat, maxLon, maxLat], CRS84 (lon/lat) order.
// CHECK THIS BOX in QGIS or geojson.io before trusting the result — it drives
// a metered API call.
const BBOX = [23.105, 37.418, 23.14, 37.435];

// --- Date range: most recent complete summer. CLAUDE.md: "a single scene
// gives you glint, waves, boat wakes" — the median must span many scenes.
const TIME_FROM = "2025-06-01T00:00:00Z";
const TIME_TO = "2025-09-15T00:00:00Z";

const clientId = process.env.CDSE_OAUTH_CLIENT_ID;
const clientSecret = process.env.CDSE_OAUTH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Missing CDSE_OAUTH_CLIENT_ID / CDSE_OAUTH_CLIENT_SECRET in environment.");
  console.error("Run with: node --env-file=.env scripts/spike-sdb-kiladha.mjs");
  process.exit(1);
}

async function getAccessToken() {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.access_token;
}

// Stumpf ratio = ln(N * B02) / ln(N * B03), N chosen to keep logs positive.
// mosaicking: "ORBIT" gives evaluatePixel one sample per orbit over the whole
// time range, which is what lets us compute a per-pixel median across scenes.
const evalscript = `
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B02", "B03", "B08", "SCL"] }],
    output: { bands: 2, sampleType: "FLOAT32" },
    mosaicking: "ORBIT"
  };
}

// SCL: 1 saturated/defective, 3 cloud shadow, 8/9 cloud medium/high prob,
// 10 cirrus, 11 snow.
function isCloudOrShadow(scl) {
  return scl === 1 || scl === 3 || scl === 8 || scl === 9 || scl === 10 || scl === 11;
}

function isWater(sample) {
  var ndwi = (sample.B03 - sample.B08) / (sample.B03 + sample.B08);
  return ndwi > 0;
}

var N = 1000;

function evaluatePixel(samples) {
  var ratios = [];
  for (var i = 0; i < samples.length; i++) {
    var s = samples[i];
    if (s.B02 <= 0 || s.B03 <= 0) continue;
    if (isCloudOrShadow(s.SCL)) continue;
    if (!isWater(s)) continue;
    ratios.push(Math.log(N * s.B02) / Math.log(N * s.B03));
  }
  var count = ratios.length;
  if (count === 0) return [0, 0];
  ratios.sort(function (a, b) { return a - b; });
  var mid = Math.floor(count / 2);
  var median = count % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid];
  // Band 1: median Stumpf ratio. Band 2: valid scene count (not optional —
  // without it a two-cloudy-scene artefact looks identical to a real shelf).
  return [median, count];
}
`;

async function requestComposite(token) {
  const body = {
    input: {
      bounds: {
        properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" },
        bbox: BBOX,
      },
      data: [
        {
          type: "sentinel-2-l2a",
          dataFilter: { timeRange: { from: TIME_FROM, to: TIME_TO } },
        },
      ],
    },
    output: {
      width: 1024,
      height: 1024,
      responses: [{ identifier: "default", format: { type: "image/tiff" } }],
    },
    evalscript,
  };

  const res = await fetch(PROCESS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "image/tiff",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Process request failed: ${res.status} ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  console.log("Requesting CDSE access token...");
  const token = await getAccessToken();

  console.log(
    `Requesting composite for bbox [${BBOX.join(", ")}] (${TIME_FROM} to ${TIME_TO})...`,
  );
  const start = Date.now();
  const tiff = await requestComposite(token);
  console.log(`Got ${tiff.byteLength} bytes in ${Date.now() - start} ms`);

  const outDir = new URL("./output/", import.meta.url);
  await mkdir(outDir, { recursive: true });
  const outPath = new URL(
    `kiladha-sdb-${TIME_FROM.slice(0, 10)}_${TIME_TO.slice(0, 10)}.tif`,
    outDir,
  );
  await writeFile(outPath, tiff);

  console.log(`Wrote ${outPath.pathname}`);
  console.log(
    "Band 1 = median Stumpf ratio (ln(1000*B02)/ln(1000*B03)). Band 2 = valid scene count.",
  );
  console.log("Open in QGIS: style band 1 as a colour ramp; check band 2 for thin-data areas.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
