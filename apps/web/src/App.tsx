import { Navigate, Route, Routes } from "react-router";
import { AppHeader } from "./AppHeader.js";
import { AreaPage } from "./AreaPage.js";
import { BoundaryPage } from "./BoundaryPage.js";
import { CalibratePage } from "./CalibratePage.js";
import { FlyPage } from "./FlyPage.js";
import { MapLayout } from "./MapLayout.js";
import { ProjectProvider } from "./ProjectContext.js";

/**
 * App shell: a fixed banner over one routed view per big feature (issue #35).
 *
 * `.app-main` is the positioned ancestor MapLayout's `position: absolute; inset: 0`
 * resolves against, which is what keeps the map below the banner rather than under it.
 *
 * Area and Boundary sit under a shared *layout* route so that switching between the
 * two planning steps swaps only the sidebar — the MapLibre instance underneath is
 * never unmounted (issue #38). `ProjectProvider` wraps the whole router so the AOI and
 * the composite also survive a detour to Calibrate or Fly.
 */
export function App() {
  return (
    <>
      <AppHeader />
      <main className="app-main">
        <ProjectProvider>
          <Routes>
            <Route element={<MapLayout />}>
              <Route path="/area" element={<AreaPage />} />
              <Route path="/boundary" element={<BoundaryPage />} />
            </Route>
            <Route path="/calibrate" element={<CalibratePage />} />
            <Route path="/fly" element={<FlyPage />} />
            {/* Vite's SPA fallback serves index.html for any path, so without this an
                unknown URL renders an empty <main> that looks broken. Catches "/" too. */}
            <Route path="*" element={<Navigate to="/area" replace />} />
          </Routes>
        </ProjectProvider>
      </main>
    </>
  );
}
