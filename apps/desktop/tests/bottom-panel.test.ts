import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** 底部栏必须保留标签入口，并把展开状态交给父布局调整画布可用空间。 */
test("bottom panel exposes an accessible expand and collapse control", async () => {
  const panel = await readFile(join(desktopRoot, "src", "components", "BottomPanel.vue"), "utf8");
  const app = await readFile(join(desktopRoot, "src", "App.vue"), "utf8");
  const styles = await readFile(join(desktopRoot, "src", "styles.css"), "utf8");

  assert.match(panel, /isExpanded: boolean/);
  assert.match(panel, /togglePanel: \[\]/);
  assert.match(panel, /aria-expanded="isExpanded"/);
  assert.match(panel, /isExpanded \? '收起仿真结果面板' : '展开仿真结果面板'/);
  assert.match(panel, /v-if="isExpanded && bottomTab === 'inspector'"/);
  assert.match(app, /const isBottomPanelExpanded = ref\(true\)/);
  assert.match(app, /editor-main--bottom-panel-collapsed/);
  assert.match(app, /@toggle-panel="toggleBottomPanel"/);
  assert.match(styles, /\.editor-main\.editor-main--bottom-panel-collapsed[^}]*35px/);
});
