import type { Sounding } from "@bok/core";
import { useRef, useState } from "react";
import { CollapsibleSection } from "./CollapsibleSection.js";
import { SOUNDING_CSV_URL, type SoundingImport } from "./soundings.js";

export interface SoundingPanelProps {
  soundings: Sounding[];
  error: string | null;
  onImport: (csv: string) => Promise<SoundingImport | null>;
  onRemove: (id: string) => Promise<void>;
}

/**
 * The measured depths, listed (issues #47-#49).
 *
 * Reading rather than fitting: what goes in the fit is #12's business. This exists so a
 * Planner can confirm the survey actually loaded, see the readings beside the map that
 * shows where they were taken, and get the CSV back out again.
 *
 * The export is prominent on purpose. The database is the source of truth and these are
 * the one numbers in the system that cannot be recomputed — a composite can be refetched,
 * a boundary re-derived, but a sounding costs a boat and a morning on the water.
 */
export function SoundingPanel({ soundings, error, onImport, onRemove }: SoundingPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setReport(null);
    try {
      const result = await onImport(await file.text());
      // Named out loud, because "added" and "updated" is precisely what the table cannot
      // tell you afterwards — and a survey that silently replaced another is how #52
      // happened.
      if (result) {
        setReport(
          `Imported ${result.soundings.length} ${result.soundings.length === 1 ? "sounding" : "soundings"}: ` +
            `${result.added} added, ${result.updated} updated.`,
        );
      }
    } finally {
      setBusy(false);
      // Cleared so re-choosing the same file after fixing it still fires a change event.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <CollapsibleSection id="soundings" title={`Soundings (${soundings.length})`}>
      <div className="row">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Importing…" : "Import CSV"}
        </button>
        <a href={SOUNDING_CSV_URL} download>
          Export CSV
        </a>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      {error && <p className="error">{error}</p>}
      {!error && report && <p className="hint">{report}</p>}

      {soundings.length === 0 ? (
        <p className="hint">
          No soundings yet. Import a CSV with <code>name,lon,lat,depth</code> — the depths measured
          from a boat, one row per reading.
        </p>
      ) : (
        <ul className="ring-list">
          {soundings.map((sounding) => (
            <li key={sounding.id} className="ring-item">
              <span>
                <strong>{sounding.depthM} m</strong> · {sounding.name}
                <br />
                <span className="hint">
                  {sounding.lat.toFixed(5)}, {sounding.lon.toFixed(5)}
                  {sounding.measuredAt ? ` · ${sounding.measuredAt.slice(0, 10)}` : ""}
                </span>
              </span>
              <button type="button" onClick={() => void onRemove(sounding.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="hint">
        Depth is true depth below the sea surface at the moment of the reading (D13). An echo
        sounder measures the ping, so refraction at n≈1.34 does not enter — it displaces where a
        feature <em>looks</em>, not where the echo returns from.
      </p>
      <p className="hint">
        Soundings are not part of a project. They measure the seabed, so the same reading serves
        every project covering that water. Exporting is the backup: the database is the only copy.
      </p>
    </CollapsibleSection>
  );
}
