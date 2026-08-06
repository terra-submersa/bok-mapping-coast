import {
  DEPTH_CONTOUR_INTERVALS_M,
  type DepthContourPlan,
  MIN_CALIBRATION_POINTS,
} from "@bok/core";
import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router";
import { formatDepthM } from "./format.js";
import { useProject } from "./ProjectContext.js";
import { useContourPlan } from "./useDepthContours.js";

const OPTIONS = [
  { value: 0, label: "Off" },
  ...DEPTH_CONTOUR_INTERVALS_M.map((metres) => ({ value: metres, label: formatDepthM(metres) })),
];

export interface ContourMenuNote {
  text: string;
  /** True when the fix is on the Calibrate step, so the note can link there. */
  calibrate?: boolean;
}

/**
 * Why the menu is refusing, or what it quietly dropped. Pure, so it is testable in node —
 * `apps/web` has no DOM test environment.
 */
export function contourMenuNote(
  plan: DepthContourPlan,
  hasComposite: boolean,
  intervalM: number,
): ContourMenuNote | null {
  if (!hasComposite) return { text: "Load a composite on the Boundary step first." };
  if (plan.extentM === null) {
    return {
      text:
        `Not metres. Depth contours need at least ${MIN_CALIBRATION_POINTS} known-depth reference ` +
        "points with a ratio under them (D3); a fit whose slope is not positive doesn't count.",
      calibrate: true,
    };
  }
  if (intervalM > 0 && plan.levels.length === 0) {
    const { min, max } = plan.extentM;
    return {
      text: `No whole multiple of ${formatDepthM(intervalM)} falls between ${min.toFixed(1)} m and ${max.toFixed(1)} m in this AOI.`,
    };
  }
  if (plan.capped) {
    const deepest = plan.levels[plan.levels.length - 1].depthM;
    return {
      text: `Showing ${plan.levels.length} of ${plan.availableCount} lines — deeper than ${deepest.toFixed(1)} m omitted. Pick a wider interval to see the whole range.`,
    };
  }
  return null;
}

/**
 * Depth contour interval, in the banner (issue #51).
 *
 * In the banner rather than a sidebar panel because the lines are a way of *looking* at
 * the seabed, and they are as useful while trimming the AOI on Area or judging a
 * sounding on Calibrate as they are on Boundary.
 *
 * A `menu` of `menuitemradio`s rather than a listbox: "exactly one interval is selected"
 * maps straight onto `aria-checked` and needs none of `aria-activedescendant`'s
 * machinery.
 */
export function ContourMenu() {
  const { contourIntervalM, setContourIntervalM, composite } = useProject();
  const plan = useContourPlan();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const enabled = plan.extentM !== null;
  const note = contourMenuNote(plan, composite !== null, contourIntervalM);
  const selected = OPTIONS.find((option) => option.value === contourIntervalM) ?? OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close(focusTrigger = true) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function choose(value: number) {
    setContourIntervalM(value);
    close();
  }

  function focusItem(index: number) {
    const items = itemRefs.current.filter(Boolean);
    if (items.length === 0) return;
    const wrapped = ((index % items.length) + items.length) % items.length;
    items[wrapped]?.focus();
  }

  function onItemKeyDown(index: number) {
    return (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          focusItem(index + 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          focusItem(index - 1);
          break;
        case "Home":
          event.preventDefault();
          focusItem(0);
          break;
        case "End":
          event.preventDefault();
          focusItem(OPTIONS.length - 1);
          break;
        case "Escape":
          event.preventDefault();
          close();
          break;
        case "Tab":
          close(false);
          break;
      }
    };
  }

  return (
    <div className="header-menu" ref={rootRef}>
      <button
        type="button"
        className="header-menu-button"
        ref={triggerRef}
        /*
         * `aria-disabled`, never the `disabled` attribute. A disabled button takes no
         * focus and fires no click, so the explanation for why it is refusing would be
         * unreachable by keyboard — a dead control that will not say why it is dead.
         */
        aria-disabled={enabled ? undefined : true}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="contour-menu"
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        Contours: {enabled ? selected.label : "Off"}
        <span className="header-menu-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div
          id="contour-menu"
          className="header-menu-popover"
          role="menu"
          aria-label="Depth contour interval"
        >
          {enabled &&
            OPTIONS.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={option.value === contourIntervalM}
                className="header-menu-item"
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                onClick={() => choose(option.value)}
                onKeyDown={onItemKeyDown(index)}
              >
                {option.label}
              </button>
            ))}
          {note && (
            <p className="header-menu-note">
              {note.text}
              {note.calibrate && (
                <>
                  {" "}
                  <NavLink to="/calibrate" onClick={() => setOpen(false)}>
                    Add them on the Calibrate step.
                  </NavLink>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
