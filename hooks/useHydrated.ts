"use client";

import { useSyncExternalStore } from "react";

// Never fires: the answer changes exactly once, at hydration, and React
// re-renders for that on its own.
const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * True once the component has hydrated on the client, false during server
 * rendering and the first client render.
 *
 * The usual way to write this is `useState(false)` plus an effect that calls
 * `setMounted(true)`, which works but costs an extra render pass on every
 * mount and trips react-hooks/set-state-in-effect. `useSyncExternalStore`
 * answers the same question directly: React reads the server snapshot while
 * rendering on the server and during hydration, then the client snapshot
 * afterwards, with no state to set.
 *
 * Use it for anything that must not differ between server and client markup --
 * theme (unknown until the browser reports it) and current time being the two
 * cases here.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, onClient, onServer);
}
