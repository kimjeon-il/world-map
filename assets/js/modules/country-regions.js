// v0.25 compatibility facade. Runtime code migrates to territorial-units.js.
import {
  TERRITORIAL_SCHEMA_VERSION,
  TERRITORIAL_STATUS,
  TERRITORIAL_UNIT_TYPES,
  createTerritorialFeature,
  migrateLegacyCountryRegions,
  runTerritorialTransaction,
  territorialChildren,
  territorialSiblings,
  validateTerritorialRelations,
} from './territorial-units.js';

export const COUNTRY_REGION_SCHEMA_VERSION = TERRITORIAL_SCHEMA_VERSION;
export const COUNTRY_REGION_STATUS = TERRITORIAL_STATUS;
export const COUNTRY_REGION_KINDS = Object.freeze({
  REGION: TERRITORIAL_UNIT_TYPES.TERRITORY,
  ADMINISTRATIVE: TERRITORIAL_UNIT_TYPES.ADMIN,
});

export const normalizeCountryRegions = migrateLegacyCountryRegions;
export const countryRegionChildren = territorialChildren;
export const countryRegionSiblings = territorialSiblings;
export const validateCountryRegionRelations = validateTerritorialRelations;
export const runCountryRegionTransaction = runTerritorialTransaction;

export function createCountryRegionFeature({
  id,
  kind,
  countryId = '',
  parentRegionId = '',
  level = null,
  status,
  name = '',
  color = '',
  notes = '',
  sourceFolderId = '',
  geometry,
}) {
  const unitType = kind === 'administrative' || kind === TERRITORIAL_UNIT_TYPES.ADMIN
    ? TERRITORIAL_UNIT_TYPES.ADMIN
    : TERRITORIAL_UNIT_TYPES.TERRITORY;
  return createTerritorialFeature({
    id,
    unitType,
    parentId: parentRegionId || countryId,
    sovereignId: countryId,
    status,
    adminLevel: unitType === TERRITORIAL_UNIT_TYPES.ADMIN ? level : null,
    name,
    color,
    notes,
    sourceFolderId,
    geometry,
  });
}
