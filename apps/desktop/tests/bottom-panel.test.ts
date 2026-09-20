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
  assert.match(panel, /reloadSubcircuit: \[componentId: string\]/);
  assert.match(panel, /重新加载子电路/);
  assert.match(panel, /emit\('reloadSubcircuit', inspector\.id\)/);
  assert.match(app, /const isBottomPanelExpanded = ref\(true\)/);
  assert.match(app, /editor-main--bottom-panel-collapsed/);
  assert.match(app, /@toggle-panel="toggleBottomPanel"/);
  assert.match(styles, /\.editor-main\.editor-main--bottom-panel-collapsed[^}]*35px/);
});

test("App forwards hierarchy intents through the workspace actions", async () => {
  const app = await readFile(join(desktopRoot, "src", "App.vue"), "utf8");
  assert.match(app, /addSubcircuitFromDialog,/);
  assert.match(app, /reloadSubcircuit,/);
  assert.match(app, /@select-subcircuit="addSubcircuitFromDialog"/);
  assert.match(app, /selectSubcircuit: addSubcircuitFromDialog/);
  assert.match(app, /@reload-subcircuit="reloadSubcircuit"/);
});

/**
 * 波形网格的几何契约：列宽固定、网格横向滚动、面板不许被内容撑出布局。
 *
 * 列宽一旦随内容走（min-content），多位二进制读数会把一列的最小宽度撑到远超面板；而
 * `.bottom-panel` 作为 `editor-main` 的网格项若没有 `min-width: 0`，这个最小宽度会沿
 * 网格轨道把 editor-main 一并撑出窗口——修复必须同时钉住这两端。
 */
test("waveform grid scrolls horizontally with fixed cells instead of stretching the layout", async () => {
  const panel = await readFile(join(desktopRoot, "src", "components", "BottomPanel.vue"), "utf8");
  const styles = await readFile(join(desktopRoot, "src", "styles.css"), "utf8");

  // 列宽固定，不随读数内容伸缩。
  assert.match(styles, /repeat\(var\(--waveform-steps, 1\), var\(--waveform-cell-width, 48px\)\)/);
  assert.doesNotMatch(styles, /waveform-row[^}]*min-content/);
  // 网格自身横向滚动：更宽的历史进滚动条，不进布局。
  assert.match(styles, /\.waveform-grid \{[^}]*overflow-x: auto/);
  // 超出单元宽度的读数截断为省略号，完整值由单元的 title 悬停给出。
  assert.match(styles, /\.waveform-cell \{[^}]*text-overflow: ellipsis/);
  assert.match(panel, /:title="waveformValue\(point, row\.key\)"/);
  // 面板是 editor-main 的网格项：min-width: 0 是「内容不再撑开布局」的硬保证。
  assert.match(styles, /\.bottom-panel \{[^}]*min-width: 0/);
});
