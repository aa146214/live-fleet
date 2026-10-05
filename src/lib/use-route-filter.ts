"use client";

import { useCallback, useState } from "react";
import { ROUTES } from "./routes";
import type { RouteId } from "./types";

export function useRouteFilter() {
  const [activeRoutes, setActiveRoutes] = useState<ReadonlySet<RouteId>>(
    () => new Set(ROUTES.map((route) => route.id)),
  );

  const toggleRoute = useCallback((id: RouteId) => {
    setActiveRoutes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return { activeRoutes, toggleRoute };
}
