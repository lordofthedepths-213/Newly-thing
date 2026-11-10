// Pure helpers: distances, unit formatting and GeoJSON conversion.
// Depths are always stored in feet; lengths are computed in metres.
import { UTILITIES } from './utilities.js';

const FT_PER_M = 3.28084;
const EARTH_RADIUS_M = 6371008.8;

export function haversine(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function lineLengthMeters(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i]);
  return total;
}

/** Parse a depth typed in the display unit; returns feet, or null if blank/invalid. */
export function parseDepth(text, unit) {
  const n = parseFloat(String(text ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return unit === 'm' ? n * FT_PER_M : n;
}

/** Depth (stored in feet) as a number in the display unit, for form inputs. */
export function depthValue(feet, unit) {
  if (feet == null) return '';
  const v = unit === 'm' ? feet / FT_PER_M : feet;
  return String(Math.round(v * 100) / 100);
}

export function formatDepth(feet, unit) {
  if (feet == null) return '—';
  return `${depthValue(feet, unit)} ${unit}`;
}

export function formatLength(meters, unit) {
  if (unit === 'm') return `${meters.toFixed(1)} m`;
  return `${(meters * FT_PER_M).toFixed(1)} ft`;
}

export function depthRange(points) {
  const depths = points.map((p) => p.depth).filter((d) => d != null);
  if (!depths.length) return null;
  return { min: Math.min(...depths), max: Math.max(...depths) };
}

export function toGeoJSON(features) {
  return {
    type: 'FeatureCollection',
    name: 'Utility Mapper export',
    features: features.map((f) => {
      const coords = f.points.map((p) => [p.lng, p.lat]);
      return {
        type: 'Feature',
        id: f.id,
        geometry:
          coords.length === 1
            ? { type: 'Point', coordinates: coords[0] }
            : { type: 'LineString', coordinates: coords },
        properties: {
          utility: f.type,
          name: f.name || '',
          installDate: f.installDate || '',
          size: f.size || '',
          material: f.material || '',
          locateMethod: f.locateMethod || '',
          notes: f.notes || '',
          // One entry per vertex, feet below grade; null = not measured.
          depthsFt: f.points.map((p) => p.depth ?? null),
        },
      };
    }),
  };
}

const validCoord = (c) =>
  Array.isArray(c) &&
  Number.isFinite(c[0]) &&
  Number.isFinite(c[1]) &&
  Math.abs(c[0]) <= 180 &&
  Math.abs(c[1]) <= 90;

/** Read a FeatureCollection back into app features. Unknown shapes are skipped. */
export function fromGeoJSON(json, makeId) {
  if (!json || json.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
    throw new Error('Not a GeoJSON FeatureCollection');
  }
  const out = [];
  for (const g of json.features) {
    const geom = g?.geometry;
    let coords;
    if (geom?.type === 'Point') coords = [geom.coordinates];
    else if (geom?.type === 'LineString') coords = geom.coordinates;
    else continue;
    if (!Array.isArray(coords) || !coords.length || !coords.every(validCoord)) continue;

    const p = g.properties || {};
    const depths = Array.isArray(p.depthsFt) ? p.depthsFt : [];
    const str = (v) => (typeof v === 'string' ? v.slice(0, 2000) : '');
    out.push({
      id: makeId(),
      type: UTILITIES.some((u) => u.id === p.utility) ? p.utility : 'proposed',
      name: str(p.name),
      installDate: /^\d{4}-\d{2}-\d{2}$/.test(p.installDate) ? p.installDate : '',
      size: str(p.size),
      material: str(p.material),
      locateMethod: str(p.locateMethod),
      notes: str(p.notes),
      points: coords.map((c, i) => ({
        lat: c[1],
        lng: c[0],
        depth: Number.isFinite(depths[i]) && depths[i] >= 0 ? depths[i] : null,
      })),
    });
  }
  return out;
}
