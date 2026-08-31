import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { validateGeometry } from '../assets/js/modules/geometry-validation.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '..');

function loadClassic(relativePath, globalName) {
  const filePath = path.join(root, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, 'utf8'), { filename: filePath });
  if (!globalThis[globalName]) throw new Error(`Could not load ${globalName} from ${relativePath}`);
  return globalThis[globalName];
}

const polygonClipping = loadClassic(path.join('assets', 'js', 'vendor', 'polygon-clipping.min.js'), 'polygonClipping');
const countryGeometry = loadClassic(path.join('assets', 'js', 'modules', 'country-geometry.js'), 'PandoLabCountryGeometry');
const countries = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'data', 'countries-ne-5.1.1.geojson'), 'utf8'));
const library = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'data', 'historical-library-pilot.json'), 'utf8'));
const entity = library.entities.find(item => item.libraryId === 'historical-country:east-germany');
if (!entity) throw new Error('East Germany historical library entity is missing');
const geometry = entity.geometryVersions?.[0]?.geometry;
const eastGermany = { type: 'Feature', id: 'HIST_GDR', properties: { editor_id: 'HIST_GDR' }, geometry };
const germany = countries.features.find(feature => feature.properties?.editor_id === 'DEU');
if (!germany) throw new Error('Canonical DEU feature is missing');

const eastIssues = validateGeometry(eastGermany);
if (eastIssues.length) throw new Error(`East Germany fails app geometry validation: ${eastIssues[0].message}`);
const remainderCoordinates = polygonClipping.difference(germany.geometry.coordinates, geometry.coordinates);
const remainderGeometry = countryGeometry.normalizeCountryGeometry(remainderCoordinates);
const remainder = { type: 'Feature', id: 'DEU', properties: { editor_id: 'DEU' }, geometry: remainderGeometry };
const remainderIssues = validateGeometry(remainder);
if (remainderIssues.length) throw new Error(`Subtracted Germany fails app geometry validation: ${remainderIssues[0].message}`);
const overlap = polygonClipping.intersection(geometry.coordinates, remainderGeometry.coordinates);
if (overlap.length) throw new Error('East Germany and subtracted Germany retain polygon overlap');

const aliases = new Set([entity.canonicalName, ...Object.values(entity.displayNames || {}), ...(entity.alternateNames || [])]);
for (const required of ['동독', '독일 민주 공화국', 'East Germany', 'DDR', 'GDR']) {
  if (!aliases.has(required)) throw new Error(`East Germany search alias is missing: ${required}`);
}
if (entity.instantiation?.mode !== 'country-territory-priority'
  || entity.instantiation?.countryUpdates?.DEU?.name !== '독일 연방공화국') {
  throw new Error('East Germany territory-priority instantiation policy is missing');
}

console.log(`Historical library OK: ${library.entities.length} pilots; East Germany + DEU remainder pass app validation.`);
