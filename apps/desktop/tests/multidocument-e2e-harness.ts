import { useDocumentWorkspace } from "../src/composables/useDocumentWorkspace.ts";
import {
  incompatibleMultiDocumentChildProject,
  multiDocumentChildProject,
  multiDocumentParentProject,
  multiDocumentPeerProject,
} from "./fixtures/multi-document-fixtures.ts";

type HarnessResult = {
  tabs: number;
  parentStep: number;
  peerStep: number;
  childKey: string;
  staleOccurrences: number;
  danglingConnectionIds: string[];
  recoveredParent: boolean;
};

const params = new URLSearchParams(location.search);
const directory = params.get("directory");
if (directory === null) throw new Error("缺少真实 E2E fixture 目录");

const parentPath = `${directory}/parent.circuit.json`;
const childPath = `${directory}/child.circuit.json`;
const peerPath = `${directory}/peer.circuit.json`;
const bridge = (window as unknown as { circuitPlatform: any }).circuitPlatform;
const workspace = useDocumentWorkspace();

function current<T>(ref: { value: T }): T {
  return ref.value;
}

function fail(message: string): never {
  throw new Error(message);
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

async function waitFor(condition: () => unknown, message: string, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) fail(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function writeFixture(path: string, value: unknown): Promise<void> {
  const result = await bridge.writeProjectFile(path, `${JSON.stringify(value)}\n`);
  ensure(result.ok, `真实项目文件写入失败：${path}：${result.reason ?? "unknown"}`);
}

async function run(): Promise<HarnessResult> {
  await writeFixture(parentPath, multiDocumentParentProject());
  await writeFixture(childPath, multiDocumentChildProject());
  await writeFixture(peerPath, multiDocumentPeerProject());

  // 两份真实 Project 通过 production preload 的路径入口打开；它们故意含有同名/同 ID 元件。
  await workspace.requestOpenRecent(parentPath);
  await waitFor(() => current(workspace.tabs).length === 1 && current(workspace.state).engineState === "ready", "父 Project 未能通过 Electron IPC 打开");
  const parentKey = current(workspace.tabs)[0]!.key;
  const parentBaseline = JSON.stringify(current(workspace.state).signals);
  await workspace.requestOpenRecent(peerPath);
  await waitFor(() => current(workspace.tabs).length === 2 && current(workspace.activeDocumentKey) !== parentKey, "Peer Project 未能打开为第二份文档");
  const peerKey = current(workspace.activeDocumentKey)!;
  ensure(peerKey !== parentKey, "同一个运行时键不能承载 parent 与 peer");
  ensure(current(workspace.editorState)!.document.components.some((component) => component.id === "clock"), "peer 的 clock ID 未加载");

  // parent 的 u1/u2 各推进一次；peer 独立推进一次，随后切换回 parent 检查其时间线没有被污染。
  await workspace.activateTab(parentKey);
  await workspace.step();
  await workspace.setInputBit("data-1", 0, "1");
  await workspace.setInputBit("clock-1", 0, "1");
  await workspace.step();
  ensure(current(workspace.state).signals["u1:q"] === "1", "parent occurrence 1 的 DFF 没有采样");
  ensure(current(workspace.state).signals["u2:q"] === "X", "未触发的 parent occurrence 2 不应共享 DFF 状态");
  const parentStep = current(workspace.state).simulationStep;
  const parentWaveformLength = current(workspace.state).waveform.length;
  await workspace.activateTab(peerKey);
  await workspace.step();
  const peerStep = current(workspace.state).simulationStep;
  ensure(peerStep === 1, `peer 应独立推进到第 1 步，实际 ${peerStep}`);
  ensure(current(workspace.state).signals["flop:q"] === "1", "peer 的 DFF 未按真实 Clock 更新");
  await workspace.activateTab(parentKey);
  ensure(current(workspace.state).simulationStep === parentStep, "切换回 parent 时步数被 peer 污染");
  ensure(current(workspace.state).waveform.length === parentWaveformLength, "非活动 peer 推进不应修改 parent waveform");
  ensure(JSON.stringify(current(workspace.state).signals) !== parentBaseline, "parent 的真实信号没有发生推进");

  // 选择 occurrence 后读取稳定扁平内部信号；两个 occurrence 的 flat ID 与读数必须分别存在。
  await workspace.select({ kind: "component", id: "u1" });
  workspace.setInternalSignalTableVisible(true);
  await waitFor(() => {
    const state = current(workspace.state);
    return Object.keys(state.internalSignals ?? {}).some((key) => key.startsWith("u1/ff:")) &&
      Object.keys(state.internalSignals ?? {}).some((key) => key.startsWith("u2/ff:"));
  }, "内部信号表未通过按需读取拿到两个 occurrence 的扁平行");
  const internalSignals = current(workspace.state).internalSignals ?? {};
  ensure(internalSignals["u1/ff:q"] === "1", "occurrence 1 内部 q 不正确");
  ensure(internalSignals["u2/ff:q"] === "X", "occurrence 2 内部 q 不正确");
  workspace.setInternalSignalTableVisible(false);

  // 下钻第一次创建 child tab；第二次只复用该 tab 并更新来源，返回时重新选择稳定 source ID。
  ensure(await workspace.openSubcircuit("u1"), "下钻 occurrence 1 失败");
  await waitFor(() => current(workspace.tabs).length === 3, "下钻没有创建 child 标签");
  const childKey = current(workspace.activeDocumentKey)!;
  ensure(current(workspace.editorState)!.document.components.some((component) => component.id === "ff"), "child 文档未显示内部 DFF");
  await workspace.activateTab(parentKey);
  ensure(await workspace.openSubcircuit("u2"), "下钻 occurrence 2 失败");
  ensure(current(workspace.activeDocumentKey) === childKey, "同一 child Project 的第二次下钻没有复用标签");
  ensure(current(workspace.tabs).length === 3, "复用 child 不应新建第四个标签");
  ensure(await workspace.returnToParent(), "从 child 返回 parent 失败");
  ensure(current(workspace.activeDocumentKey) === parentKey, "返回来源后未激活 parent");
  ensure(current(workspace.editorState)!.selection?.id === "u2", "返回来源没有选择 occurrence 2");

  // child 未保存时 parent 仍保持采用快照；成功保存后 coordinator 才广播 stale。
  await workspace.activateTab(childKey);
  const childComponentsBeforeEdit = current(workspace.editorState)!.document.components.length;
  ensure(await workspace.addComponent("not", { x: 640, y: 200 }), "child 未保存编辑失败");
  ensure(current(workspace.editorState)!.document.components.length === childComponentsBeforeEdit + 1, "child 编辑没有落在 child 文档");
  await workspace.activateTab(parentKey);
  ensure(current(workspace.state).signals["u1:q"] === "1", "child 未保存时 parent 不应重新读取磁盘");
  ensure(!current(workspace.needsReload), "child 未保存时 parent 不应 stale");
  await workspace.activateTab(childKey);
  ensure(await workspace.save(), "child 真实保存失败");
  await workspace.activateTab(parentKey);
  await waitFor(() => current(workspace.needsReload) && current(workspace.staleSubcircuits).length === 2, "child 保存后两个 parent occurrence 未显示 stale");
  const staleOccurrences = current(workspace.staleSubcircuits).length;

  // 显式 reload occurrence 1 采用兼容版本并只清掉这一 occurrence 的 stale 状态。
  ensure(await workspace.reloadSubcircuit("u1"), "兼容 child 显式 reload 失败");
  ensure(current(workspace.staleSubcircuits).length === 1, "reload occurrence 1 不应清掉 occurrence 2 的 stale");
  const incompatible = incompatibleMultiDocumentChildProject();
  await writeFixture(childPath, incompatible);
  ensure(await workspace.reloadSubcircuit("u1"), "不兼容 child 显式 reload 失败");
  const documentAfterReload = current(workspace.editorState)!.document;
  const dangling = documentAfterReload.connections.filter((connection) => (connection.danglingEndpoints?.length ?? 0) > 0);
  ensure(dangling.some((connection) => connection.id === "u1-nq"), "删除 nq Port 后 u1-nq 应成为 DanglingConnection");
  ensure(dangling.some((connection) => connection.id === "u1-q" ) === false, "仍兼容的 q Connection 不应变成 dangling");
  ensure(current(workspace.editorState)!.canUndo, "显式 reload 应产生可撤销历史帧");
  await workspace.undo();
  await workspace.redo();

  // 只杀 parent 的文档引擎；peer 与 child 随后仍能步进，parent 按既有健康检查语义恢复并清空时间线。
  const parentBridge = bridge.forDocument(parentKey);
  ensure(typeof parentBridge.killForTest === "function", "E2E preload 未暴露按文档故障注入");
  ensure((await parentBridge.killForTest()).ok, "parent 引擎未被杀死");
  await workspace.activateTab(peerKey);
  await workspace.step();
  ensure(current(workspace.state).engineState === "ready", "parent 故障不应影响 peer 引擎");
  await workspace.activateTab(childKey);
  await workspace.step();
  ensure(current(workspace.state).engineState === "ready", "parent 故障不应影响 child 引擎");
  await workspace.activateTab(parentKey);
  await workspace.step();
  await waitFor(() => current(workspace.state).engineState === "ready" && current(workspace.state).simulationStep === 0, "parent 引擎未按既有语义恢复");
  const recoveredParent = current(workspace.state).engineState === "ready" && current(workspace.state).simulationStep === 0;

  // 关闭 parent 后 child 的来源记录必须失效；最后关闭全部文档只保留空 controller。
  await workspace.closeTab(parentKey, true);
  await workspace.activateTab(childKey);
  ensure(!current((workspace as any).canReturnToParent), "parent 关闭后 child 不应保留来源返回链接");
  await workspace.closeTab(childKey, true);
  await workspace.closeTab(peerKey, true);
  ensure(current(workspace.tabs).length === 0, "关闭所有文档后不应残留标签");
  return { tabs: current(workspace.tabs).length, parentStep, peerStep, childKey, staleOccurrences, danglingConnectionIds: dangling.map((connection) => connection.id), recoveredParent };
}

(window as unknown as { __multidocumentResult: Promise<HarnessResult> }).__multidocumentResult = run();
