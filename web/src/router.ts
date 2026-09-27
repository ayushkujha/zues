import { useEffect, useState } from "react";

export type Route =
  | { page: "map" }
  | { page: "compare" }
  | { page: "advisories" }
  | { page: "validation" }
  | { page: "runs" }
  | { page: "farmer"; gp?: number };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  switch (parts[0]) {
    case "compare":
      return { page: "compare" };
    case "advisories":
      return { page: "advisories" };
    case "validation":
      return { page: "validation" };
    case "runs":
      return { page: "runs" };
    case "farmer":
      return { page: "farmer", gp: parts[1] ? Number(parts[1]) : undefined };
    default:
      return { page: "map" };
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const go = (path: string) => {
  window.location.hash = path;
};
