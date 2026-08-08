import { createContext, useContext } from "react";

export interface AccordionContextValue {
  activeId: string;
  setActiveId: (id: string) => void;
}

export const AccordionContext = createContext<AccordionContextValue | null>(null);

export function useAccordion(): AccordionContextValue {
  const ctx = useContext(AccordionContext);
  if (!ctx)
    throw new Error("CollapsibleSection must be rendered inside an AccordionContext.Provider.");
  return ctx;
}
