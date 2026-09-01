import { normalizeMapProjectionKind } from './map-host.js';

const TILE_SIZE = 512;
const MIN_GLOBE_LATITUDE = -89;
const MAX_GLOBE_LATITUDE = 89;
// Pando's flat view is equirectangular.  The native MapLibre host remains a
// Mercator transport, but it must not impose the Mercator pole limit on the
// authoritative Pando view state.
const MIN_FLAT_LATITUDE = -89.999;
const MAX_FLAT_LATITUDE = 89.999;
const MIN_MAPLIBRE_LATITUDE = -85.051129;
const MAX_MAPLIBRE_LATITUDE = 85.051129;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function wrapLongitude(value) {
  return ((Number(value || 0) + 540) % 360) - 180;
}

function normalizedPadding(padding = {}) {
  return Object.freeze({
    left: Math.max(0, Number(padding.left) || 0),
    right: Math.max(0, Number(padding.right) || 0),
    top: Math.max(0, Number(padding.top) || 0),
    bottom: Math.max(0, Number(padding.bottom) || 0),
  });
}

function contentSize(size = {}, padding = {}) {
  const width = Math.max(1, Number(size.width) || 1);
  const height = Math.max(1, Number(size.height) || 1);
  const safe = normalizedPadding(padding);
  return Object.freeze({
    width,
    height,
    safe,
    contentWidth: Math.max(1, width - safe.left - safe.right),
    contentHeight: Math.max(1, height - safe.top - safe.bottom),
  });
}

export function pandoZoomToMapLibreZoom(pandoZoom, {
  projection = 'flat',
  size = {},
  padding = {},
} = {}) {
  const metrics = contentSize(size, padding);
  const kind = normalizeMapProjectionKind(projection);
  const referencePixels = kind === 'globe'
    ? Math.max(1, Math.min(metrics.contentWidth, metrics.contentHeight) * 0.91)
    : metrics.contentWidth;
  return Math.log2(Math.max(1e-6, referencePixels * Math.max(1e-6, Number(pandoZoom) || 1) / TILE_SIZE));
}

export function mapLibreZoomToPandoZoom(mapLibreZoom, {
  projection = 'flat',
  size = {},
  padding = {},
} = {}) {
  const metrics = contentSize(size, padding);
  const kind = normalizeMapProjectionKind(projection);
  const referencePixels = kind === 'globe'
    ? Math.max(1, Math.min(metrics.contentWidth, metrics.contentHeight) * 0.91)
    : metrics.contentWidth;
  return TILE_SIZE * Math.pow(2, Number(mapLibreZoom) || 0) / referencePixels;
}

export function pandoViewToMapHostView({ projection = 'flat', view = {}, size = {}, padding = {} } = {}) {
  const kind = normalizeMapProjectionKind(projection);
  const center = kind === 'globe'
    ? [wrapLongitude(-Number(view.globeRotation?.[0] || 0)), clamp(-Number(view.globeRotation?.[1] || 0), MIN_GLOBE_LATITUDE, MAX_GLOBE_LATITUDE)]
    : [wrapLongitude(view.flatCenter?.[0] || 0), clamp(view.flatCenter?.[1] || 0, MIN_FLAT_LATITUDE, MAX_FLAT_LATITUDE)];
  const pandoZoom = kind === 'globe' ? view.globeZoom : view.flatZoom;
  return Object.freeze({
    projection: kind,
    center: Object.freeze(center),
    zoom: pandoZoomToMapLibreZoom(pandoZoom, { projection: kind, size, padding }),
    bearing: 0,
    pitch: 0,
    padding: normalizedPadding(padding),
  });
}

export function mapHostViewToPandoView(hostView = {}, previousView = {}, { size = {}, padding = {} } = {}) {
  const kind = normalizeMapProjectionKind(hostView.projection);
  const center = Array.isArray(hostView.center) ? hostView.center : [0, 0];
  const next = {
    ...previousView,
    globeRotation: [...(previousView.globeRotation || [0, 0, 0])],
    flatCenter: [...(previousView.flatCenter || [0, 0])],
  };
  const pandoZoom = mapLibreZoomToPandoZoom(hostView.zoom, { projection: kind, size, padding });
  if (kind === 'globe') {
    next.globeRotation = [-wrapLongitude(center[0]), -clamp(center[1], MIN_GLOBE_LATITUDE, MAX_GLOBE_LATITUDE), 0];
    next.globeZoom = pandoZoom;
  } else {
    next.flatCenter = [wrapLongitude(center[0]), clamp(center[1], MIN_FLAT_LATITUDE, MAX_FLAT_LATITUDE)];
    next.flatZoom = pandoZoom;
  }
  return next;
}

export function mercatorCoordinateForLongitudeLatitude(coordinate) {
  const lon = wrapLongitude(coordinate?.[0] || 0);
  const lat = clamp(coordinate?.[1] || 0, MIN_MAPLIBRE_LATITUDE, MAX_MAPLIBRE_LATITUDE);
  const radians = lat * Math.PI / 180;
  return Object.freeze([
    (lon + 180) / 360,
    (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2,
  ]);
}
