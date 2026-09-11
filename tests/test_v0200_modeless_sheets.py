from tests.application_source import read_application_sources
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
SURFACE = (ROOT / "assets/js/modules/surface-controller.js").read_text(encoding="utf-8")
SHEETS = (ROOT / "assets/js/modules/mobile-sheet-controller.js").read_text(encoding="utf-8")


class ModelessSheetContracts(unittest.TestCase):
    def test_only_map_and_editor_own_sheet_handles(self):
        self.assertEqual(re.findall(r'data-sheet-handle="([^"]+)"', INDEX), ["leftPanel", "rightPanel"])
        self.assertNotIn("createMenu", SHEETS)
        self.assertNotIn("createMenu", SURFACE)

    def test_add_is_a_menu_in_every_layout(self):
        tag = re.search(r'<section id="createMenu"[^>]+>', INDEX).group(0)
        self.assertIn('role="menu"', tag)
        self.assertIn("layer-create-menu", tag)
        self.assertNotIn("workspace-surface", tag)
        trigger = re.search(r'<button id="createMenuBtn"[^>]+>', INDEX).group(0)
        self.assertIn('aria-haspopup="menu"', trigger)
        self.assertIn('aria-controls="createMenu"', trigger)

    def test_menu_open_does_not_dispatch_surface_or_history(self):
        body = re.search(r"function toggleCreateMenu\([^)]*\) \{([\s\S]*?)\n  \}", APP).group(1)
        self.assertNotIn("openSurface", body)
        self.assertNotIn("pushState", body)
        self.assertIn("positionLayerCreateMenu", body)

    def test_menu_keyboard_and_native_scroll_are_preserved(self):
        for key in ("ArrowDown", "ArrowUp", "Home", "End", "Escape", "Tab"):
            self.assertIn(key, APP)
        scroll = (ROOT / "assets/js/modules/overlay-scrollbars.js").read_text(encoding="utf-8")
        self.assertIn("element.scrollTop", scroll)
        self.assertIn("'aria-controls'", scroll)
        self.assertIn("'role', 'scrollbar'", scroll)

if __name__ == "__main__":
    unittest.main()
