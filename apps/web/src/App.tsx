import { Navigate, Route, Routes } from "react-router";
import { AppHeader } from "./AppHeader.js";
import { AreaPage } from "./AreaPage.js";
import { BoundaryPage } from "./BoundaryPage.js";
import { CalibratePage } from "./CalibratePage.js";
import { CalibrationProvider } from "./CalibrationContext.js";
import { FlyPage } from "./FlyPage.js";
import { MapLayout } from "./MapLayout.js";
import { ProjectProvider } from "./ProjectContext.js";
import { ToolProvider } from "./ToolContext.js";

/**
 * App shell: a fixed banner over one routed view per big feature (issue #35).
 *
 * `.app-main` is the positioned ancestor MapLayout's `position: absolute; inset: 0`
 * resolves against, which is what keeps the map below the banner rather than under it.
 *
 * Area, Boundary and Calibrate sit under a shared *layout* route so that switching
 * between the planning steps swaps only the sidebar — the MapLibre instance underneath
 * is never unmounted (issue #38). `ProjectProvider` wraps the whole router so the AOI
 * and the composite also survive a detour to Fly.
 *
 * Calibrate joined them in issue #49: a reference point is dropped *on the map* and read
 * against the imagery under it, which a page with no map cannot do.
 *
 * All three providers wrap the *banner* as well as the router (issues #51, #53): the
 * header's depth contour menu reads the interval and the ratio→metres fit, and its tools
 * menu arms a tool the map inside the router then services. None of that state can live
 * below `<main>`. Providers render no DOM and `#root` is the flex column, so hoisting them
 * past it changes nothing about the layout.
 */
export function App() {
  return (
    <ProjectProvider>
      <CalibrationProvider>
        <ToolProvider>
          <AppHeader />
          <main className="app-main">
            <Routes>
              <Route element={<MapLayout />}>
                <Route path="/area" element={<AreaPage />} />
                <Route path="/boundary" element={<BoundaryPage />} />
                <Route path="/calibrate" element={<CalibratePage />} />
              </Route>
              <Route path="/fly" element={<FlyPage />} />
              {/* Vite's SPA fallback serves index.html for any path, so without this an
                  unknown URL renders an empty <main> that looks broken. Catches "/" too. */}
              <Route path="*" element={<Navigate to="/area" replace />} />
            </Routes>
          </main>
        </ToolProvider>
      </CalibrationProvider>
    </ProjectProvider>
  );
}
