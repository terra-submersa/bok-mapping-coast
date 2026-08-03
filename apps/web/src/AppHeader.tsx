import { NavLink } from "react-router";

/**
 * Provisional working name — invented so the banner has something to display,
 * not a decision. The only other occurrence is `index.html`'s `<title>`, which
 * cannot import this; those two spots are the whole rename surface (issue #35).
 */
export const APP_NAME = "Shoalmark";

/** Plan is the index route, so it needs `end` or it reads as active everywhere. */
const SECTIONS = [
  { to: "/", label: "Plan", end: true },
  { to: "/calibrate", label: "Calibrate", end: false },
  { to: "/fly", label: "Fly", end: false },
];

/**
 * The app shell's banner: wordmark plus one link per big feature. Kept
 * presentational — it knows the routes exist and nothing about their state.
 */
export function AppHeader() {
  return (
    <header className="app-header">
      <span className="wordmark">{APP_NAME}</span>
      <nav aria-label="Main">
        {SECTIONS.map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end} className="nav-link">
            {label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
