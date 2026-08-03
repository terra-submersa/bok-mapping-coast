import { Navigate, Route, Routes } from "react-router";
import { AppHeader } from "./AppHeader.js";
import { CalibratePage } from "./CalibratePage.js";
import { FlyPage } from "./FlyPage.js";
import { MapView } from "./MapView.js";

/**
 * App shell: a fixed banner over one routed view per big feature (issue #35).
 *
 * `.app-main` is the positioned ancestor MapView's `position: absolute; inset: 0`
 * resolves against, which is what keeps the map below the banner rather than
 * under it.
 */
export function App() {
  return (
    <>
      <AppHeader />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<MapView />} />
          <Route path="/calibrate" element={<CalibratePage />} />
          <Route path="/fly" element={<FlyPage />} />
          {/* Vite's SPA fallback serves index.html for any path, so without this
              an unknown URL renders an empty <main> that looks broken. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
