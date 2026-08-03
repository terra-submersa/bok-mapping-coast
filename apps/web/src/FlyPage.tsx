/**
 * Placeholder for the Pilot persona. Deliberately says what is missing rather
 * than showing an empty shell that looks broken (issue #35).
 */
export function FlyPage() {
  return (
    <div className="page">
      <section className="panel">
        <div className="panel-body">
          <h2>Fly</h2>
          <p>
            Not built yet. This is where the mission card will live (#22): the recommended course
            angle and time window that keep the sun glint cone out of the frames, plus the GSD and
            flight-time numbers the pilot needs on the beach.
          </p>
          <p className="hint">
            Per decision D5 we do not generate waypoints — Pilot 2 plans the lawnmower lines from
            the exported boundary, so the course angle is something the pilot types in by hand. That
            makes this card the only place azimuth control exists.
          </p>
          <p className="hint">
            Nothing here can be re-run in the field, so whatever this page shows has to be right
            before leaving the desk.
          </p>
        </div>
      </section>
    </div>
  );
}
