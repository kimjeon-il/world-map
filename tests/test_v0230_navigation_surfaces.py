from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")
SURFACE = (ROOT / "assets/js/modules/surface-controller.js").read_text(encoding="utf-8")


class V0230NavigationSurfaceTests(unittest.TestCase):
    def test_primary_navigation_is_layer_add_edit_in_every_layout(self):
        nav = re.search(r'<nav class="adaptive-nav.*?</nav>', INDEX, re.S).group(0)
        self.assertLess(nav.index('<strong>레이어</strong>'), nav.index('<strong>추가</strong>'))
        self.assertLess(nav.index('<strong>추가</strong>'), nav.index('<strong>편집</strong>'))
        self.assertNotIn('<strong>지도</strong>', nav)
        self.assertIn('<strong id="mapSheetTitle">레이어</strong>', INDEX)

    def test_editor_trigger_is_outside_the_view_toolbar(self):
        view_toolbar = re.search(r'<div class="map-view-toolbar.*?</div>\s*\n\s*<div class="editor-edge-slot"', INDEX, re.S)
        self.assertIsNotNone(view_toolbar)
        toolbar_only = view_toolbar.group(0).split('<div class="editor-edge-slot"', 1)[0]
        self.assertNotIn('togglePanelBtn', toolbar_only)
        self.assertEqual(INDEX.count('id="togglePanelBtn"'), 1)

    def test_common_surface_state_and_manual_editor_collapse_exist(self):
        for token in ('activeSurface', 'layersOpen', 'editorOpen', 'editorManuallyCollapsed'):
            self.assertIn(token, SURFACE)
        for function in ('openSurface', 'closeSurface', 'toggleSurface'):
            self.assertIn(f'function {function}(', APP)
        self.assertIn("openSurface('editor', { automatic: true })", APP)

    def test_compact_surfaces_share_one_exclusive_activation_rule(self):
        compact = SURFACE[SURFACE.index("} else if (layout === 'compact')") : SURFACE.index("} else {", SURFACE.index("} else if (layout === 'compact')"))]
        self.assertIn("state.activeSurface = surface", compact)
        self.assertIn("state.layersOpen = surface === 'layers'", compact)
        self.assertIn("state.editorOpen = surface === 'editor'", compact)
        self.assertNotIn('updateSurfaceStateFromDom', APP + SURFACE)

    def test_sheet_headers_and_row_buttons_use_shared_component_rules(self):
        row_button = re.search(r'\.ui-row-button \{([^}]+)\}', CSS)
        self.assertIsNotNone(row_button)
        self.assertIn('width: 100%', row_button.group(1))
        self.assertIn('box-sizing: border-box', row_button.group(1))
        compact_header = re.search(
            r'#app\[data-layout="compact"\] \.map-sheet-header \{([^}]+)\}',
            CSS,
        )
        self.assertIsNotNone(compact_header)
        self.assertIn('height: 74px', compact_header.group(1))
        self.assertIn('padding: 16px', compact_header.group(1))

    def test_transient_panels_do_not_change_projection_safe_insets(self):
        self.assertIn('--projection-safe-left', CSS)
        self.assertIn("read('--projection-safe-left')", APP)
        self.assertIn('#app[data-layout="wide"] .workspace.editor-drawer-open { --map-safe-right: 0px; }', CSS)
        compact = re.search(r'#app\[data-layout="compact"\] \.workspace\.layers-drawer-open,.*?\}', CSS, re.S).group(0)
        self.assertIn('--map-safe-left: 0px', compact)
        self.assertNotIn('--compact-rail-width', CSS)
        self.assertNotIn('queueMapResize();', APP[APP.index('function toggleEditorPanel'):APP.index('function syncMobileNavigation')])

    def test_wide_editor_trigger_is_a_persistent_drawer_edge_handle(self):
        self.assertIn('top: 50%', CSS[CSS.index('.editor-edge-slot {'):CSS.index('.editor-edge-trigger {')])
        open_rule = re.search(r'#app\[data-layout="wide"\] \.workspace\.editor-drawer-open \.editor-edge-slot \{([^}]+)\}', CSS)
        self.assertIsNotNone(open_rule)
        self.assertIn('right: calc(var(--panel-right-width) + 12px)', open_rule.group(1))
        self.assertIn("surfaceState.editorOpen ? '편집창 닫기' : '편집창 열기'", APP)

    def test_layer_search_accordion_and_virtual_list_are_present(self):
        self.assertIn('id="layerSearchResults"', INDEX)
        self.assertIn('LAYER_VIRTUAL_ROW_HEIGHT', APP)
        self.assertIn('renderVirtualizedLayerGroup', APP)
        self.assertIn('const folderKeys = activeLayerFolderKeys();', APP)
        self.assertIn('if (!key.startsWith(COUNTRY_REGION_FOLDER_STATE_PREFIX)) state.layerFolders[key] = false;', APP)
        self.assertIn('searchText: id', APP)

    def test_build_version_is_v0230(self):
        self.assertIn('data-app-version="0.29.0"', INDEX)
        self.assertIn("const APP_VERSION = '0.29.0'", APP)


if __name__ == '__main__':
    unittest.main()
