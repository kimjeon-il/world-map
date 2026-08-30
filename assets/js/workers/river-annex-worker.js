const revision = new URL(self.location.href).searchParams.get('v') || '';
const annexGeometryUrl = new URL('../modules/annex-geometry.js', self.location.href);
if (revision) annexGeometryUrl.searchParams.set('v', revision);
const annexGeometryModule = import(annexGeometryUrl.href);

self.onmessage = async event => {
  const message = event.data || {};
  if (message.type !== 'compute') return;
  try {
    const { buildRiverAnnexCandidates } = await annexGeometryModule;
    const result = buildRiverAnnexCandidates(message.payload || {});
    self.postMessage({ type: 'result', requestId: message.requestId, result });
  } catch (error) {
    self.postMessage({ type: 'error', requestId: message.requestId, message: error?.message || String(error) });
  }
};
