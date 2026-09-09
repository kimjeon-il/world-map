from pathlib import Path
import re
import unittest

ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
SURFACE = (ROOT / "assets/js/modules/surface-controller.js").read_text(encoding="utf-8")
TABS = (ROOT / "assets/js/modules/surface-tabs-controller.js").read_text(encoding="utf-8")


class NavigationSurfaceContracts(unittest.TestCase):
    def test_only_map_and_editor_are_primary_surfaces(self):
        for element_id, variant in [("leftPanel", "surface-map"), ("rightPanel", "surface-editor")]:
            start = INDEX.index(f'id="{element_id}"')
            markup = INDEX[start:INDEX.index("</aside>", start)]
            self.assertIn("workspace-surface", markup)
            self.assertIn(variant, markup)
            self.assertLess(markup.index("surface-header"), markup.index("surface-tabs"))
            self.assertLess(markup.index("surface-tabs"), markup.index("surface-body"))
            self.assertLess(markup.index("surface-body"), markup.index("surface-content"))
        self.assertEqual(INDEX.count("workspace-surface"), 2)

    def test_navigation_opens_layers_and_editor_not_add_surface(self):
        nav = re.search(r'<nav class="[^"]*adaptive-nav[^"]*".*?</nav>', INDEX, re.S).group(0)
        self.assertIn('<strong>레이어</strong>', nav)
        self.assertIn('<strong>편집</strong>', nav)
        self.assertNotIn('<strong>추가</strong>', nav)
        self.assertNotIn("createMenu", SURFACE)
        for token in ("activeSurface", "layersOpen", "editorOpen", "editorManuallyCollapsed"):
            self.assertIn(token, SURFACE)

    def test_editor_context_precedes_tabs(self):
        start = INDEX.index('id="rightPanel"')
        markup = INDEX[start:INDEX.index("</aside>", start)]
        self.assertLess(markup.index('id="editorObjectHeader"'), markup.index("surface-tabs"))

    def test_tabs_retain_roving_focus(self):
        for key in ("ArrowLeft", "ArrowRight", "Home", "End"):
            self.assertIn(key, TABS)
        self.assertIn("tab.tabIndex = active ? 0 : -1", TABS)
        self.assertIn("tab.setAttribute('aria-selected', String(active))", TABS)

    def test_virtualization_uses_measured_rows_and_shared_scroll(self):
        controller = (ROOT / "assets/js/modules/layer-tree-controller.js").read_text(encoding="utf-8")
        self.assertIn("ResizeObserver", controller)
        self.assertIn("getBoundingClientRect", controller)
        self.assertNotIn("sheetScrollableAncestor", APP)
        self.assertNotIn("body.addEventListener('touchmove'", APP)

if __name__ == "__main__":
    unittest.main()
