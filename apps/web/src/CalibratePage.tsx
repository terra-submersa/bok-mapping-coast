/**
 * Placeholder for Epic 3. Deliberately says what is missing rather than showing
 * an empty shell that looks broken (issue #35).
 */
export function CalibratePage() {
  return (
    <div className="page">
      <section className="panel">
        <div className="panel-body">
          <h2>Calibrate</h2>
          <p>
            Not built yet. This is where known-depth reference points will be dropped on the map
            (#12) and persisted with the project (#13), turning the Stumpf ratio into metres.
          </p>
          <p className="hint">
            #12 is blocked on two decisions still listed as Undecided in{" "}
            <code>docs/design-decisions.md</code>: whether <code>max_depth</code> means true or
            apparent depth given refraction at n≈1.34, and what vertical datum "4 m" is measured
            against.
          </p>
          <p className="hint">
            Until then the Plan view shows the raw ratio and no metres at all — per decision D3,
            depth in metres is not displayed until at least three calibration points exist.
          </p>
        </div>
      </section>
    </div>
  );
}
