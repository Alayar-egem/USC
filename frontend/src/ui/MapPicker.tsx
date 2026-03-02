import { useEffect, useRef, useState } from "react";
import maplibregl, { type LngLatLike } from "maplibre-gl";
import type { LatLng } from "../utils/geo";
import { isValidLatLng } from "../utils/geo";

const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const DEFAULT_LAT = 42.8746;
const DEFAULT_LNG = 74.5698;
const DEFAULT_ZOOM = 12;

function envNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const MAP_STYLE_URL = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined)?.trim() || DEFAULT_STYLE_URL;
const MAP_DEFAULT_LAT = envNumber(import.meta.env.VITE_MAP_DEFAULT_LAT as string | undefined, DEFAULT_LAT);
const MAP_DEFAULT_LNG = envNumber(import.meta.env.VITE_MAP_DEFAULT_LNG as string | undefined, DEFAULT_LNG);
const MAP_DEFAULT_ZOOM = envNumber(import.meta.env.VITE_MAP_DEFAULT_ZOOM as string | undefined, DEFAULT_ZOOM);

function toCenter(coords: LatLng): LngLatLike {
  return [coords.lng, coords.lat];
}

export default function MapPicker({
  value,
  onChange,
  disabled = false,
  onError,
}: {
  value: LatLng | null;
  onChange: (coords: LatLng) => void;
  disabled?: boolean;
  onError?: (message: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const lastValueRef = useRef<LatLng | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return;

    const initial = isValidLatLng(value) ? value : { lat: MAP_DEFAULT_LAT, lng: MAP_DEFAULT_LNG };
    const map = new maplibregl.Map({
      container: host,
      style: MAP_STYLE_URL,
      center: toCenter(initial),
      zoom: MAP_DEFAULT_ZOOM,
      interactive: !disabled,
      attributionControl: true,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    const onLoad = () => {
      setLoading(false);
      setFailed(false);
    };
    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      if (disabled) return;
      onChange({
        lat: Number(e.lngLat.lat.toFixed(6)),
        lng: Number(e.lngLat.lng.toFixed(6)),
      });
    };
    const onMapError = () => {
      if (map.isStyleLoaded()) return;
      setFailed(true);
      setLoading(false);
      onError?.("Не удалось загрузить слой карты. Можно продолжить с ручным вводом координат.");
    };

    map.on("load", onLoad);
    map.on("click", onMapClick);
    map.on("error", onMapError);

    return () => {
      map.off("load", onLoad);
      map.off("click", onMapClick);
      map.off("error", onMapError);
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [disabled, onChange, onError, value]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!isValidLatLng(value)) {
      markerRef.current?.remove();
      markerRef.current = null;
      lastValueRef.current = null;
      return;
    }

    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ color: "#355cff" }).setLngLat(toCenter(value)).addTo(map);
    } else {
      markerRef.current.setLngLat(toCenter(value));
    }

    const prev = lastValueRef.current;
    if (!prev || prev.lat !== value.lat || prev.lng !== value.lng) {
      map.flyTo({
        center: toCenter(value),
        duration: 500,
        zoom: Math.max(map.getZoom(), 14),
      });
      lastValueRef.current = value;
    }
  }, [value]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (disabled) {
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.boxZoom.disable();
      map.dragRotate.disable();
      map.keyboard.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
    } else {
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.boxZoom.enable();
      map.dragRotate.enable();
      map.keyboard.enable();
      map.doubleClickZoom.enable();
      map.touchZoomRotate.enable();
    }
  }, [disabled]);

  return (
    <div className="map-picker">
      <div className="map-box">
        <div ref={hostRef} className={`map-inner ${loading ? "is-loading" : ""}`} />
        {loading ? <div className="map-overlay map-loading">Загружаем карту…</div> : null}
        {!loading && !failed ? <div className="map-overlay map-tip">Тапните по карте для точки доставки</div> : null}
        {failed ? (
          <div className="map-overlay map-fallback">Карта временно недоступна. Используйте ручной ввод координат ниже.</div>
        ) : null}
      </div>
      <div className="map-hint">Можно выбрать точку на карте или ввести координаты вручную.</div>
      <div className="map-attribution">
        Карта ©{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>{" "}
        · style by{" "}
        <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">
          OpenFreeMap
        </a>
      </div>
    </div>
  );
}
