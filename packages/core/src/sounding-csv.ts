import { parseSounding, type Sounding } from "./sounding.js";

/**
 * CSV in and out for soundings (issue #48).
 *
 * The database is the source of truth; this is the backup path, which means the export
 * has to be faithful enough to rebuild the table from. Every field round-trips.
 *
 * The import side is deliberately more forgiving than the export side. What actually
 * arrives is a file someone made by exporting waypoints from a Garmin and typing the
 * depths in by hand — so `name,lon,lat,depth` alone must work, header order must not
 * matter, and a trailing newline must be optional.
 *
 * Lives in `core` because it is string↔object and nothing else: no file reading, no
 * network. `apps/api` and `apps/web` both need it.
 */

/** Column header → field. Aliases are the spellings the wild actually produces. */
const HEADERS: Record<string, keyof CsvRow> = {
  id: "id",
  name: "name",
  lon: "lon",
  longitude: "lon",
  lat: "lat",
  latitude: "lat",
  depth: "depthM",
  depth_m: "depthM",
  depthm: "depthM",
  measured_at: "measuredAt",
  measuredat: "measuredAt",
  time: "measuredAt",
  source: "source",
  note: "note",
};

interface CsvRow {
  id?: string;
  name?: string;
  lon?: string;
  lat?: string;
  depthM?: string;
  measuredAt?: string;
  source?: string;
  note?: string;
}

const REQUIRED = ["name", "lon", "lat", "depthM"] as const;

/**
 * Parses a soundings CSV. Throws naming the line that failed — a survey arrives fourteen
 * rows at a time and "invalid CSV" would send you looking through all of them.
 */
export function parseSoundingCsv(text: string): Sounding[] {
  const lines = splitLines(text);
  if (lines.length === 0) throw new Error("The CSV is empty.");

  const headerCells = splitRow(lines[0].text).map((cell) => cell.trim().toLowerCase());
  const fields = headerCells.map((cell) => HEADERS[cell]);

  const missing = REQUIRED.filter((field) => !fields.includes(field));
  if (missing.length > 0) {
    throw new Error(
      `The CSV is missing the column${missing.length === 1 ? "" : "s"} ` +
        `${missing.map((f) => (f === "depthM" ? "depth" : f)).join(", ")}. ` +
        `Header found: ${headerCells.join(", ")}`,
    );
  }

  const soundings = lines.slice(1).map(({ text: line, number }) => {
    const cells = splitRow(line);
    const row: CsvRow = {};
    fields.forEach((field, index) => {
      if (field) row[field] = cells[index]?.trim() ?? "";
    });

    try {
      return parseSounding({
        ...row,
        // An absent optional column and a present-but-blank one mean the same thing —
        // unknown — and neither should become the string "".
        measuredAt: row.measuredAt ? row.measuredAt : null,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Line ${number}: ${detail}`);
    }
  });

  // One file claiming two depths at one place is a typo, not data — and since the import
  // upserts, it would resolve silently to whichever row came last. Reject it instead, and
  // name both lines: the answer is always in the comparison between them.
  const seen = new Map<string, number>();
  soundings.forEach((sounding, index) => {
    const line = lines[index + 1].number;
    const first = seen.get(sounding.id);
    if (first !== undefined) {
      throw new Error(
        `Line ${line}: "${sounding.name}" repeats the name and position of line ${first} — ` +
          "one of them is a typo.",
      );
    }
    seen.set(sounding.id, line);
  });

  return soundings;
}

/** Every field, in a stable column order, so an export re-imports to the same rows. */
export function formatSoundingCsv(soundings: readonly Sounding[]): string {
  const header = "id,name,lon,lat,depth,measured_at,source,note";
  const rows = soundings.map((s) =>
    [
      s.id,
      s.name,
      String(s.lon),
      String(s.lat),
      String(s.depthM),
      s.measuredAt ?? "",
      s.source,
      s.note,
    ]
      .map(quote)
      .join(","),
  );
  return [header, ...rows].join("\n");
}

/**
 * Non-blank lines, each carrying its 1-based line number in the original file so an
 * error can point at the file the user is looking at rather than at an array index.
 */
function splitLines(text: string): { text: string; number: number }[] {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ text: line, number: index + 1 }))
    .filter(({ text: line }) => line.trim() !== "");
}

/**
 * One CSV row into cells, honouring double-quoted fields with embedded commas.
 *
 * Not a full RFC 4180 parser — a quoted field containing a newline would need the split
 * above to be quote-aware too. That has never appeared in a sounding file, where the only
 * free text is a short note, and the alternative is a dependency for fourteen rows.
 */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

/** Quotes only when a field would otherwise break the row. */
function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
