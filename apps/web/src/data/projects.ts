import { type ProjectDocument, parseProjectDocument } from "@bok/core";

export interface ProjectSummary {
  id: string;
  name: string;
  /** ISO 8601. */
  updatedAt: string;
}

/** Records which project the working draft belongs to, so a reload keeps its name. */
const LAST_OPENED_KEY = "bok:project:lastOpened";

export function loadLastOpened(): string | null {
  return localStorage.getItem(LAST_OPENED_KEY);
}

export function storeLastOpened(id: string | null): void {
  if (id === null) localStorage.removeItem(LAST_OPENED_KEY);
  else localStorage.setItem(LAST_OPENED_KEY, id);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const { projects } = await request<{ projects: ProjectSummary[] }>("/api/projects");
  return projects;
}

export async function fetchProject(id: string): Promise<ProjectDocument> {
  // Validated client-side too: the server is the authority on what it stores, but a
  // document that fails here would otherwise reach the pipeline as broken geometry.
  return parseProjectDocument(await request<unknown>(`/api/projects/${encodeURIComponent(id)}`));
}

export async function saveProject(id: string, document: ProjectDocument): Promise<ProjectSummary> {
  return request<ProjectSummary>(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(document),
  });
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessage(res));
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as T;
}

/** The API answers with `{ error }`; anything else means it is not the API answering. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    // Not JSON — fall through to the status line.
  }
  return `Request failed (${res.status}).`;
}
