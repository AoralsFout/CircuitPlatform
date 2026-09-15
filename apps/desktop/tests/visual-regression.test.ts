import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** 真实 Vue/CircuitCanvas 截图脚本覆盖完整状态矩阵，避免回归漏掉关键交互状态。 */
test("visual fixture covers the required state matrix and reduced motion mode", async () => {
  const fixture = await readFile(join(desktopRoot, "visual-regression.html"), "utf8");
  const script = await readFile(join(desktopRoot, "scripts", "visual-regression.mjs"), "utf8");
  const styles = await readFile(join(desktopRoot, "src", "styles.css"), "utf8");
  for (const state of ["default", "empty", "selected-component", "selected-wire", "draft", "dangling", "pending", "error"]) {
    assert.match(script, new RegExp(state.replace("-", "\\-")));
  }
  assert.match(script, /regular: \{ width: 1440, height: 900 \}/);
  assert.match(script, /narrow: \{ width: 720, height: 560 \}/);
  assert.match(fixture, /data-motion="reduced"/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /animation: none !important/);
  assert.match(styles, /transition: none !important/);
  assert.match(fixture, /import\("\/src\/main\.ts"\)/);
  assert.doesNotMatch(fixture, /fixture-node|style="left:|<path[^>]+ d="/);
});

/** 语义 class 是截图和实际画布共用的视觉契约，不能只在夹具中伪造。 */
test("canvas exposes non-color state hooks for ports and wires", async () => {
  const canvas = await readFile(join(desktopRoot, "src", "components", "CircuitCanvas.vue"), "utf8");
  assert.match(canvas, /data-signal/);
  assert.match(canvas, /data-dangling/);
  assert.match(canvas, /node-port--dangling/);
  assert.match(canvas, /signal-wire--draft/);
  assert.match(canvas, /正在放置/);
  assert.match(canvas, /放置失败/);
  assert.match(canvas, />重试</);
  assert.match(canvas, />取消</);
});
