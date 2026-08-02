import { useAccordion } from "./AccordionContext.js";

export interface CollapsibleSectionProps {
  /** Section key within the enclosing AccordionContext. */
  id: string;
  title: string;
  children: React.ReactNode;
}

/**
 * One of several sections sharing a single AccordionContext, so exactly one is
 * open at a time — the sidebar composes seven of these as the pipeline
 * progresses (AOI → depth → threshold → ring → buffer → simplify → export),
 * and leaving them all open overflows the viewport.
 */
export function CollapsibleSection({ id, title, children }: CollapsibleSectionProps) {
  const { activeId, setActiveId } = useAccordion();
  const open = activeId === id;

  return (
    <section className="panel">
      <button
        type="button"
        className="panel-header"
        onClick={() => setActiveId(id)}
        aria-expanded={open}
      >
        <h2>{title}</h2>
        <span className="chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && <div className="panel-body">{children}</div>}
    </section>
  );
}
