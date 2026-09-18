import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * 首启空状态（#40）的源码层契约：面板由 App 在没有任何文档时挂载、占据画布区；
 * 入口全部是原生按钮（Tab 可达、Enter 激活）；最近项目复用 #38 的条目列表；
 * 引擎不可用时给出可展示信息与原地重试。
 */
test("the empty state panel replaces the canvas only while no document exists", async () => {
  const app = await readFile(join(desktopRoot, "src", "App.vue"), "utf8");
  const panel = await readFile(join(desktopRoot, "src", "components", "EmptyStatePanel.vue"), "utf8");

  // 有文档（哪怕新建的空文档）后画布接管，面板消失。
  assert.match(app, /<EmptyStatePanel\s+v-if="editorState === null"/);
  assert.match(app, /<CircuitCanvas\s+v-else/);
  // 引擎状态与可展示消息一起交给面板；事件全部接回工作区组合层。
  assert.match(app, /:engine-state="state\.engineState"/);
  assert.match(app, /:engine-message="state\.message"/);
  assert.match(app, /:recent-projects="recentProjects"/);
  assert.match(app, /@open-project="requestOpen"/);
  assert.match(app, /@new-document="requestNew"/);
  assert.match(app, /@load-example="requestLoadExample"/);
  assert.match(app, /@open-recent-project="requestOpenRecent"/);
  assert.match(app, /@check-engine="checkEngine"/);
  // 面板自身不带加载逻辑：它只是一个纯入口。
  assert.doesNotMatch(panel, /useWorkspace/);
});

test("every empty state entry is a native button and the recent list is reused", async () => {
  const panel = await readFile(join(desktopRoot, "src", "components", "EmptyStatePanel.vue"), "utf8");
  const list = await readFile(join(desktopRoot, "src", "components", "RecentProjectList.vue"), "utf8");

  // 三个主入口与引擎重试都是原生按钮：Tab 可达、Enter 激活，与 #38 的可达性标准一致。
  const buttons = [...panel.matchAll(/<button[^>]*type="button"[^>]*>([^<]*)</g)].map((match) => match[1]);
  for (const label of ["打开项目", "新建文档", "加载示例", "重新检查引擎"]) {
    assert.ok(buttons.some((text) => text.includes(label)), `缺少入口按钮：${label}`);
  }
  // 最近项目直接复用 #38 的条目列表（原生按钮语义），不另起一套渲染。
  assert.match(panel, /<RecentProjectList\s+:projects="recentProjects"/);
  assert.match(panel, /@open-project="emit\('openRecentProject', \$event\)"/);
  // 最近项目为空时不渲染该节，不出现空列表噪音。
  assert.match(panel, /v-if="recentProjects\.length > 0"/);
  // 面板有可寻址的标题：辅助技术能把它当作一个区域朗读。
  assert.match(panel, /aria-labelledby="empty-state-title"/);
  assert.match(panel, /id="empty-state-title"/);
});

test("an unavailable engine is announced inside the panel with an in-place retry", async () => {
  const panel = await readFile(join(desktopRoot, "src", "components", "EmptyStatePanel.vue"), "utf8");
  const styles = await readFile(join(desktopRoot, "src", "styles.css"), "utf8");

  // 非 ready 就展示引擎信息；不可用/失败用错误语义色加文字与边线，不只靠颜色。
  assert.match(panel, /v-if="engineState !== 'ready'"/);
  assert.match(panel, /empty-state__engine--problem/);
  assert.match(panel, /role="status"/);
  assert.match(panel, /重新检查引擎/);
  // 视觉走语义 Token，不发明新颜色。
  assert.match(styles, /\.empty-state__card \{[^}]*--color-border-strong/);
  assert.match(styles, /\.empty-state__card \{[^}]*--color-panel/);
  assert.match(styles, /\.empty-state__engine--problem \{[^}]*--color-status-error/);
});

test("the unsaved-changes dialog covers the load-example action", async () => {
  const dialog = await readFile(join(desktopRoot, "src", "components", "UnsavedChangesDialog.vue"), "utf8");

  assert.match(dialog, /action: "open" \| "new" \| "load-example"/);
  assert.match(dialog, /"load-example": \{ title: "加载示例\？"/);
  assert.match(dialog, /放弃改动并加载示例/);
});
