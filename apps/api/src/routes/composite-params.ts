import { checkProcessingApiLimit, PROCESSING_API_MAX_SIDE_PX, parseBboxInput } from "@bok/core";
import type { CompositeRequest } from "../cdse/process.js";

export type ParseResult = { ok: true; request: CompositeRequest } | { ok: false; error: string };

function parseInstant(value: string | undefined, name: string): Date | string {
  if (!value) return `Missing "${name}" (an ISO date, e.g. 2025-06-01).`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `"${name}" is not a valid ISO date: ${value}`;
  return date;
}

/** A positive integer no larger than the Processing API's per-request cap. */
function parseSide(value: string | undefined, name: string): number | undefined | string {
  if (value === undefined || value === "") return undefined;
  const side = Number(value);
  if (!Number.isInteger(side)) return `"${name}" must be a whole number of pixels: ${value}`;
  if (side < 1) return `"${name}" must be at least 1 px, got ${side}.`;
  if (side > PROCESSING_API_MAX_SIDE_PX) {
    return `"${name}" is ${side} px, over the Processing API's ${PROCESSING_API_MAX_SIDE_PX} px cap.`;
  }
  return side;
}

/** Validates raw query parameters into a CompositeRequest, or explains why it can't. */
export function parseCompositeParams(params: {
  bbox?: string;
  from?: string;
  to?: string;
  width?: string;
  height?: string;
}): ParseResult {
  let bbox: ReturnType<typeof parseBboxInput>;
  try {
    bbox = parseBboxInput(params.bbox ?? "");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid bbox." };
  }

  const width = parseSide(params.width, "width");
  if (typeof width === "string") return { ok: false, error: width };
  const height = parseSide(params.height, "height");
  if (typeof height === "string") return { ok: false, error: height };

  if ((width === undefined) !== (height === undefined)) {
    return { ok: false, error: `"width" and "height" must be given together, or not at all.` };
  }

  // The gate is on the *output size*, not on how much ground the bbox covers. With an
  // explicit size the extent is irrelevant — a wide box at 2500 px is a legitimate
  // low-resolution overview, and each tile of a tiled request (issue #41) is under the
  // cap by construction. Without one, the derived size is still what has to fit.
  if (width === undefined) {
    const limit = checkProcessingApiLimit(bbox);
    if (limit.exceeds) {
      return {
        ok: false,
        error:
          `AOI is ${Math.round(limit.widthPx)}x${Math.round(limit.heightPx)} px at 10 m, ` +
          "which exceeds the Processing API's 2500x2500 single-request limit. " +
          "Pass explicit width and height to request it as a tile.",
      };
    }
  }

  const from = parseInstant(params.from, "from");
  if (typeof from === "string") return { ok: false, error: from };
  const to = parseInstant(params.to, "to");
  if (typeof to === "string") return { ok: false, error: to };

  if (from >= to) {
    return { ok: false, error: `"from" must be before "to".` };
  }

  return {
    ok: true,
    // Spread conditionally so a size-less request has no `width` key at all — the cache
    // key is derived from this object and must stay byte-identical to the pre-tiling one.
    request: {
      bbox,
      from: from.toISOString(),
      to: to.toISOString(),
      ...(width !== undefined && height !== undefined ? { width, height } : {}),
    },
  };
}
