import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, '..');
const sourcePath = path.join(projectRoot, 'assets', 'data', 'countries-ne-5.1.1.geojson');
const checkOnly = process.argv.includes('--check');

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
if (source?.type !== 'FeatureCollection' || source.features?.length !== 258) {
  throw new Error('canonical 국가 데이터는 정확히 258개여야 합니다.');
}

const beforeGeometryHash = hash(source.features.map(feature => feature.geometry));
const normalized = {
  ...source,
  features: source.features.map((feature, index) => {
    const properties = feature?.properties || {};
    const id = String(feature?.id || '');
    const name = String(properties.name || '').trim();
    if (!id || !name) throw new Error(`국가 ${index}의 ID 또는 이름이 비어 있습니다.`);
    return {
      type: 'Feature',
      id,
      properties: { name },
      geometry: feature.geometry,
    };
  }),
};
const ids = normalized.features.map(feature => feature.id);
if (new Set(ids).size !== 258) throw new Error('canonical 국가 ID가 중복되었습니다.');
if (hash(normalized.features.map(feature => feature.geometry)) !== beforeGeometryHash) {
  throw new Error('국가 스키마 정리 중 geometry가 변경되었습니다.');
}

const output = `${JSON.stringify(normalized)}\n`;
if (checkOnly) {
  const existing = fs.readFileSync(sourcePath, 'utf8').replaceAll('\r\n', '\n');
  if (existing !== output) throw new Error('canonical 국가 데이터의 최소 스키마가 최신 상태가 아닙니다.');
} else {
  fs.writeFileSync(sourcePath, output);
}
console.log(`canonical country schema: ${normalized.features.length} features, geometry ${beforeGeometryHash}`);
