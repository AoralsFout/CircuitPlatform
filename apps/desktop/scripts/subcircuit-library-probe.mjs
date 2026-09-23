import assert from "node:assert/strict";
import { app, BrowserWindow, dialog } from "electron";
import { createServer } from "vite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engineName = process.platform === "win32" ? "circuit-engine.exe" : "circuit-engine";
const enginePath = process.env.CIRCUIT_ENGINE_PATH ?? resolve(desktopRoot, "../../engine/build", engineName);
const longName = "A very long arithmetic and logic unit source file.circuit.json";
const renamedName = "Renamed arithmetic unit.circuit.json";

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");

/** 同一份 v2 文件驱动定义树、同名编号和画布标题，避免探针手写 DOM 状态。 */
function fixture() {
  const empty = { components: [], connections: [] };
  return {
    version: 2,
    circuit: {
      components: [{
        id: "placed-second", kind: "subcircuit", displayName: longName,
        position: { x: 260, y: 180 }, data: { definitionId: "second", cachedPorts: [] },
      }],
      connections: [],
    },
    definitions: {
      first: { displayName: longName, circuit: {
        components: [{
          id: "nested-use", kind: "subcircuit", displayName: "Register.circuit.json",
          position: { x: 40, y: 40 }, data: { definitionId: "leaf", cachedPorts: [] },
        }], connections: [],
      } },
      second: { displayName: longName, circuit: empty },
      leaf: { displayName: "Register.circuit.json", circuit: empty },
    },
    libraryRoots: ["first", "second"],
  };
}

/** 在渲染进程等待 Vue 更新和引擎异步接纳；超时时附带页面文本以便定位。 */
async function waitFor(window, expression, label, timeoutMs = 20_000) {
  await window.webContents.executeJavaScript(`new Promise((resolvePromise, reject) => {
    const started = Date.now();
    const check = () => {
      if (${expression}) return resolvePromise(true);
      if (Date.now() - started > ${timeoutMs}) return reject(new Error(${JSON.stringify(label)} + ': ' + document.body.innerText.slice(0, 1000)));
      setTimeout(check, 30);
    };
    check();
  })`);
}

/** 只收集渲染后的 DOM 事实，不读取 Vue 内部状态。 */
async function facts(window) {
  return window.webContents.executeJavaScript(`(() => {
    const rows = [...document.querySelectorAll('.subcircuit-tree > li')].map((li) => {
      const button = li.querySelector('.subcircuit-tree-node');
      return {
        text: button?.querySelector('.subcircuit-name')?.textContent?.trim(),
        title: button?.title,
        label: button?.getAttribute('aria-label'),
        pressed: button?.getAttribute('aria-pressed'),
        depth: li.style.getPropertyValue('--tree-depth').trim(),
        count: button?.querySelector('.subcircuit-use-count')?.textContent?.trim(),
      };
    });
    const detail = document.querySelector('.subcircuit-detail');
    const canvasNode = document.querySelector('.circuit-node[data-subcircuit-status]');
    const longNameNode = document.querySelector('.subcircuit-tree .subcircuit-name');
    const longNameStyle = longNameNode ? getComputedStyle(longNameNode) : null;
    return {
      sidebar: document.querySelector('.sidebar')?.getAttribute('aria-label'),
      active: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim(),
      rows,
      longNameLayout: longNameNode ? {
        clipped: longNameNode.scrollWidth > longNameNode.clientWidth,
        overflow: longNameStyle.overflow,
        textOverflow: longNameStyle.textOverflow,
        whiteSpace: longNameStyle.whiteSpace,
      } : null,
      detailName: detail?.querySelector('strong')?.textContent?.trim() ?? null,
      detailTitle: detail?.querySelector('strong')?.title ?? null,
      renameLabel: detail?.querySelector('label[for="subcircuit-rename-input"]')?.textContent?.trim() ?? null,
      inputValue: detail?.querySelector('#subcircuit-rename-input')?.value ?? null,
      canvasTitle: canvasNode?.querySelector('strong')?.textContent?.trim() ?? null,
      canvasLabel: canvasNode?.getAttribute('aria-label') ?? null,
      alerts: [...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent.trim()),
    };
  })()`);
}

/** 经 Electron 输入管线发送真实按键，以覆盖原生按钮激活和 Tab 焦点顺序。 */
function key(window, keyCode, modifiers = []) {
  window.focus();
  window.webContents.focus();
  window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}

async function main() {
  if (!existsSync(enginePath)) throw new Error(`缺少真实 C++ 引擎：${enginePath}`);
  const directory = await mkdtemp(join(tmpdir(), "circuitplatform-library-probe-"));
  const projectPath = join(directory, "library-probe.circuit.json");
  const exportPath = join(directory, "exported.circuit.json");
  const parentContent = `${JSON.stringify(fixture())}\n`;
  writeFileSync(projectPath, parentContent, "utf8");
  const vite = await createServer({ root: desktopRoot, server: { host: "127.0.0.1", port: 0, hmr: false } });
  const originalOpenDialog = dialog.showOpenDialog;
  const originalSaveDialog = dialog.showSaveDialog;
  let window;
  let failure = null;
  try {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [projectPath] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
    await vite.listen();
    const serverAddress = vite.httpServer?.address();
    if (!serverAddress || typeof serverAddress === "string") throw new Error("Vite 未提供监听端口");
    process.env.CIRCUIT_ENGINE_PATH = enginePath;
    process.env.CIRCUIT_PLATFORM_E2E_URL = `http://127.0.0.1:${serverAddress.port}`;
    await import("../electron/main.cjs");
    await app.whenReady();
    await new Promise((resolvePromise, reject) => {
      const started = Date.now();
      const check = () => {
        window = BrowserWindow.getAllWindows()[0];
        if (window) return resolvePromise();
        if (Date.now() - started > 15_000) return reject(new Error("真实 Electron 窗口未启动"));
        setTimeout(check, 25);
      };
      check();
    });
    window.show();
    window.focus();
    window.webContents.focus();
    window.webContents.on("console-message", (_event, level, message) => console.error(`[library console ${level}] ${message}`));
    await waitFor(window, "document.querySelector('.empty-state .dialog-button')", "空状态打开入口未就绪");
    await window.webContents.executeJavaScript("document.querySelector('.empty-state .dialog-button').click()");
    await waitFor(window, "document.querySelector('.circuit-node[data-subcircuit-status]')", "Project 未在画布显示");

    await window.webContents.executeJavaScript("document.querySelector('.rail-button[aria-label=\"子电路\"]').focus()");
    key(window, " ");
    await waitFor(window, "document.querySelector('.sidebar[aria-label=\"子电路\"] .subcircuit-tree-node')", "键盘未打开子电路栏", 5_000);
    const initial = await facts(window);
    assert.equal(initial.sidebar, "子电路");
    assert.deepEqual(initial.rows.map((row) => [row.text, row.depth, row.count]), [
      [longName, "0", "0"], ["Register.circuit.json", "1", "1"], [`${longName} (2)`, "0", "1"],
    ]);
    assert.equal(initial.rows[0].title, longName, "长名称应可从 title 完整读取");
    assert.deepEqual(initial.longNameLayout, { clipped: true, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
    assert.match(initial.rows[2].label, /使用 1 次，可用/);
    const expectedCanvasTitle = "A very long arithmetic and logic unit source file (2)";
    assert.doesNotMatch(initial.canvasTitle, /\.circuit\.json/);

    // 从树前的原生按钮出发，使用真实 Tab 进入定义树。
    await window.webContents.executeJavaScript("document.querySelector('.subcircuit-actions > button').focus()");
    key(window, "Tab");
    await waitFor(window, "document.activeElement?.classList.contains('subcircuit-tree-node')", "Tab 未进入定义树", 5_000);
    const firstFocus = await facts(window);
    assert.match(firstFocus.active, new RegExp(`^选择子电路 ${longName.replaceAll(".", "\\.")}`));
    key(window, "Tab");
    key(window, "Tab");
    key(window, " ");
    await waitFor(window, "document.querySelector('.subcircuit-detail strong')?.textContent?.trim().endsWith('(2)')", "Enter 未选中同名定义");
    const selected = await facts(window);
    assert.equal(selected.rows[2].pressed, "true");
    assert.equal(selected.detailName, `${longName} (2)`);
    assert.equal(selected.detailTitle, `${longName} (2)`);

    // 继续用焦点和 Space 操作详情按钮，再以 Tab 进入改名表单。
    await window.webContents.executeJavaScript("(() => { const button = document.querySelector('.subcircuit-detail button[aria-label^=\"改名 \"]'); if (!button) throw new Error('改名按钮缺失：' + document.querySelector('.subcircuit-detail')?.outerHTML); button.focus(); })()");
    key(window, " ");
    await waitFor(window, "document.querySelector('#subcircuit-rename-input')", "改名表单未出现");
    const renaming = await facts(window);
    assert.equal(renaming.renameLabel, "子电路名称");
    assert.equal(renaming.inputValue, longName, "改名时应编辑原始名称，不含编号");
    key(window, "Tab");
    key(window, "Tab");
    await waitFor(window, "document.activeElement?.id === 'subcircuit-rename-input'", "Tab 未进入改名输入框", 5_000);
    assert.equal(await window.webContents.executeJavaScript("document.activeElement?.id"), "subcircuit-rename-input", "Tab 应进入改名输入框");
    await window.webContents.executeJavaScript("document.querySelector('#subcircuit-rename-input').select()");
    window.webContents.insertText(renamedName);
    await waitFor(window, `document.querySelector('#subcircuit-rename-input')?.value === ${JSON.stringify(renamedName)}`, "键盘输入未更新名称");
    key(window, "Tab");
    await waitFor(window, "document.activeElement?.textContent?.trim() === '保存名称'", "Tab 未进入保存名称按钮", 5_000);
    assert.equal(await window.webContents.executeJavaScript("document.activeElement?.textContent?.trim()"), "保存名称", "Tab 应进入保存按钮");
    key(window, " ");
    await waitFor(window, `document.querySelectorAll('.subcircuit-tree-node')[2]?.querySelector('.subcircuit-name')?.textContent?.trim() === ${JSON.stringify(renamedName)}`, "改名未更新树");
    const renamed = await facts(window);
    assert.deepEqual(renamed.rows.map((row) => row.text), [longName, "Register.circuit.json", renamedName]);
    assert.equal(renamed.canvasTitle, "Renamed arithmetic unit");
    assert.equal(renamed.detailName, renamedName);
    assert.deepEqual(renamed.alerts, []);
    await window.webContents.executeJavaScript("(() => { const button = document.querySelector('.subcircuit-detail button[aria-label^=\"导出 \"]'); if (!button) throw new Error('导出按钮缺失：' + document.querySelector('.subcircuit-detail')?.outerHTML); button.focus(); })()");
    key(window, " ");
    await waitFor(window, "document.querySelector('.subcircuit-export-feedback[role=\"status\"]')?.textContent?.includes('已导出到')", "键盘导出未完成");
    assert.equal(existsSync(exportPath), true, "导出文件必须经正式 IPC 文件桥接写盘");
    const exported = JSON.parse(readFileSync(exportPath, "utf8"));
    assert.equal(exported.version, 2);
    assert.deepEqual(exported.circuit, fixture().definitions.second.circuit);
    assert.deepEqual(exported.definitions, {});
    assert.equal(readFileSync(projectPath, "utf8"), parentContent, "导出不能改动父 Project 文件");
    assert.equal(initial.canvasTitle, expectedCanvasTitle, `两个同名定义中 second 的画布标题应保留编号；文件名分别为 ${longName}、${longName}`);
    assert.match(initial.canvasLabel, /A very long arithmetic and logic unit source file \(2\)/, "画布无障碍名称也应保留编号");
    console.log("Subcircuit library DOM, keyboard, and export probe passed", JSON.stringify({ treeNodes: initial.rows.length, nestedDepth: initial.rows[1].depth, exportedVersion: exported.version }));
  } catch (error) {
    failure = error;
    console.error(error);
  } finally {
    dialog.showOpenDialog = originalOpenDialog;
    dialog.showSaveDialog = originalSaveDialog;
    app.removeAllListeners("window-all-closed");
    if (window && !window.isDestroyed()) window.close();
    await vite.close();
    await rm(directory, { recursive: true, force: true });
    if (app.isReady()) app.exit(failure ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
