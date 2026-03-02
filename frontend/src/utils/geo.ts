export type LatLng = {
  lat: number;
  lng: number;
};

const GEO_TAG_REGEX = /\[geo:[^\]]*]/gi;

export function isValidLatLng(coords: LatLng | null | undefined): coords is LatLng {
  if (!coords) return false;
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return false;
  return coords.lat >= -90 && coords.lat <= 90 && coords.lng >= -180 && coords.lng <= 180;
}

export function formatGeoTag(coords: LatLng): string {
  return `[geo:${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}]`;
}

export function appendGeoTag(comment: string, coords: LatLng | null | undefined): string {
  const base = String(comment || "")
    .replace(GEO_TAG_REGEX, "")
    .trim();

  if (!isValidLatLng(coords)) return base;

  const tag = formatGeoTag(coords);
  return base ? `${base}\n${tag}` : tag;
}
