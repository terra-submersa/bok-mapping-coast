import { checkProcessingApiLimit, parseBboxInput } from "@bok/core";
import type { CompositeRequest } from "../cdse/process.js";

export type ParseResult = { ok: true; request: CompositeRequest } | { ok: false; error: string };

function parseInstant(value: string | undefined, name: string): Date | string {
  if (!value) return `Missing "${name}" (an ISO date, e.g. 2025-06-01).`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `"${name}" is not a valid ISO date: ${value}`;
  return date;
}

/** Validates raw query parameters into a CompositeRequest, or explains why it can't. */
export function parseCompositeParams(params: {
  bbox?: string;
  from?: string;
  to?: string;
}): ParseResult {
  let bbox: ReturnType<typeof parseBboxInput>;
  try {
    bbox = parseBboxInput(params.bbox ?? "");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid bbox." };
  }

  const limit = checkProcessingApiLimit(bbox);
  if (limit.exceeds) {
    return {
      ok: false,
      error:
        `AOI is ${Math.round(limit.widthPx)}x${Math.round(limit.heightPx)} px at 10 m, ` +
        "which exceeds the Processing API's 2500x2500 single-request limit.",
    };
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
    request: { bbox, from: from.toISOString(), to: to.toISOString() },
  };
}
