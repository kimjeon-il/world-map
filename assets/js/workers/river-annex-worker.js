const revision = new URL(self.location.href).searchParams.get('v') || '';
const annexGeometryUrl = new URL('../modules/annex-geometry.js', self.location.href);
const polygonClippingUrl = new URL('../vendor/polygon-clipping.min.js', self.location.href);
if (revision) annexGeometryUrl.searchParams.set('v', revision);
if (revision) polygonClippingUrl.searchParams.set('v', revision);
const dependencies = Promise.all([
  import(annexGeometryUrl.href),
  import(polygonClippingUrl.href),
]).then(([annexGeometryModule]) => ({
  annexGeometryModule,
  clipper: self.polygonClipping || globalThis.polygonClipping || null,
}));

self.onmessage = async event => {
  const message = event.data || {};
  if (message.type !== 'compute') return;
  try {
    const { annexGeometryModule, clipper } = await dependencies;
    const result = annexGeometryModule.buildRiverAnnexCandidates({ ...(message.payload || {}), clipper });
    self.postMessage({ type: 'result', requestId: message.requestId, result });
  } catch (error) {
    self.postMessage({ type: 'error', requestId: message.requestId, message: error?.message || String(error) });
  }
};
