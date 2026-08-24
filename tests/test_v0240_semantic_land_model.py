from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
GIS = (ROOT / "assets" / "js" / "gis-io.js").read_text(encoding="utf-8")
GPKG = (ROOT / "assets" / "js" / "workers" / "gis-gpkg-worker.js").read_text(encoding="utf-8")
README = (ROOT / "README.md").read_text(encoding="utf-8")


class V0240SemanticLandModelTests(unittest.TestCase):
    def test_categories_have_explicit_roles_and_geometry_contracts(self):
        rules = APP[APP.index("const DRAWING_CATEGORY_RULES"):APP.index("const DRAWING_ROLE_LABELS")]
        for token in (
            "river: Object.freeze({ role: 'hydro', geometry: 'line'",
            "lake: Object.freeze({ role: 'hydro', geometry: 'polygon'",
            "territory: Object.freeze({ role: 'territory', geometry: 'polygon', binding: 'hard'",
            "administrative: Object.freeze({ role: 'administrative', geometry: 'polygon', binding: 'hard'",
            "ethnicity: Object.freeze({ role: 'thematic', geometry: 'polygon', binding: 'clip'",
            "religion: Object.freeze({ role: 'thematic', geometry: 'polygon', binding: 'clip'",
            "language: Object.freeze({ role: 'thematic', geometry: 'polygon', binding: 'clip'",
        ):
            self.assertIn(token, rules)
        self.assertIn("function drawingCategoryCompatible", APP)
        self.assertIn("option.disabled = expected !== 'any' && expected !== geometryKind", APP)

    def test_land_relationship_editor_and_role_actions_are_wired(self):
        for element_id in (
            "drawingLandRelationSection", "drawingOwnerInput", "drawingParentInput",
            "drawingLandBindingInput", "splitDrawingBtn", "mergeDrawingBtn",
            "syncDrawingCoastBtn", "editDrawingCoastBtn",
            "applyDrawingToCountryBtn", "promoteDrawingToCountryBtn",
        ):
            self.assertIn(f'id="{element_id}"', INDEX)
            self.assertIn(f"$('{element_id}')", APP)
        self.assertIn("function enterDrawingSplitMode", APP)
        self.assertIn("function completeDrawingMerge", APP)
        self.assertIn("function applySelectedDrawingToOwnerCountry", APP)
        self.assertIn("function promoteSelectedDrawingToCountry", APP)
        self.assertIn("const geometricLand = polygon && !['hydro'].includes(role)", APP)
        self.assertIn("index !== split.componentIndex", APP)
        self.assertIn("...untouchedComponents", APP)

    def test_country_coast_is_canonical_for_bound_land(self):
        self.assertIn("function hardLandDependents", APP)
        self.assertIn("function syncHardLandDependents", APP)
        self.assertIn("pointOnGeometryBoundary(vertex.coord, owner.geometry", APP)
        self.assertIn("편집창의 해안 구간 수정을 사용하세요", APP)
        self.assertIn("coastEditScopeDrawingId", APP)
        self.assertIn("연결된 영토·행정구역은 함께 변경", APP)
        self.assertIn("국가 해안선은 단일 기준 형상", README)

    def test_thematic_polygons_are_land_clipped_without_ownership_transfer(self):
        display = APP[APP.index("function drawingDisplayFeature"):APP.index("function drawingName")]
        self.assertIn("clipper.intersection", display)
        self.assertIn("spatialFeatures(bounds)", display)
        help_text = APP[APP.index("function drawingRoleHelp"):APP.index("function drawingDisplayFeature")]
        self.assertIn("국가 소유권과 분리하며 육지 안에서만 표시", help_text)
        self.assertIn("$('drawingLandActionsSection').classList.toggle('hidden', !geometricLand)", APP)

    def test_country_operations_preserve_land_relationships_as_one_transaction(self):
        for helper in (
            "transferLandDependents", "reassignLandDependents", "reassignDrawingParents",
        ):
            self.assertIn(f"function {helper}", APP)
        self.assertIn("transferLandDependents(candidate.geometry, donorIds, targetId)", APP)
        self.assertIn("transferLandDependents(candidate.geometry, sourceIds, feature.properties.editor_id)", APP)
        self.assertIn("transferLandDependents(transferredGeometry, donorIds, ownerId)", APP)
        self.assertIn("transferLandDependents(transferredGeometry, sourceIds, country.properties.editor_id", APP)
        self.assertIn("reassignLandDependents(targetIds, sourceId)", APP)
        self.assertIn("drawings: deepClone(state.drawings)", APP)

    def test_legacy_loads_normalize_after_country_geometry_is_available(self):
        self.assertIn("function normalizeDrawingSemantics", APP)
        self.assertIn("function normalizeDrawingCollection", APP)
        owner_inference = APP[APP.index("function inferDrawingOwnerId"):APP.index("function normalizeDrawingSemantics")]
        self.assertIn("clipper.intersection", owner_inference)
        self.assertNotIn("d3.geo.centroid", owner_inference)
        self.assertGreaterEqual(APP.count("state.drawings = normalizeDrawingCollection"), 4)
        apply_state = APP[APP.index("function applyAtlasState"):APP.index("let confirmModalAction")]
        self.assertLess(apply_state.index("state.countriesData ="), apply_state.index("state.drawings = normalizeDrawingCollection"))
        startup = APP[APP.index("async function init()"):]
        self.assertLess(startup.index("state.countriesData ="), startup.index("state.drawings = normalizeDrawingCollection"))

    def test_semantic_fields_round_trip_through_geopackage_and_geojson(self):
        for field in (
            "aw_role", "aw_owner_id", "aw_parent_id", "aw_topology_group", "aw_land_binding",
        ):
            self.assertIn(field, GPKG)
            self.assertIn(field, GIS)
        self.assertIn("properties_json", GPKG)
        self.assertIn("features: deepClone(state.drawings)", APP)
        self.assertIn("landObjectModel", APP)


if __name__ == "__main__":
    unittest.main()
