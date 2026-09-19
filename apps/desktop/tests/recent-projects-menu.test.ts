import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { moveRecentProjectsMenuFocus, resolveRecentProjectsMenuKeyAction } from "../src/components/recent-projects-menu.ts";

const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

test("arrow keys resolve to focus moves and escape closes, everything else stays native", () => {
  assert.equal(resolveRecentProjectsMenuKeyAction("ArrowDown"), "focus-next");
  assert.equal(resolveRecentProjectsMenuKeyAction("ArrowUp"), "focus-previous");
  assert.equal(resolveRecentProjectsMenuKeyAction("Escape"), "close");
  // Tab 与 Enter/Space 走条目原生按钮的语义，不在这里拦截。
  assert.equal(resolveRecentProjectsMenuKeyAction("Tab"), "none");
  assert.equal(resolveRecentProjectsMenuKeyAction("Enter"), "none");
  assert.equal(resolveRecentProjectsMenuKeyAction(" "), "none");
});

test("arrow focus moves inside the entry list and wraps around both ends", () => {
  assert.equal(moveRecentProjectsMenuFocus(0, 3, "focus-next"), 1);
  assert.equal(moveRecentProjectsMenuFocus(1, 3, "focus-next"), 2);
  assert.equal(moveRecentProjectsMenuFocus(2, 3, "focus-next"), 0, "最后一条向下绕回第一条");
  assert.equal(moveRecentProjectsMenuFocus(0, 3, "focus-previous"), 2, "第一条向上绕回最后一条");
  // 焦点不在列表内时从端点进入。
  assert.equal(moveRecentProjectsMenuFocus(-1, 3, "focus-next"), 0);
  assert.equal(moveRecentProjectsMenuFocus(-1, 3, "focus-previous"), 2);
  // 空列表没有可聚焦的条目。
  assert.equal(moveRecentProjectsMenuFocus(0, 0, "focus-next"), -1);
});

test("the topbar hosts the recent projects entry and forwards opens to the workspace", async () => {
  const topbar = await readFile(join(desktopRoot, "src", "components", "TopBar.vue"), "utf8");
  const app = await readFile(join(desktopRoot, "src", "App.vue"), "utf8");

  assert.match(topbar, /<RecentProjectsMenu\s+:projects="recentProjects"/);
  assert.match(topbar, /:disabled="!canSave"/, "入口与其它顶栏按钮共用编辑器就绪前提");
  assert.match(topbar, /@open-project="emit\('openRecentProject', \$event\)"/);
  assert.match(app, /recentProjects,\s*\n\s*requestOpenRecent,/);
  assert.match(app, /:recent-projects="recentProjects"/);
  assert.match(app, /@open-recent-project="requestOpenRecent"/);
});

test("the recent projects menu keeps its entries keyboard reachable and hides when empty", async () => {
  const menu = await readFile(join(desktopRoot, "src", "components", "RecentProjectsMenu.vue"), "utf8");
  const list = await readFile(join(desktopRoot, "src", "components", "RecentProjectList.vue"), "utf8");
  const styles = await readFile(join(desktopRoot, "src", "styles.css"), "utf8");

  // 空列表不渲染入口，不出现空菜单噪音。
  assert.match(menu, /v-if="projects\.length > 0"/);
  // 触发按钮声明菜单语义与展开状态。
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /:aria-expanded="isOpen"/);
  assert.match(menu, /role="menu"/);
  // 方向键导航与 Esc 关闭走共享的键盘语义模块。
  assert.match(menu, /resolveRecentProjectsMenuKeyAction/);
  assert.match(menu, /moveRecentProjectsMenuFocus/);
  assert.match(menu, /event\.stopPropagation\(\)/, "菜单内的 Esc 不冒泡给窗口级处理器");
  // 条目是原生按钮：Tab 可达、Enter 激活；点击把条目路径交给宿主，显示名与路径提示并列。
  assert.match(list, /type="button"/);
  assert.match(list, /:role="itemRole"/);
  assert.match(list, /@click="emit\('openProject', project\.path\)"/);
  assert.match(list, /class="recent-projects-name"/);
  assert.match(list, /class="recent-projects-path"/);
  assert.match(menu, /@open-project="chooseProject"/);
  // 下拉面板沿用语义 Token，不发明新视觉。
  assert.match(styles, /\.recent-projects-menu \{[^}]*--color-border-strong/);
  assert.match(styles, /\.recent-projects-menu \{[^}]*--color-panel/);
});
