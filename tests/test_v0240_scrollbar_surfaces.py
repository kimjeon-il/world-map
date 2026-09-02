from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")


class ScrollbarSurfaceTests(unittest.TestCase):
    def test_scrollbar_tokens_and_browser_rules_have_one_owner(self):
        self.assertIn("--ui-scrollbar-size: 10px;", CSS)
        self.assertIn("--ui-scrollbar-thumb-inset: 3px;", CSS)
        self.assertIn(":where(", CSS)
        self.assertIn(".ui-scroll-surface,", CSS)
        self.assertIn("scrollbar-gutter: stable both-edges;", CSS)
        self.assertIn("scrollbar-width: thin;", CSS)
        self.assertIn("scrollbar-color: var(--border-strong) transparent;", CSS)
        self.assertIn("background-clip: padding-box;", CSS)
        self.assertIn("::-webkit-scrollbar-track { background: transparent; }", CSS)
        self.assertNotIn(".sidebar { min-width: 0; font-size: var(--ui-font-body); scrollbar-width", CSS)

    def test_panel_scroll_owners_use_the_shared_surface_class(self):
        self.assertIn('class="layer-list ui-scroll-surface"', INDEX)
        self.assertIn('class="surface-body editor-scroll-body ui-scroll-surface"', INDEX)
        self.assertIn('class="layer-search-results ui-scroll-surface hidden"', INDEX)
        self.assertIn('class="object-chooser-list ui-scroll-surface"', INDEX)
        self.assertIn('class="ui-menu ui-popover ui-floating-surface top-actions ui-scroll-surface"', INDEX)

    def test_mobile_panel_scroll_surfaces_keep_the_same_gutter_contract(self):
        mobile_surface = CSS[CSS.index('#app[data-layout="mobile"] .surface-body {'):CSS.index('#app[data-layout="mobile"] .surface-map > .surface-body-delegated')]
        mobile_layer_list = CSS[CSS.index('#app[data-layout="mobile"] .surface-map > .surface-body-delegated .layer-list {'):CSS.index('\n}\n\n#app[data-layout="mobile"] .top-actions')]
        self.assertIn("scrollbar-gutter: stable both-edges;", mobile_surface)
        self.assertIn("scrollbar-gutter: stable both-edges;", mobile_layer_list)

    def test_sheet_scroll_owners_use_symmetric_gutters_and_rails(self):
        self.assertNotIn("padding-inline-start: var(--ui-scrollbar-size);", CSS)
        self.assertNotIn("calc(var(--ui-space-0-5) + var(--ui-scrollbar-size))", CSS)
        self.assertNotIn("calc(var(--ui-menu-padding) + var(--ui-scrollbar-size))", CSS)
        self.assertIn('.surface-content-create {', CSS)
        self.assertIn('padding-inline-start: var(--ui-surface-content-rail-x);', CSS)
        self.assertRegex(CSS, r"\.editor-scroll-body\s*\{(?![^}]*padding-inline-start)")
        self.assertRegex(CSS, r"\.map-view-settings\s*\{[^}]*padding-inline-start:\s*var\(--ui-surface-content-rail-x\);")
        self.assertNotIn(".surface-body:not(.surface-body-delegated)", CSS)

    def test_gis_import_rail_uses_the_shared_symmetric_gutter(self):
        rail_start = CSS.index("#gisImportForm > .gis-import-content-rail {")
        rail_end = CSS.index("\n}", rail_start) + 2
        rail = CSS[rail_start:rail_end]
        self.assertIn("scrollbar-gutter: stable both-edges;", rail)
        self.assertNotIn("padding-inline-start", rail)

    def test_visual_rail_does_not_include_scrollbar_compensation(self):
        self.assertIn("--ui-surface-content-rail-x: var(--ui-surface-content-padding-x);", CSS)
        self.assertNotIn("--ui-surface-visual-rail-x", CSS)
        self.assertNotIn("--ui-surface-scrollbar-compensation", CSS)


if __name__ == "__main__":
    unittest.main()
