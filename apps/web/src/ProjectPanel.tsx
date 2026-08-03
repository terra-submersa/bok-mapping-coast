import { CollapsibleSection } from "./CollapsibleSection.js";
import { useProject } from "./ProjectContext.js";

/**
 * Named projects (issue #8), so Kiladha stays separate from a later site.
 *
 * What is saved is every hand-drawn *input* — the AOI, the zones, the date range,
 * the tuning parameters — and nothing derived (D10). Opening a project therefore
 * drops the composite rather than carrying it across, which is issue #2's "switching
 * projects does not silently carry state" made concrete.
 */
export function ProjectPanel() {
  const {
    projectName,
    setProjectName,
    projects,
    projectError,
    saveCurrentProject,
    openProject,
    deleteProject,
  } = useProject();

  return (
    <CollapsibleSection id="project" title="Project">
      <label htmlFor="project-name">Name</label>
      <input
        id="project-name"
        type="text"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        placeholder="Kiladha"
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" onClick={saveCurrentProject} disabled={!projectName.trim()}>
          Save project
        </button>
      </div>

      {projectError && <p className="error">{projectError}</p>}

      {projects.length === 0 ? (
        <p className="hint">
          Nothing saved yet. Saving keeps the AOI, the zones, the dates and the tuning parameters —
          not the computed boundary, which is rebuilt from them.
        </p>
      ) : (
        <ul className="stat">
          {projects.map((project) => (
            <li
              key={project.id}
              className="row"
              style={{ justifyContent: "space-between", alignItems: "baseline" }}
            >
              <span>
                {project.name}
                <span className="hint"> · {project.updatedAt.slice(0, 10)}</span>
              </span>
              <span className="row">
                <button type="button" onClick={() => openProject(project.id)}>
                  Open
                </button>
                <button type="button" onClick={() => deleteProject(project.id)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="hint">
        Opening a project drops the loaded composite: a different AOI has a different request
        envelope, so the old raster would not belong to it.
      </p>
    </CollapsibleSection>
  );
}
