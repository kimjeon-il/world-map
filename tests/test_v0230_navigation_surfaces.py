from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
LAYER_MODEL = (ROOT / "assets/js/modules/layer-list-model.js").read_text(encoding="utf-8")
LAYER_CONTROLLER = (ROOT / "assets/js/modules/layer-tree-controller.js").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")
SURFACE = (ROOT / "assets/js/modules/surface-controller.js").read_text(encoding="utf-8")
SURFACE_TABS = (ROOT / "assets/js/modules/surface-tabs-controller.js").read_text(encoding="utf-8")


class V0230NavigationSurfaceTests(unittest.TestCase):
    def test_primary_navigation_is_map_add_edit_in_every_layout(self):
        nav = re.search(r'<nav class="[^"]*adaptive-nav[^"]*".*?</nav>', INDEX, re.S).group(0)
        self.assertLess(nav.index('<strong>지도</strong>'), nav.index('<strong>추가</strong>'))
        self.assertLess(nav.index('<strong>추가</strong>'), nav.index('<strong>편집</strong>'))
        self.assertNotIn('<strong>레이어</strong>', nav)
        self.assertIn('<strong id="mapSheetTitle">지도</strong>', INDEX)
        self.assertIn('id="mapLayersTabBtn"', INDEX)
        self.assertIn('id="mapViewTabBtn"', INDEX)

    def test_obsolete_editor_edge_trigger_is_removed(self):
        self.assertNotIn('editor-edge-slot', INDEX + CSS)
        self.assertNotIn('togglePanelBtn', INDEX + CSS)

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
        self.assertIn('.ui-row-button { width: 100%; box-sizing: border-box; }', CSS)
        compact_header = re.search(
            r'#app\[data-layout="compact"\] \.surface-header \{([^}]+)\}',
            CSS,
        )
        self.assertIsNotNone(compact_header)
        self.assertIn('height: var(--ui-surface-header-height-compact)', compact_header.group(1))
        self.assertIn('padding-block: var(--ui-panel-padding)', compact_header.group(1))

    def test_transient_panels_preserve_projection_but_update_control_safe_insets(self):
        self.assertIn('--projection-safe-left', CSS)
        self.assertIn("read('--projection-safe-left')", APP)
        self.assertIn('#app[data-layout="wide"] .workspace.editor-drawer-open { --map-safe-right: calc(var(--panel-right-width) + var(--ui-map-edge)); }', CSS)
        drawer_rule = re.search(r'#app\[data-layout="wide"\] \.workspace\.editor-drawer-open \{([^}]+)\}', CSS).group(1)
        self.assertNotIn('--projection-safe-right', drawer_rule)
        self.assertIn('function currentObjectFitInsets()', APP)
        compact = re.search(r'#app\[data-layout="compact"\] \.workspace\.layers-drawer-open,.*?\}', CSS, re.S).group(0)
        self.assertIn('--map-safe-left: 0px', compact)
        self.assertNotIn('--compact-rail-width', CSS)
        self.assertNotIn('queueMapResize();', APP[APP.index('function toggleEditorPanel'):APP.index('function syncMobileNavigation')])

    def test_layer_search_accordion_and_virtual_list_are_present(self):
        self.assertIn('id="layerSearchResults"', INDEX)
        self.assertIn('const virtual = rows.length > 80', LAYER_CONTROLLER)
        self.assertIn('visibleLayerRows(presentation, snapshot.folders, search)', LAYER_CONTROLLER)
        self.assertNotIn("HYDRO_FOLDER_STATE_PREFIX", APP)
        self.assertNotIn('TERRITORIAL_UNIT_FOLDER_STATE_PREFIX', APP)
        self.assertIn("return ['countries', 'rivers', 'lakes'];", APP)
        self.assertIn('searchText: id', APP)

    def test_sheet_content_owns_vertical_scrolling(self):
        self.assertNotIn('activeSheetTouch', APP)
        self.assertNotIn('sheetScrollableAncestor', APP)
        self.assertNotIn("body.addEventListener('touchmove'", APP)
        for selector in (
            '.layer-list',
            '.editor-scroll-body',
            '.map-view-panel-section',
            '.layer-search-results',
        ):
            rules = re.findall(rf'(?m)^{re.escape(selector)}\s*\{{([^}}]+)\}}', CSS)
            self.assertTrue(rules, selector)
            self.assertTrue(any('overflow-y: auto' in rule and 'touch-action: pan-y' in rule for rule in rules), selector)
        children = re.search(r'\.layer-children\s*\{([^}]+)\}', CSS)
        self.assertIsNotNone(children)
        self.assertIn('overscroll-behavior-y: auto', children.group(1))
        self.assertIn('touch-action: pan-y', children.group(1))

    def test_sheet_chrome_uses_one_visual_content_rail(self):
        for token in (
            '--ui-surface-content-padding-x: var(--ui-panel-padding);',
            '--ui-surface-content-rail-x: var(--ui-surface-content-padding-x);',
        ):
            self.assertIn(token, CSS)
        self.assertIn('class="ui-tabs surface-tabs map-panel-tabs"', INDEX)
        self.assertIn('class="ui-tabs surface-tabs editor-view-tabs hidden"', INDEX)
        self.assertIn('.surface-tabs {', CSS)

    def test_all_primary_panels_use_the_same_surface_structure(self):
        roots = {
            "leftPanel": ("surface-map", "</aside>"),
            "createMenu": ("surface-create", "</section>"),
            "rightPanel": ("surface-editor", "</aside>"),
        }
        for element_id, (variant, closing_tag) in roots.items():
            start = INDEX.index(f'id="{element_id}"')
            markup = INDEX[start:INDEX.index(closing_tag, start)]
            self.assertIn('workspace-surface', markup)
            self.assertIn(variant, markup)
            self.assertLess(markup.index('surface-header'), markup.index('surface-tabs'))
            self.assertLess(markup.index('surface-tabs'), markup.index('surface-body'))
            self.assertLess(markup.index('surface-body'), markup.index('surface-content'))
        for legacy in (
            'map-sheet-header', 'layer-panel-header', 'create-sheet-header',
            'editor-shell-header', 'create-sheet-body', 'map-sheet-body-layers',
        ):
            self.assertNotIn(legacy, INDEX + CSS)

    def test_surface_tabs_share_one_roving_tab_controller(self):
        self.assertEqual(INDEX.count('data-surface-tab='), 6)
        self.assertEqual(APP.count('createSurfaceTabsController({'), 3)
        for key in ('ArrowLeft', 'ArrowRight', 'Home', 'End'):
            self.assertIn(key, SURFACE_TABS)
        self.assertIn("tab.setAttribute('aria-selected', String(active))", SURFACE_TABS)
        self.assertIn('tab.tabIndex = active ? 0 : -1', SURFACE_TABS)

    def test_generic_features_are_direct_object_rows(self):
        self.assertNotIn('class="layer-folder"', INDEX)
        self.assertIn("if (group === 'genericFeatures')", APP)
        self.assertIn('else objects.push(item)', LAYER_MODEL)
        self.assertNotIn('data-map-object-type="generic"', INDEX)

    def test_build_version_is_v0230(self):
        self.assertIn('data-app-version="0.30.0"', INDEX)
        self.assertIn("const APP_VERSION = '0.30.0'", APP)


if __name__ == '__main__':
    unittest.main()
