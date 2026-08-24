from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")


class V0200ModelessSheetTests(unittest.TestCase):
    def test_file_menu_uses_a_dedicated_top_overlay(self):
        overlay = re.search(r'<div id="overlayRoot" class="overlay-root">([\s\S]+?)\n\s*</div>\n\s*</div>', INDEX)
        self.assertIsNotNone(overlay)
        markup = overlay.group(1)
        self.assertIn('id="mobileBackdrop"', markup)
        self.assertIn('class="top-actions"', markup)
        self.assertIn("body.file-menu-open .mobile-backdrop", CSS)
        self.assertIn("document.body.classList.toggle('file-menu-open', !!fileOpen)", APP)
        self.assertIn("document.body.classList.contains('file-menu-open')", APP)

    def test_map_sheets_have_three_snap_heights_and_drag_handles(self):
        self.assertEqual(INDEX.count('data-sheet-handle="'), 3)
        self.assertIn('data-sheet-handle="createMenu"', INDEX)
        self.assertIn("const SHEET_SNAP_RATIOS = Object.freeze([0.35, 0.6, 0.9]);", APP)
        self.assertIn("const SHEET_SNAP_LABELS = Object.freeze(['기본 높이', '중간 높이', '최대 높이']);", APP)
        self.assertIn("document.querySelectorAll('[data-sheet-handle]').forEach(bindSheetDragHandle);", APP)
        self.assertIn("body.map-sheet-dragging", CSS)

    def test_add_menu_is_a_modeless_map_sheet_on_mobile(self):
        self.assertIn("#app[data-layout=\"mobile\"] .create-sheet-header", CSS)
        self.assertIn("height: var(--sheet-height, 35dvh);", CSS)
        self.assertIn("$('mobileCloseCreateBtn')?.addEventListener", APP)
        outside_click = re.search(r"document\.addEventListener\('click', e => \{([\s\S]+?)\n\s*\}\);", APP)
        self.assertIsNotNone(outside_click)
        self.assertNotIn("closeCreateMenu", outside_click.group(1))

    def test_map_sheets_do_not_share_the_modal_backdrop_or_focus_trap(self):
        self.assertNotIn("responsive-overlay-open", APP + CSS)
        self.assertNotIn("mobile-sheet-open", APP + CSS)
        backdrop_handler = re.search(
            r"\$\('mobileBackdrop'\)\?\.addEventListener\('click',[\s\S]+?\n\s*\}\);",
            APP,
        )
        self.assertIsNotNone(backdrop_handler)
        self.assertIn("closeFileMenu", backdrop_handler.group(0))
        self.assertNotIn("closeMobileSheets", backdrop_handler.group(0))
        self.assertIn("if (e.key === 'Tab' && document.body.classList.contains('file-menu-open'))", APP)

    def test_open_sheet_reserves_map_space_without_changing_zoom(self):
        self.assertIn("workspace?.style.setProperty('--map-safe-bottom'", APP)
        self.assertIn("body.map-sheet-open #app[data-layout=\"mobile\"] .mode-action-bar", CSS)
        self.assertIn("const scaleContentHeight = isMobile()", APP)
        self.assertIn("Math.max(1, height - safe.top - 96)", APP)

    def test_selection_updates_existing_editor_without_forcing_it_open(self):
        function = re.search(r"function openSelectionEditor\(\) \{([\s\S]+?)\n\s*\}", APP)
        self.assertIsNotNone(function)
        body = function.group(1)
        self.assertNotIn("classList.add('mobile-open')", body)
        self.assertNotIn("focus(", body)

    def test_version_is_updated(self):
        self.assertIn('data-app-version="0.21.0"', INDEX)
        self.assertIn("const APP_VERSION = '0.21.0'", APP)
        self.assertIn("app.css?v=0.21.0", INDEX)


if __name__ == "__main__":
    unittest.main()
