import { useDocumentWorkspace } from "../src/composables/useDocumentWorkspace.ts";
import type { ProjectFileData } from "../src/project-file/index.ts";

type FirstResult = { saved: boolean; importedPorts: string[]; initialSignal: string | undefined };
type FinalResult = { reopened: boolean; ports: string[]; outputSignal: string | undefined; definitionCount: number };

const bridge = (window as unknown as { circuitPlatform: Window["circuitPlatform"] }).circuitPlatform;
const workspace = useDocumentWorkspace();

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitFor(condition: () => unknown, message: string, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(message);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
}

async function firstPhase(): Promise<FirstResult> {
  await workspace.requestNew();
  ensure(workspace.projectPath.value === null, "父工程必须尚未保存");
  ensure(await workspace.addSubcircuitFromDialog({ x: 320, y: 160 }), workspace.openError.value ?? "导入失败");
  const imported = workspace.editorState.value.document.components.find((component: { kind: string }) => component.kind === "subcircuit");
  ensure(imported, "导入未放置 Subcircuit");
  ensure(imported.position.x === 320 && imported.position.y === 160, "导入布局错误");
  const importedPorts = imported.ports.map((port: { name: string }) => port.name);
  ensure(JSON.stringify(importedPorts) === JSON.stringify(["a", "y"]), "导入 Port 不正确");
  ensure(workspace.projectPath.value === null, "导入不能给父工程绑定源路径");

  ensure(await workspace.addComponent("input", { x: 80, y: 160 }), "添加父工程 Input 失败");
  ensure(await workspace.addComponent("output", { x: 560, y: 160 }), "添加父工程 Output 失败");
  const components = workspace.editorState.value.document.components;
  const input = components.find((component: { kind: string }) => component.kind === "input");
  const output = components.find((component: { kind: string }) => component.kind === "output");
  ensure(input && output, "父工程输入输出缺失");
  const point = { x: 0, y: 0 };
  const left = await workspace.createConnection(
    { componentId: input.id, port: "out", direction: "output", point },
    { componentId: imported.id, port: "a", direction: "input", point },
  );
  ensure(left.ok, left.error ?? "输入连线失败");
  const right = await workspace.createConnection(
    { componentId: imported.id, port: "y", direction: "output", point },
    { componentId: output.id, port: "in", direction: "input", point },
  );
  ensure(right.ok, right.error ?? "输出连线失败");
  await workspace.setInputBit(input.id, 0, "1");
  await waitFor(() => workspace.state.value.signals[`${output.id}:in`] === "0", "导入后的组合逻辑未求值为 0");
  const initialSignal = workspace.state.value.signals[`${output.id}:in`];
  ensure(await workspace.save(), workspace.saveError.value ?? "保存父工程失败");
  ensure(workspace.projectPath.value !== null, "保存后没有父工程路径");
  return { saved: true, importedPorts, initialSignal };
}

async function afterMove(): Promise<FinalResult> {
  const parentPath = workspace.projectPath.value;
  ensure(parentPath, "父工程路径丢失");
  const key = workspace.activeDocumentKey.value;
  ensure(key, "父工程运行时键丢失");
  await workspace.closeTab(key, true);
  ensure(workspace.tabs.value.length === 0, "父工程未关闭");
  await workspace.requestOpenRecent(parentPath);
  await waitFor(() => workspace.state.value.engineState === "ready" && workspace.editorState.value !== null, "源文件移动后父工程打开失败");
  ensure(workspace.projectPath.value === parentPath, workspace.openError.value ?? "打开了错误工程");
  const components = workspace.editorState.value.document.components;
  const imported = components.find((component: { kind: string }) => component.kind === "subcircuit");
  const input = components.find((component: { kind: string }) => component.kind === "input");
  const output = components.find((component: { kind: string }) => component.kind === "output");
  ensure(imported && input && output, "重开后父工程结构不完整");
  ensure(imported.position.x === 320 && imported.position.y === 160, "重开后布局变化");
  ensure(imported.data?.subcircuit?.status === "resolved", "内嵌子电路未解析");
  const ports = imported.ports.map((port: { name: string }) => port.name);
  ensure(JSON.stringify(ports) === JSON.stringify(["a", "y"]), "重开后 Port 缓存变化");
  ensure(workspace.editorState.value.document.connections.length === 2, "重开后父工程连线缺失");
  await waitFor(() => workspace.state.value.signals[`${output.id}:in`] === "0", "重开后组合逻辑未求值为 0");
  const read = await bridge.readProjectFile(parentPath);
  ensure(read.ok, read.reason ?? "读取父工程失败");
  const saved = JSON.parse(read.content) as ProjectFileData;
  ensure(saved.version === 2, "落盘版本错误");
  const definitionCount = Object.keys(saved.definitions).length;
  ensure(definitionCount === 1, "落盘定义缺失");
  return { reopened: true, ports, outputSignal: workspace.state.value.signals[`${output.id}:in`], definitionCount };
}

(window as unknown as { __embeddedSnapshotFirst: Promise<FirstResult>; __embeddedSnapshotAfterMove: typeof afterMove }).__embeddedSnapshotFirst = firstPhase();
(window as unknown as { __embeddedSnapshotAfterMove: typeof afterMove }).__embeddedSnapshotAfterMove = afterMove;
