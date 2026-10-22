"use client";

import { createContext, useContext } from "react";
import { BUILT_IN_PLACES, DEFAULT_ROUTES, pinPlacesFor, type PinPlace, type ShuttleRoute } from "./routes";

/**
 * The routes to show, and the places they call at: the ones the admin has set up (sent with
 * each fleet snapshot), or the defaults until the first snapshot arrives.
 */
const RoutesContext = createContext<ShuttleRoute[]>(DEFAULT_ROUTES);
const PlacesContext = createContext<PinPlace[]>(pinPlacesFor(DEFAULT_ROUTES, BUILT_IN_PLACES));

export const RoutesProvider = RoutesContext.Provider;
export const PlacesProvider = PlacesContext.Provider;

export const useRoutes = (): ShuttleRoute[] => useContext(RoutesContext);

/** The places the routes call at, for the map's pins. */
export const usePlaces = (): PinPlace[] => useContext(PlacesContext);
