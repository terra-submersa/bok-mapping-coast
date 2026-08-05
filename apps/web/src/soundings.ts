import { parseSoundings, type Sounding } from "@bok/core";

/**
 * The measured-depth resource (issues #47, #48).
 *
 * Deliberately not keyed by project: a sounding measures the seabed, so the same reading
 * serves every project covering that water. The browser fetches all of them and lets the
 * calibration decide which ones the current AOI contains.
 */
export async function listSoundings(): Promise<Sounding[]> {
  const { soundings } = await request<{ soundings: unknown }>("/api/soundings");
  // Validated client-side as well as server-side: a malformed reading would otherwise
  // reach the least-squares fit as a NaN and quietly poison every depth on screen.
  return parseSoundings(soundings);
}

export async function saveSounding(sounding: Sounding): Promise<Sounding> {
  return parseSoundings([
    await request<unknown>(`/api/soundings/${encodeURIComponent(sounding.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sounding),
    }),
  ])[0];
}

/** Bulk upsert from a pasted or uploaded CSV. Returns what the server stored. */
export async function importSoundingCsv(csv: string): Promise<Sounding[]> {
  const { soundings } = await request<{ soundings: unknown }>("/api/soundings", {
    method: "POST",
    headers: { "Content-Type": "text/csv" },
    body: csv,
  });
  return parseSoundings(soundings);
}

export async function deleteSounding(id: string): Promise<void> {
  const res = await fetch(`/api/soundings/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessage(res));
}

/** Where the browser sends someone to download the backup. Not fetched — navigated to. */
export const SOUNDING_CSV_URL = "/api/soundings.csv";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as T;
}

/** The API answers with `{ error }`; anything else means it is not the API answering. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    // Not JSON — fall through to the status line.
  }
  return `Request failed (${res.status}).`;
}
