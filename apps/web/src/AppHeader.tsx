import { NavLink } from "react-router";

/**
 * Provisional working name — invented so the banner has something to display,
 * not a decision. The only other occurrence is `index.html`'s `<title>`, which
 * cannot import this; those two spots are the whole rename surface (issue #35).
 */
export const APP_NAME = "Shoalmark";

/**
 * Planning is two steps over one map — where, then how deep (issue #38). Every route
 * is an explicit path now, so none of them needs `end` to avoid reading as active
 * everywhere; "/" redirects to "/area".
 */
const SECTIONS = [
  { to: "/area", label: "Area" },
  { to: "/boundary", label: "Boundary" },
  { to: "/calibrate", label: "Calibrate" },
  { to: "/fly", label: "Fly" },
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
        {SECTIONS.map(({ to, label }) => (
          <NavLink key={to} to={to} className="nav-link">
            {label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
