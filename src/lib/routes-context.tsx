"use client";

import { createContext, useContext, useMemo } from "react";
import { DEFAULT_ROUTES, placesFor, type Place, type ShuttleRoute } from "./routes";

/**
 * The routes to show: the ones the admin has set up (sent with each fleet snapshot), or
 * the defaults until the first snapshot arrives.
 */
const RoutesContext = createContext<ShuttleRoute[]>(DEFAULT_ROUTES);

export const RoutesProvider = RoutesContext.Provider;

export const useRoutes = (): ShuttleRoute[] => useContext(RoutesContext);

/** The map pins for the current routes. */
export function usePlaces(): Place[] {
  const routes = useRoutes();
  return useMemo(() => placesFor(routes), [routes]);
}
