import { useEffect, useRef, useState } from "react";
import { type ActiveTool, useTool } from "./ToolContext.js";

const OPTIONS: { value: ActiveTool; label: string }[] = [
  { value: null, label: "Off" },
  { value: "measure", label: "Measure" },
  { value: "utm", label: "UTM coordinates" },
];

/**
 * The map interrogation tools, in the banner (issue #53).
 *
 * Beside `Contours` and for the same reason: measuring a distance or reading off a grid
 * reference is a way of *looking* at the map, as useful while trimming the AOI on Area as
 * while judging a sounding on Calibrate. Neither belongs to a step, so neither belongs in
 * a step's sidebar.
 *
 * Unlike `Contours` it is never disabled. A distance and a coordinate need no composite
 * and no calibration fit — they are properties of the map, not of the data on it.
 *
 * The popover mechanics are `ContourMenu`'s, deliberately duplicated rather than lifted
 * into a shared component: two menus is not yet evidence of what a third would need, and
 * the wrong abstraction here would be harder to unpick than the copy.
 */
export function ToolsMenu() {
  const { activeTool, setActiveTool, showSentinelTiles, setShowSentinelTiles } = useTool();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selected = OPTIONS.find((option) => option.value === activeTool) ?? OPTIONS[0];
  /** The overlay is independent of the armed tool, so the trigger has to name both. */
  const label = showSentinelTiles ? `${selected.label} + S2 tiles` : selected.label;
  /** The checkbox sits after the radio group in the roving-focus order. */
  const TILES_INDEX = OPTIONS.length;

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

  function choose(value: ActiveTool) {
    setActiveTool(value);
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
          focusItem(TILES_INDEX);
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
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="tools-menu"
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
        Tools: {label}
        <span className="header-menu-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div id="tools-menu" className="header-menu-popover" role="menu" aria-label="Map tool">
          {OPTIONS.map((option, index) => (
            <button
              key={option.label}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === activeTool}
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

          {/*
           * An overlay, not a gesture — hence a checkbox below a rule rather than a fourth
           * radio. It takes no map clicks, so it stays on while a tool is armed, and
           * measuring across a seam while seeing where the seam is, is the point of it.
           */}
          <hr className="header-menu-rule" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={showSentinelTiles}
            className="header-menu-item"
            ref={(element) => {
              itemRefs.current[TILES_INDEX] = element;
            }}
            onClick={() => setShowSentinelTiles(!showSentinelTiles)}
            onKeyDown={onItemKeyDown(TILES_INDEX)}
          >
            <span className="header-menu-tick" aria-hidden="true">
              {showSentinelTiles ? "✓" : ""}
            </span>
            Sentinel-2 tiles
          </button>
          {showSentinelTiles && (
            <p className="header-menu-note">
              Granule footprints, computed from the MGRS grid. They overlap by 9.8 km, so a
              discontinuity in the composite should fall on one of these edges.
            </p>
          )}

          {/*
           * Said up front, because arming a tool takes the next map click away from
           * drawing and from dropping a sounding. A Planner who has just armed Measure and
           * finds their polygon click doing nothing deserves to have been told.
           */}
          {activeTool !== null && (
            <p className="header-menu-note">
              The next map click belongs to this tool — drawing and dropping a reference point are
              paused until it is off.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
