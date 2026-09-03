export const REFERENCE_IMAGE_PLACEMENT = Object.freeze({
  handleRadius: 7,
  rotateHandleOffset: 26,
  minimumWidth: 48,
  minimumHeight: 36,
});

const radians = value => Number(value) * Math.PI / 180;
const degrees = value => Number(value) * 180 / Math.PI;

export function normalizeReferenceImageRotation(value) {
  let angle = Number(value);
  if (!Number.isFinite(angle)) angle = 0;
  angle %= 360;
  if (angle > 180) angle -= 360;
  if (angle <= -180) angle += 360;
  return angle;
}

export function normalizeReferenceImageScreenRect(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return {
    x,
    y,
    width: Math.max(REFERENCE_IMAGE_PLACEMENT.minimumWidth, width),
    height: Math.max(REFERENCE_IMAGE_PLACEMENT.minimumHeight, height),
  };
}

export function defaultReferenceImageScreenRect(image, mapElement) {
  const bounds = mapElement.getBoundingClientRect();
  const maxWidth = Math.max(180, bounds.width * 0.62);
  const maxHeight = Math.max(140, bounds.height * 0.62);
  const naturalWidth = Math.max(1, Number(image?.naturalWidth) || 1);
  const naturalHeight = Math.max(1, Number(image?.naturalHeight) || 1);
  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);
  const width = Math.max(80, naturalWidth * scale);
  const height = Math.max(60, naturalHeight * scale);
  return {
    x: (bounds.width - width) / 2,
    y: (bounds.height - height) / 2,
    width,
    height,
  };
}

export function rotateReferenceImagePoint(point, center, rotation) {
  const angle = radians(rotation);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point[0] - center[0];
  const dy = point[1] - center[1];
  return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos];
}

export function referenceImagePlacementGeometry(record) {
  const rect = normalizeReferenceImageScreenRect(record?.screenRect);
  if (!rect) return null;
  const rotation = normalizeReferenceImageRotation(record?.rotation);
  const center = [rect.x + rect.width / 2, rect.y + rect.height / 2];
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ].map(point => rotateReferenceImagePoint(point, center, rotation));
  const rotateHandle = rotateReferenceImagePoint(
    [center[0], rect.y - REFERENCE_IMAGE_PLACEMENT.rotateHandleOffset],
    center,
    rotation,
  );
  return Object.freeze({ rect, rotation, center, corners, rotateHandle });
}

export function referenceImagePointToPlacementLocal(record, point) {
  const geometry = referenceImagePlacementGeometry(record);
  if (!geometry || !Array.isArray(point) || point.length < 2) return null;
  const unrotated = rotateReferenceImagePoint(point, geometry.center, -geometry.rotation);
  return [unrotated[0] - geometry.rect.x, unrotated[1] - geometry.rect.y];
}

export function referenceImagePlacementHit(record, point) {
  const geometry = referenceImagePlacementGeometry(record);
  if (!geometry) return null;
  const radius = REFERENCE_IMAGE_PLACEMENT.handleRadius + 4;
  if (Math.hypot(point[0] - geometry.rotateHandle[0], point[1] - geometry.rotateHandle[1]) <= radius) {
    return Object.freeze({ type: 'rotate' });
  }
  const cornerNames = ['nw', 'ne', 'se', 'sw'];
  for (let index = 0; index < geometry.corners.length; index += 1) {
    const corner = geometry.corners[index];
    if (Math.hypot(point[0] - corner[0], point[1] - corner[1]) <= radius) {
      return Object.freeze({ type: 'scale', corner: cornerNames[index] });
    }
  }
  const local = referenceImagePointToPlacementLocal(record, point);
  if (
    local
    && local[0] >= 0 && local[0] <= geometry.rect.width
    && local[1] >= 0 && local[1] <= geometry.rect.height
  ) return Object.freeze({ type: 'move' });
  return null;
}

export function createReferenceImagePlacementDrag(record, hit, point, pointerId = null) {
  const geometry = referenceImagePlacementGeometry(record);
  if (!geometry || !hit) return null;
  return {
    pointerId,
    recordId: record.id,
    hit,
    startPoint: [...point],
    startRect: { ...geometry.rect },
    startRotation: geometry.rotation,
    center: [...geometry.center],
    aspect: geometry.rect.width / Math.max(1, geometry.rect.height),
  };
}

export function applyReferenceImagePlacementDrag(record, drag, point, { shiftKey = false } = {}) {
  if (!record || !drag || !Array.isArray(point) || point.length < 2) return false;
  if (drag.hit.type === 'move') {
    const dx = point[0] - drag.startPoint[0];
    const dy = point[1] - drag.startPoint[1];
    record.screenRect = {
      ...drag.startRect,
      x: drag.startRect.x + dx,
      y: drag.startRect.y + dy,
    };
    return true;
  }
  if (drag.hit.type === 'rotate') {
    const angle = degrees(Math.atan2(point[1] - drag.center[1], point[0] - drag.center[0])) + 90;
    record.rotation = normalizeReferenceImageRotation(shiftKey ? Math.round(angle / 15) * 15 : angle);
    return true;
  }
  if (drag.hit.type !== 'scale') return false;
  const unrotated = rotateReferenceImagePoint(point, drag.center, -drag.startRotation);
  let halfWidth = Math.max(REFERENCE_IMAGE_PLACEMENT.minimumWidth / 2, Math.abs(unrotated[0] - drag.center[0]));
  let halfHeight = Math.max(REFERENCE_IMAGE_PLACEMENT.minimumHeight / 2, Math.abs(unrotated[1] - drag.center[1]));
  if (shiftKey) {
    const widthFromHeight = halfHeight * 2 * drag.aspect;
    const heightFromWidth = halfWidth * 2 / drag.aspect;
    if (widthFromHeight > halfWidth * 2) halfWidth = widthFromHeight / 2;
    else halfHeight = heightFromWidth / 2;
  }
  record.screenRect = {
    x: drag.center[0] - halfWidth,
    y: drag.center[1] - halfHeight,
    width: halfWidth * 2,
    height: halfHeight * 2,
  };
  return true;
}
