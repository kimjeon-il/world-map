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
        self.assertIn(":where(.ui-scroll-surface, .layer-children, .ui-select-listbox) {", CSS)
        self.assertIn("scrollbar-gutter: stable;", CSS)
        self.assertIn("scrollbar-width: thin;", CSS)
        self.assertIn("scrollbar-color: var(--border-strong) transparent;", CSS)
        self.assertIn("background-clip: padding-box;", CSS)
        self.assertIn("::-webkit-scrollbar-track { background: transparent; }", CSS)
        self.assertNotIn(".sidebar { min-width: 0; font-size: var(--ui-font-body); scrollbar-width", CSS)

    def test_panel_scroll_owners_use_the_shared_surface_class(self):
        self.assertIn('class="layer-list ui-scroll-surface"', INDEX)
        self.assertIn('class="editor-scroll-body ui-scroll-surface"', INDEX)
        self.assertIn('class="layer-search-results ui-scroll-surface hidden"', INDEX)
        self.assertIn('class="object-chooser-list ui-scroll-surface"', INDEX)
        self.assertIn('class="ui-menu ui-popover ui-floating-surface top-actions ui-scroll-surface"', INDEX)

    def test_mobile_panel_scroll_surfaces_do_not_use_both_edge_gutters(self):
        self.assertNotIn("scrollbar-gutter: stable both-edges;", CSS)
        mobile_auto_start = CSS.index('body[data-layout="mobile"] :is(')
        mobile_auto_end = CSS.index('\n) {', mobile_auto_start)
        mobile_auto = CSS[mobile_auto_start:mobile_auto_end]
        self.assertNotIn(".map-sheet-body-layers .layer-list", mobile_auto)
        self.assertNotIn(".editor-scroll-body", mobile_auto)
        self.assertNotIn(".layer-children", mobile_auto)

    def test_scroll_owners_use_explicit_content_rail_compensation(self):
        self.assertRegex(CSS, r"#fileMenu\s*\{[^}]*padding-inline-start:\s*var\(--ui-scrollbar-size\);")
        self.assertRegex(CSS, r"\.ui-select-listbox\s*\{[^}]*padding-inline-start:\s*var\(--ui-scrollbar-size\);")
        self.assertRegex(CSS, r"\.layer-children\s*\{[^}]*calc\(var\(--ui-space-0-5\) \+ var\(--ui-scrollbar-size\)\)")
        self.assertRegex(CSS, r"\.editor-scroll-body\s*\{[^}]*padding-inline-start:\s*var\(--ui-scrollbar-size\);")
        self.assertRegex(CSS, r"\.map-view-settings\s*\{[^}]*padding-inline-start:\s*var\(--ui-scrollbar-size\);")
        self.assertIn(".map-sheet-body:not(.map-sheet-body-layers)", CSS)
        self.assertIn("scrollbar-gutter: auto;", CSS)


if __name__ == "__main__":
    unittest.main()
