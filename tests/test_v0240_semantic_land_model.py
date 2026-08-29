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


class V0240CountryRegionModelTests(unittest.TestCase):
    def test_region_state_is_separate_from_generic_drawings(self):
        self.assertIn("name: 'territorialUnits', history: true, fallback: () => []", PROJECT_STATE)
        self.assertIn("name: 'territorialRelations', history: true, fallback: () => []", PROJECT_STATE)
        self.assertIn("territorialUnits: []", APP)
        self.assertIn("TERRITORIAL_UNIT_TYPES", APP)
        rules = APP[APP.index("const DRAWING_CATEGORY_RULES"):APP.index("const DRAWING_ROLE_LABELS")]
        self.assertNotIn("territory:", rules)
        self.assertNotIn("administrative:", rules)
        self.assertNotIn("river:", rules)
        self.assertNotIn("lake:", rules)
        self.assertNotIn('id="drawingCategoryInput"', INDEX)

    def test_hydro_edits_are_a_separate_project_domain(self):
        self.assertIn("name: 'hydroEdits', history: true, fallback: () => []", PROJECT_STATE)
        self.assertIn("hydroEdits: []", APP)
        self.assertIn('id="hydroLayerChildren"', INDEX)
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

    def test_parent_and_sovereignty_are_distinct_and_historical_regions_are_explicit(self):
        for field in ("parentId", "sovereignId", "validFrom", "validTo", "sourceLibraryId"):
            self.assertIn(field, MODEL)
        self.assertIn("TERRITORIAL_UNIT_TYPES.REGION", MODEL)
        self.assertIn("TERRITORIAL_COVERAGE_MODES.EXPLICIT", MODEL)
        for element_id in ("historicalRegionsLayerChildren", "historicalRegionProperties"):
            self.assertIn(f'id="{element_id}"', INDEX)

    def test_dedicated_layers_create_flows_and_editors_exist(self):
        for element_id in (
            "regionsLayerChildren", "administrativeLayerChildren", "addRegionBtn",
            "addAdministrativeBtn", "regionProperties", "administrativeProperties",
            "splitRegionBtn", "mergeRegionBtn", "splitAdministrativeBtn",
            "mergeAdministrativeBtn", "countryRegionCreateMethod",
        ):
            self.assertIn(f'id="{element_id}"', INDEX)
        self.assertIn("function startCountryRegionCreate", APP)
        self.assertIn("function finishCountryRegionSplitDraft", APP)
        self.assertIn("function completeCountryRegionMerge", APP)
        self.assertIn("function finishCountryRegionRedrawDraft", APP)

    def test_country_geometry_remains_canonical_and_remainders_are_preserved(self):
        self.assertIn("function reconcileCountryRegionCompleteness", APP)
        self.assertIn("function addUnassignedCountryRegionGeometry", APP)
        self.assertIn("syncHardLandDependents", APP)
        self.assertIn("transferLandDependents", APP)
        self.assertIn("reassignLandDependents", APP)
        self.assertIn("properties?.isRemainder", APP)

    def test_geopackage_and_geojson_round_trip_dedicated_layers(self):
        for table in ("territories", "administrative_units"):
            self.assertIn(table, GIS_ADAPTERS)
        self.assertNotIn("administrative_areas", GIS_ADAPTERS)
        for field in ("sovereign_id", "parent_id", "admin_level", "is_remainder", "properties_json"):
            self.assertIn(field, GIS_ADAPTERS)
        self.assertIn("PandoLabGisAdapters.territorialRows", GPKG)
        self.assertIn("gisAdapters.importTerritorialFeature", GIS)
        self.assertIn('id="gisTargetType"', INDEX)
        self.assertIn('id="gisAdvancedMapping"', INDEX)
        self.assertIn("function importGeoJsonCountryRegions", APP)


if __name__ == "__main__":
    unittest.main()
