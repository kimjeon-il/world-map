from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
MODEL = (ROOT / "assets" / "js" / "modules" / "territorial-units.js").read_text(encoding="utf-8")
GEOMETRY = (ROOT / "assets" / "js" / "modules" / "territorial-geometry.js").read_text(encoding="utf-8")
GIS = (ROOT / "assets" / "js" / "gis-io.js").read_text(encoding="utf-8")
GPKG = (ROOT / "assets" / "js" / "workers" / "gis-gpkg-worker.js").read_text(encoding="utf-8")
GIS_ADAPTERS = (ROOT / "assets" / "js" / "gis-adapters.js").read_text(encoding="utf-8")
PROJECT_STATE = (ROOT / "assets" / "js" / "modules" / "project-state.js").read_text(encoding="utf-8")
DRAWING_SERVICE = (ROOT / "assets" / "js" / "modules" / "drawing-service.js").read_text(encoding="utf-8")


class V0240TerritorialUnitModelTests(unittest.TestCase):
    def test_region_state_is_separate_from_generic_drawings(self):
        self.assertIn("name: 'territorialUnits', scope: 'document', fallback: () => []", PROJECT_STATE)
        self.assertIn("name: 'territorialRelations', scope: 'document', fallback: () => []", PROJECT_STATE)
        self.assertIn("territorialUnits: []", APP)
        self.assertIn("TERRITORIAL_UNIT_TYPES", APP)
        rules = DRAWING_SERVICE[DRAWING_SERVICE.index("export const DRAWING_CATEGORY_RULES"):DRAWING_SERVICE.index("export const DRAWING_ROLE_LABELS")]
        self.assertNotIn("territory:", rules)
        self.assertNotIn("administrative:", rules)
        self.assertNotIn("river:", rules)
        self.assertNotIn("lake:", rules)
        self.assertNotIn('id="drawingCategoryInput"', INDEX)

    def test_hydro_edits_are_a_separate_project_domain(self):
        self.assertIn("name: 'hydroEdits', scope: 'document', fallback: () => []", PROJECT_STATE)
        self.assertIn("hydroEdits: []", APP)
        self.assertIn('id="drawingsLayerChildren"', INDEX)
        self.assertIn("layerGroup: 'hydro'", APP)
        self.assertIn('id="hydroEditFields"', INDEX)
        self.assertIn("function renderHydroEdits()", APP)
        self.assertIn("state.hydroEdits.push(feature)", APP)

    def test_model_normalizes_relations_and_transactions(self):
        for symbol in (
            "normalizeTerritorialUnits", "validateTerritorialRelations",
            "territorialChildren", "territorialSiblings",
            "runTerritorialTransaction", "parentCreatesCycle",
        ):
            self.assertIn(f"function {symbol}", MODEL)
        self.assertIn("isRemainder", MODEL)
        for operation in ("transferGeometry", "mergeUnits", "splitUnit", "editBoundary"):
            self.assertIn(f"function {operation}", GEOMETRY)

    def test_parent_and_sovereignty_are_distinct_and_regions_are_explicit(self):
        for field in ("parentId", "sovereignId", "validFrom", "validTo", "sourceLibraryId"):
            self.assertIn(field, MODEL)
        self.assertIn("TERRITORIAL_UNIT_TYPES.REGION", MODEL)
        self.assertIn("TERRITORIAL_COVERAGE_MODES.EXPLICIT", MODEL)
        for element_id in ("regionsLayerChildren", "regionProperties"):
            self.assertIn(f'id="{element_id}"', INDEX)

    def test_dedicated_layers_create_flows_and_editors_exist(self):
        for element_id in (
            "territoriesLayerChildren", "administrativeLayerChildren", "regionsLayerChildren",
            "addTerritoryBtn", "addAdministrativeBtn", "addRegionBtn",
            "territoryProperties", "administrativeProperties", "regionProperties",
            "splitTerritoryBtn", "mergeTerritoryBtn", "splitAdministrativeBtn",
            "mergeAdministrativeBtn", "territorialCreateMethod",
        ):
            self.assertIn(f'id="{element_id}"', INDEX)
        self.assertIn("function startTerritorialUnitCreate", APP)
        self.assertIn("function finishTerritorialUnitSplitDraft", APP)
        self.assertIn("function completeTerritorialUnitMerge", APP)
        self.assertIn("function finishTerritorialUnitRedrawDraft", APP)

    def test_create_menu_and_code_use_canonical_territorial_names(self):
        territorial_buttons = [
            INDEX.index('id="addCountryBtn"'),
            INDEX.index('id="addTerritoryBtn"'),
            INDEX.index('id="addAdministrativeBtn"'),
            INDEX.index('id="addRegionBtn"'),
        ]
        self.assertEqual(territorial_buttons, sorted(territorial_buttons))
        self.assertIn("openTerritorialCreateModal(TERRITORIAL_UNIT_TYPES.TERRITORY)", APP)
        self.assertIn("openTerritorialCreateModal(TERRITORIAL_UNIT_TYPES.REGION)", APP)
        self.assertNotIn("COUNTRY_REGION_KINDS", APP)
        self.assertNotIn("region: '권역'", APP)
        self.assertIn("territory: '권역'", APP)

    def test_region_creation_is_explicit_and_not_a_partition_alias(self):
        direct_create = APP[APP.index("function finishTerritorialUnitDirectDraft"):APP.index("function normalizeEditorColor")]
        self.assertIn("unitType: TERRITORIAL_UNIT_TYPES.REGION", direct_create)
        self.assertIn("coverageMode: TERRITORIAL_COVERAGE_MODES.EXPLICIT", direct_create)
        self.assertIn("isRemainder: false", direct_create)
        self.assertIn("state.layerVisibility.regions = true", direct_create)
        self.assertIn("function importGeoJsonRegions", APP)

    def test_country_geometry_remains_canonical_and_remainders_are_preserved(self):
        self.assertIn("function reconcileTerritorialUnitCompleteness", APP)
        self.assertIn("function addUnassignedTerritorialUnitGeometry", APP)
        self.assertIn("syncHardLandDependents", APP)
        self.assertIn("transferLandDependents", APP)
        self.assertIn("reassignLandDependents", APP)
        self.assertIn("properties?.isRemainder", APP)

    def test_geopackage_and_geojson_round_trip_dedicated_layers(self):
        for table in ("territories", "administrative", "regions"):
            self.assertIn(table, GIS_ADAPTERS)
        self.assertNotIn("administrative_areas", GIS_ADAPTERS)
        for field in ("sovereign_id", "parent_id", "admin_level", "is_remainder", "properties_json"):
            self.assertIn(field, GIS_ADAPTERS)
        self.assertIn("PandoLabGisAdapters.territorialRows", GPKG)
        self.assertIn("gisAdapters.importTerritorialFeature", GIS)
        self.assertIn('id="gisTargetType"', INDEX)
        self.assertIn('id="gisAdvancedMapping"', INDEX)
        self.assertIn("function importGeoJsonTerritorialUnits", APP)
        self.assertIn("function importGeoJsonRegions", APP)


if __name__ == "__main__":
    unittest.main()
