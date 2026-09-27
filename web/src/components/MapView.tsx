import { Map as MLMap, NavigationControl, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 looks for its worker next to its own module, which does not exist after
// bundling. Let Vite bundle the worker (with its shared chunk) and point MapLibre at it.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(workerUrl);
import { useEffect, useRef, useState } from "react";
import type { FeatureCollection, MapProps } from "../types";

export type ColoredProps = MapProps & { _color?: string };
export interface MapViewState {
  center: [number, number];
  zoom: number;
}

interface Props {
  data: FeatureCollection<ColoredProps> | null;
  blocks?: FeatureCollection<MapProps> | null;
  idKey: "gp_lgd" | "block_lgd";
  bbox: [number, number, number, number];
  selectedId?: number | null;
  basemap?: boolean;
  dark?: boolean;
  fillOpacity?: number;
  onHover?: (p: ColoredProps | null, x: number, y: number) => void;
  onSelect?: (p: ColoredProps) => void;
  view?: MapViewState | null;
  onView?: (v: MapViewState) => void;
  showLowConfidence?: boolean;
}

const EMPTY = { type: "FeatureCollection", features: [] } as const;
type SetDataArg = Parameters<GeoJSONSource["setData"]>[0];
// Standard OSM raster tiles (no key), muted so the data colours stand out.
const BASE_PAINT = {
  light: { "raster-saturation": -0.85, "raster-opacity": 0.8, "raster-brightness-max": 1, "raster-contrast": 0 },
  dark: { "raster-saturation": -1, "raster-opacity": 0.9, "raster-brightness-max": 0.3, "raster-contrast": 0.15 },
} as const;

export default function MapView({
  data, blocks, idKey, bbox, selectedId, basemap = true, dark = false, fillOpacity = 0.82,
  onHover, onSelect, view, onView, showLowConfidence = false,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const hoverId = useRef<number | null>(null);
  const handlers = useRef({ onHover, onSelect, onView });
  handlers.current = { onHover, onSelect, onView };
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const map = new MLMap({
      container: ref.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 19,
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": dark ? "#12151a" : "#eef0ec" } },
          { id: "base", type: "raster", source: "osm", layout: { visibility: "none" } },
        ],
      },
      center: view?.center ?? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
      zoom: view?.zoom ?? 9,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("units", { type: "geojson", data: EMPTY as unknown as SetDataArg, promoteId: idKey });
      map.addSource("blocks", { type: "geojson", data: EMPTY as unknown as SetDataArg });
      map.addLayer({
        id: "units-fill", type: "fill", source: "units",
        paint: { "fill-color": ["coalesce", ["get", "_color"], "#cccccc"], "fill-opacity": fillOpacity },
      });
      map.addLayer({
        id: "units-line", type: "line", source: "units",
        paint: { "line-color": dark ? "#12151a" : "#ffffff", "line-width": 0.6, "line-opacity": 0.8 },
      });
      map.addLayer({
        id: "units-lowconf", type: "line", source: "units",
        filter: ["==", ["get", "confidence"], "low"],
        layout: { visibility: "none" },
        paint: { "line-color": dark ? "#e8ecef" : "#1c2321", "line-width": 1, "line-dasharray": [2, 2], "line-opacity": 0.55 },
      });
      map.addLayer({
        id: "blocks-line", type: "line", source: "blocks",
        paint: { "line-color": dark ? "#e8ecef" : "#1c2321", "line-width": 1.8, "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "units-hover", type: "line", source: "units",
        paint: {
          "line-color": dark ? "#ffffff" : "#1c2321",
          "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.2, 0],
        },
      });
      map.addLayer({
        id: "units-selected", type: "line", source: "units",
        filter: ["==", ["get", idKey], -1],
        paint: { "line-color": "#1565c0", "line-width": 3.2 },
      });

      map.on("mousemove", "units-fill", (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = f.id as number;
        if (hoverId.current !== null && hoverId.current !== id) {
          map.setFeatureState({ source: "units", id: hoverId.current }, { hover: false });
        }
        hoverId.current = id;
        map.setFeatureState({ source: "units", id }, { hover: true });
        map.getCanvas().style.cursor = "pointer";
        handlers.current.onHover?.(f.properties as ColoredProps, e.point.x, e.point.y);
      });
      map.on("mouseleave", "units-fill", () => {
        if (hoverId.current !== null) map.setFeatureState({ source: "units", id: hoverId.current }, { hover: false });
        hoverId.current = null;
        map.getCanvas().style.cursor = "";
        handlers.current.onHover?.(null, 0, 0);
      });
      map.on("click", "units-fill", (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (f) handlers.current.onSelect?.(f.properties as ColoredProps);
      });
      map.on("move", (e: { originalEvent?: unknown }) => {
        if (!e.originalEvent) return; // ignore programmatic moves (avoids sync loops)
        const c = map.getCenter();
        handlers.current.onView?.({ center: [c.lng, c.lat], zoom: map.getZoom() });
      });
      setReady(true);
    });

    // The container can have zero size when the map is created (layout not settled yet),
    // so fit the region once it has a real size.
    let fitted = false;
    const ro = new ResizeObserver((entries) => {
      map.resize();
      const { width, height } = entries[0].contentRect;
      if (!fitted && width > 50 && height > 50) {
        fitted = true;
        if (!view) map.fitBounds(bbox as [number, number, number, number], { padding: 24, duration: 0 });
      }
    });
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // The map is created once per mount; props below are synced by the other effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("units") as GeoJSONSource).setData((data ?? EMPTY) as unknown as SetDataArg);
  }, [data, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("blocks") as GeoJSONSource).setData((blocks ?? EMPTY) as unknown as SetDataArg);
  }, [blocks, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter("units-selected", ["==", ["get", idKey], selectedId ?? -1]);
  }, [selectedId, idKey, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty("units-lowconf", "visibility", showLowConfidence ? "visible" : "none");
  }, [showLowConfidence, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty("base", "visibility", basemap ? "visible" : "none");
    const paint = BASE_PAINT[dark ? "dark" : "light"];
    for (const k of Object.keys(paint) as (keyof typeof paint)[]) {
      map.setPaintProperty("base", k, paint[k]);
    }
    map.setPaintProperty("bg", "background-color", dark ? "#12151a" : "#eef0ec");
    map.setPaintProperty("blocks-line", "line-color", dark ? "#e8ecef" : "#1c2321");
    map.setPaintProperty("units-line", "line-color", dark ? "#12151a" : "#ffffff");
  }, [basemap, dark, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !view) return;
    const c = map.getCenter();
    if (Math.abs(c.lng - view.center[0]) > 1e-7 || Math.abs(c.lat - view.center[1]) > 1e-7 || Math.abs(map.getZoom() - view.zoom) > 1e-4) {
      map.jumpTo({ center: view.center, zoom: view.zoom });
    }
  }, [view]);

  return <div ref={ref} className="map" />;
}
