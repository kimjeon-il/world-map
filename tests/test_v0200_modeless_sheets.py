from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
SURFACE = (ROOT / "assets" / "js" / "modules" / "surface-controller.js").read_text(encoding="utf-8")


class V0200ModelessSheetTests(unittest.TestCase):
    def test_file_menu_uses_a_dedicated_top_overlay(self):
        overlay = re.search(r'<div class="overlay-root">([\s\S]+?)\n\s*</div>\n\s*</div>', INDEX)
        self.assertIsNotNone(overlay)
        markup = overlay.group(1)
        self.assertIn('id="mobileBackdrop"', markup)
        self.assertRegex(markup, r'class="[^"]*ui-popover[^"]*top-actions[^"]*"')
        self.assertIn("body.file-menu-open .mobile-backdrop", CSS)
        self.assertIn("document.body.classList.toggle('file-menu-open', fileOpen)", SURFACE)
        self.assertIn("document.body.classList.contains('file-menu-open')", APP)

    def test_map_sheets_have_two_snap_heights_and_drag_handles(self):
        self.assertEqual(INDEX.count('data-sheet-handle="'), 3)
        self.assertEqual(INDEX.count('ui-button sheet-drag-handle'), 3)
        self.assertIn('data-sheet-handle="createMenu"', INDEX)
        self.assertEqual(INDEX.count('role="slider" data-sheet-handle='), 3)
        self.assertIn("const SHEET_SNAP_RATIOS = Object.freeze([0.6, 1]);", APP)
        self.assertIn("const SHEET_SNAP_LABELS = Object.freeze(['기본 높이', '전체 높이']);", APP)
        self.assertEqual(INDEX.count('aria-valuemax="1"'), 3)
        self.assertIn("window.visualViewport?.height || window.innerHeight", APP)
        self.assertIn("Object.values(MOBILE_SHEET_IDS).forEach(id => bindMobileSheetSurface($(id)));", APP)
        self.assertIn("body.map-sheet-dragging", CSS)

    def test_add_menu_is_a_modeless_map_sheet_on_mobile(self):
        self.assertEqual(INDEX.count("map-sheet-surface"), 3)
        self.assertIn("#app[data-layout=\"mobile\"] .create-menu.mobile-open", CSS)
        self.assertIn("height: var(--sheet-height, 60dvh);", CSS)
        self.assertIn("$('mobileCloseCreateBtn')?.addEventListener", APP)
        self.assertIn("panel.setAttribute('aria-modal', 'false')", SURFACE)
        self.assertIn("item.removeAttribute('role')", SURFACE)
        outside_click = re.search(r"document\.addEventListener\('click', e => \{([\s\S]+?)\n\s*\}\);", APP)
        self.assertIsNotNone(outside_click)
        self.assertNotIn("closeCreateMenu", outside_click.group(1))

    def test_only_one_mobile_sheet_can_be_active(self):
        self.assertIn("let activeMobileSheet = null;", SURFACE)
        self.assertIn("function open(surface, { automatic = false } = {})", SURFACE)
        self.assertIn("activeMobileSheet = SURFACE_TO_MOBILE[surface]", SURFACE)
        self.assertIn("state.layersOpen = surface === 'layers'", SURFACE)
        self.assertIn("state.editorOpen = surface === 'editor'", SURFACE)
        self.assertIn('aria-controls="leftPanel"', INDEX)
        self.assertIn('aria-controls="createMenu"', INDEX)
        self.assertIn('aria-controls="rightPanel"', INDEX)

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
        self.assertIn("fileMenu?.addEventListener('keydown'", APP)
        self.assertIn("if (event.key === 'Tab')", APP)
        self.assertIn("closeFileMenu({ restoreFocus: true })", APP)

    def test_sheet_occlusion_does_not_move_the_map_or_floating_controls(self):
        self.assertNotIn("--sheet-occlusion-bottom", APP + CSS)
        self.assertNotIn("workspace?.style.setProperty('--map-safe-bottom'", APP)
        self.assertNotIn("body.map-sheet-open #app[data-layout=\"mobile\"] .mode-action-bar", CSS)
        self.assertNotIn("body.map-sheet-open #app[data-layout=\"mobile\"] .mobile-zoom-dock", CSS)
        self.assertIn("const scaleContentHeight = isMobile()", APP)
        self.assertIn("Math.max(1, height - safe.top - 96)", APP)

    def test_mobile_sheet_is_edge_to_edge_with_fixed_header_and_scroll_body(self):
        self.assertIn("right: 0;", CSS)
        self.assertIn("left: 0;", CSS)
        self.assertGreaterEqual(CSS.count("bottom: var(--mobile-nav-height);"), 2)
        self.assertIn("border-radius: var(--ui-radius-sheet) var(--ui-radius-sheet) 0 0;", CSS)
        self.assertIn(".map-sheet-body-layers .layer-list", CSS)
        self.assertIn("overflow-y: auto;", CSS)
        self.assertIn("body.map-sheet-open #app[data-layout=\"mobile\"] .map-bottom-status", CSS)

    def test_drag_handle_has_no_general_button_chrome_and_supports_keyboard(self):
        self.assertIn(".map-sheet-header .sheet-drag-handle", CSS)
        self.assertIn("background: transparent !important;", CSS)
        self.assertIn("event.key === 'ArrowUp' || event.key === 'PageUp'", APP)
        self.assertIn("event.key === 'Escape'", APP)
        self.assertIn("velocity > 0.65", APP)

    def test_selection_updates_existing_editor_without_forcing_it_open(self):
        function = re.search(r"function openSelectionEditor\(\) \{([\s\S]+?)\n\s*\}", APP)
        self.assertIsNotNone(function)
        body = function.group(1)
        self.assertNotIn("classList.add('mobile-open')", body)
        self.assertNotIn("focus(", body)

    def test_version_is_updated(self):
        self.assertIn('data-app-version="0.30.0"', INDEX)
        self.assertIn("const APP_VERSION = '0.30.0'", APP)
        self.assertIn("app.css?v=0.30.0-r27", INDEX)


if __name__ == "__main__":
    unittest.main()
