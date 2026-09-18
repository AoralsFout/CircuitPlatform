import io


def edit(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, s.count(old), old[:90])
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)


# ---------------------------------------------------------------- inspector
edit('apps/desktop/src/editor/inspector.ts', [
    ('''export interface InspectorPort {
  id: string;
  name: string;
  direction: "input" | "output";
  signal: Signal;
  connectionState: "connected" | "dangling" | "unconnected";
}''',
     '''export interface InspectorPort {
  id: string;
  /** 展示标签，通常与端口名相同。 */
  name: string;
  /** 端口行显示的文本，带位区间时形如 `out[7:0]`。 */
  label: string;
  direction: "input" | "output";
  width: number;
  signal: Signal;
  connectionState: "connected" | "dangling" | "unconnected";
}

/**
 * 检查器里的一条可编辑属性。
 *
 * 第一版只有位宽，而它是列表里的第一项——ADR 0014 说过第一版不引入没有实际用例的可编辑
 * 属性，位宽是第一个真实例外。
 */
export interface InspectorAttribute {
  id: "width";
  label: string;
  /** 当前值。提交失败时这里仍是提交前的值，因为模型是从文档投影出来的。 */
  value: number;
  /** 这个属性作用在哪个端口上；提交时用它拼出整份端口清单。 */
  portName: string;
}'''),
    ('''  signal: Signal;
  ports: readonly InspectorPort[];
  /**
   * 结构提示：组件缺少能驱动它的连接时给出一行可展示的说明；没有问题时为 null。
   * 这是结构问题而不是错误，因此不进入 error 字段。
   */
  hint: string | null;
}''',
     '''  signal: Signal;
  ports: readonly InspectorPort[];
  /** 可编辑属性；位宽是第一个。元件没有可编辑属性时为空数组。 */
  attributes: readonly InspectorAttribute[];
  /**
   * 结构提示：组件缺少能驱动它的连接时给出一行可展示的说明；没有问题时为 null。
   * 这是结构问题而不是错误，因此不进入 error 字段。
   */
  hint: string | null;
}'''),
    ('''/**
 * 从 CanvasScene 生成只读检查器模型，不暴露 position、engine ID 或生命周期。''',
     '''/**
 * 位宽是检查器里第一个可编辑属性。
 *
 * 第一版只给 Input / Output 元件开这个口子：它们各只有一个端口，改它的位宽就是改「这个元件
 * 有多宽」。逻辑门、Clock 与 D Flip-Flop 固定按 1 位工作，不随输入变宽，因此不给它们开——
 * 需要更宽的值由用户显式用合线器构造。
 */
function widthAttributes(node: CanvasNode): InspectorAttribute[] {
  if (node.kind !== "input" && node.kind !== "output") return [];
  const port = node.ports[0];
  if (!port || node.ports.length !== 1) return [];
  return [{ id: "width", label: "位宽", value: port.width, portName: port.id }];
}

/**
 * 从 CanvasScene 生成检查器模型，不暴露 position、engine ID 或生命周期。'''),
    ('''      const connectionState: InspectorPort["connectionState"] = matches.length === 0
        ? "unconnected"
        : matches.some((wire) => wire.danglingEndpoints.length > 0) ? "dangling" : "connected";
      return {
        id: port.id,
        name: port.name,
        direction: port.direction,
        signal: port.signal,
        connectionState,
      };''',
     '''      // 位宽不再匹配的连接与端点缺失的连接都是悬空，检查器因此只报一种状态。
      const connectionState: InspectorPort["connectionState"] = matches.length === 0
        ? "unconnected"
        : matches.some((wire) => wire.dangling) ? "dangling" : "connected";
      return {
        id: port.id,
        name: port.name,
        label: port.label,
        direction: port.direction,
        width: port.width,
        signal: port.signal,
        connectionState,
      };'''),
    ('''      signal: componentSignal(node),
      ports,
      hint: structuralHint(ports),''',
     '''      signal: componentSignal(node),
      ports,
      attributes: widthAttributes(node),
      hint: structuralHint(ports),'''),
    ('''    status: wire.danglingEndpoints.length > 0 ? "dangling" : "normal",''',
     '''    status: wire.dangling ? "dangling" : "normal",'''),
])


# ----------------------------------------------------------- useEditorState
edit('apps/desktop/src/composables/useEditorState.ts', [
    ('''  const selectedComponentValue = computed<Signal>''',
     '''  /**
   * 提交一次位宽编辑。
   *
   * 载荷是**整份端口清单**：协议里的改宽是整体替换，因此这里从当前场景取回该元件的端口清单，
   * 只换掉目标端口的位宽再提交。这样编辑器不必在提交前重算匹配规则，引擎也不必接受一种
   * 「按单端口下发」的形状。
   * @param componentId 要改的元件。
   * @param portName 要改位宽的端口。
   * @param width 新的位宽。
   */
  function setPortWidth(componentId: EditorComponentId, portName: string, width: number): void {
    const node = canvasScene.value.nodes.find((candidate) => candidate.id === componentId);
    if (!node) return;
    const ports = node.ports.map((port) => ({
      name: port.id,
      direction: port.direction,
      width: port.id === portName ? width : port.width,
      ...(port.bitRange ? { bitRange: { ...port.bitRange } } : {}),
    }));
    void setPortWidthCommand(componentId, ports);
  }

  const selectedComponentValue = computed<Signal>'''),
    ('''    const simulation = createSimulationSnapshot(snapshot, {''',
     '''    const simulation = createSimulationSnapshot(snapshot, {'''),
    ('''    createConnection: (left: ConnectionDraftPort, right: ConnectionDraftPort, route?: readonly Point[], connectionId?: string, color?: WireColorId) => Promise<{ ok: boolean; error?: string }> = async () => ({ ok: false }),
) {''',
     '''    createConnection: (left: ConnectionDraftPort, right: ConnectionDraftPort, route?: readonly Point[], connectionId?: string, color?: WireColorId) => Promise<{ ok: boolean; error?: string }> = async () => ({ ok: false }),
    setPortWidthCommand: (componentId: EditorComponentId, ports: readonly PortSpec[]) => Promise<void> = async () => undefined,
) {'''),
    ('''    selectComponent,
    selectConnection,''',
     '''    selectComponent,
    selectConnection,
    setPortWidth,'''),
])


# -------------------------------------------------------------- useWorkspace
edit('apps/desktop/src/composables/useWorkspace.ts', [
    ('''  /** 删除指定 Component，供对象右键菜单直接复用稳定编辑器身份。 */
  deleteComponent(componentId: EditorComponentId): Promise<void>;''',
     '''  /** 删除指定 Component，供对象右键菜单直接复用稳定编辑器身份。 */
  deleteComponent(componentId: EditorComponentId): Promise<void>;
  /**
   * 整份替换一个元件的端口清单；改宽是一次可撤销的结构提交，排在共享的引擎调用队列里，
   * 因此不会与推进交错。
   */
  setPortWidthCommand(componentId: EditorComponentId, ports: readonly PortSpec[]): Promise<void>;'''),
    ('''  /** 右键菜单直接复用 EditorSession 的 add-component 命令；成功才返回 true。 */''',
     '''  /** 改宽走与其它结构提交同一条路径：先发命令，再按响应刷新编辑器与仿真。 */
  async function setPortWidthCommand(componentId: EditorComponentId, ports: readonly PortSpec[]): Promise<void> {
    await dispatch({ type: "set-port-width", componentId, ports });
  }

  /** 右键菜单直接复用 EditorSession 的 add-component 命令；成功才返回 true。 */'''),
])

s = io.open('apps/desktop/src/composables/useWorkspace.ts', encoding='utf-8').read()
old = '''    deleteComponent,'''
assert s.count(old) == 1, s.count(old)
s = s.replace(old, '''    deleteComponent,
    setPortWidthCommand,''')
io.open('apps/desktop/src/composables/useWorkspace.ts', 'w', encoding='utf-8', newline='\n').write(s)

print("ok")
