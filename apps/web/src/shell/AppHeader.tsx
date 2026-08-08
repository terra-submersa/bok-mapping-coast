import { NavLink } from "react-router";
import { ContourMenu } from "./ContourMenu.js";
import { ToolsMenu } from "./ToolsMenu.js";

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
 * The app shell's banner: wordmark, one link per big feature, and the controls that
 * belong to no single step.
 *
 * The depth contour menu is the first of those (issue #51). It sits here rather than in
 * a sidebar because the lines are a way of *looking* at the seabed, as useful while
 * trimming the AOI on Area or judging a sounding on Calibrate as on Boundary.
 *
 * The tools menu joined it for the same reason (issue #53): measuring a distance or
 * reading a grid reference interrogates the map, not any one planning step.
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
      <ContourMenu />
      <ToolsMenu />
    </header>
  );
}
