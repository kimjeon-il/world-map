from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
MODEL = (ROOT / "assets" / "js" / "modules" / "country-regions.js").read_text(encoding="utf-8")
GIS = (ROOT / "assets" / "js" / "gis-io.js").read_text(encoding="utf-8")
GPKG = (ROOT / "assets" / "js" / "workers" / "gis-gpkg-worker.js").read_text(encoding="utf-8")
PROJECT_STATE = (ROOT / "assets" / "js" / "modules" / "project-state.js").read_text(encoding="utf-8")


class V0240CountryRegionModelTests(unittest.TestCase):
    def test_region_state_is_separate_from_generic_drawings(self):
        self.assertIn("name: 'countryRegions', history: true, fallback: () => []", PROJECT_STATE)
        self.assertIn("countryRegions: []", APP)
        self.assertIn("COUNTRY_REGION_KINDS", APP)
        rules = APP[APP.index("const DRAWING_CATEGORY_RULES"):APP.index("const DRAWING_ROLE_LABELS")]
        self.assertNotIn("territory:", rules)
        self.assertNotIn("administrative:", rules)
        drawing_categories = INDEX[INDEX.index('id="drawingCategoryInput"'):INDEX.index('</select>', INDEX.index('id="drawingCategoryInput"'))]
        self.assertNotIn('<option value="territory">', drawing_categories)
        self.assertNotIn('<option value="administrative">', drawing_categories)

    def test_model_normalizes_relations_and_transactions(self):
        for symbol in (
            "normalizeCountryRegions", "validateCountryRegionRelations",
            "countryRegionChildren", "countryRegionSiblings",
            "runCountryRegionTransaction", "parentCreatesCycle",
        ):
            self.assertIn(f"function {symbol}", MODEL)
        self.assertIn("COUNTRY_REGION_STATUS", MODEL)

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
        self.assertIn("COUNTRY_REGION_STATUS.UNASSIGNED", APP)

    def test_geopackage_and_geojson_round_trip_dedicated_layers(self):
        for table in ("territories", "administrative_areas"):
            self.assertIn(table, GPKG)
            self.assertIn(table, GIS)
        for field in ("country_id", "parent_region_id", "level", "status", "source_folder_id", "properties_json"):
            self.assertIn(field, GPKG)
        self.assertIn('id="geoJsonTargetType"', INDEX)
        self.assertIn("function importGeoJsonCountryRegions", APP)


if __name__ == "__main__":
    unittest.main()
