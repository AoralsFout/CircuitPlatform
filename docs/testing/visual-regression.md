# 视觉状态截图回归

页面位于 `apps/desktop/visual-regression.html`，直接挂载正式 Vue `App` 与 `CircuitCanvas`，只用内存 Engine adapter 替代 Electron IPC。状态通过真实 DOM 交互产生，不包含手写静态节点、SVG path 或百分比定位：首启空状态、默认、空画布、选中 Component、选中 Wire、ConnectionDraft、Dangling、pending、error、连续运行中、已暂停，以及 Phase 4.5 新增的七个多位电路状态。

自 Phase 5（issue #40）起启动不再自动加载示例：`first-start` 状态截取空状态引导面板本身；其余所有需要电路的状态在 `prepare()` 一开始先点击面板上的「加载示例」，等画布出现元件后再继续后面的真实交互。

`running` 与 `paused` 两个状态（issue #24）沿用同一条约束：先点「清空画布」并确认，再从元件库把 Clock、D Flip-Flop、输入拖到画布上，拉出 `out → clock` 与 `out → d` 两条连线，最后按工具栏的「开始连续运行」。暂停态在开始之后再按「暂停」。因此画面上是一条 Clock 驱动 D Flip-Flop 的时序电路，加上工具栏的运行态与已推进步数。

内存 adapter 必须覆盖 `EngineAdapter` 的全部方法——`tests/visual-regression.test.ts` 直接读 `src/workspace/index.ts` 的接口定义逐条断言，避免每加一条运行控制就漏一次。`tick` 由夹具挂起、由截图脚本显式放行：连续运行的步数因此不会因为「取图时刻差了半拍」而漂移。

## 多位电路状态（Phase 4.5）

七个状态同样由真实 DOM 交互产生，覆盖多位 Port 在界面上的三处落点：

| 状态 | 产生方式 | 画面上的重点 |
| --- | --- | --- |
| `bus-canvas` | 从元件库拖出拆线器、输入、合线器、输出，在检查器里把 Input / Output 改成 8 位，拉出 `out → in`、`out0 → in0` 与 `merger → Output` 三条连线，再到「输入设置」里拨动第 8 位与第 6 位 | 位区间标注（`out[7:0]`、`out0[7:7]`）与逐位二进制文本（总线上是 `10X00000`，不是一整条 `X`） |
| `bus-inspector` | 放下一个默认 1 位的输入，在检查器里把位宽改成 8 | 检查器的第一个可编辑属性：位宽数字框，以及端口行报出的位宽与当前多位读数 |
| `bus-ranges` | 放下拆线器，在检查器里把位区间列表改成 `7:4, 3:0` | 拆线器的位区间编辑，提交后分支标注变成 `out0[7:4]` 与 `out1[3:0]` |
| `bus-bits-expanded` | 搭出多位通路，切到「输入设置」，左键拨一位、右键把另一位设为 `X` | 8 位输入按位展开成方形按钮，每行八列 |
| `bus-bits-collapsed` | 同上，再点一次展开按钮 | 收起后的形态：按钮组消失，取值仍显示在标题行上 |
| `bus-bit-single` | 直接用示例电路里的 1 位输入 | 1 位与 8 位共用同一套视觉，只是每组只有一个方形按钮 |
| `bus-bit-space` | 搭出多位通路，切到「输入设置」；那一击由 `visual:probe` 用真实输入发出 | 画面与 `bus-bits-expanded` 相同；这个状态是为探针准备的，不是为截图准备的 |

夹具在这条路径上必须与真实引擎同规则，否则画面会静默失真：`addComponent` 记下它回传的端口清单（拆线器与合线器的清单是数据驱动的，必须由调用方给出），`getSignal` 返回的读数长度等于端口位宽（位宽为 1 时仍返回 `X`，既有状态的画面因此不受影响）。位按钮在引擎绑定就绪之前是禁用的，夹具因此要等按钮可用再点——直接点下去会落在禁用按钮上，静默什么都不做。

## Phase 5.6 多文档视觉矩阵

多文档夹具必须通过生产的 tab/workspace facade 产生状态；不得在截图页手写多个静态
标签或伪造 `DocumentTabSnapshot`。每个状态都在深色/浅色主题和普通/窄窗口各取一份，
截图供人工检查，DOM 事实由 `visual:probe` 负责自动判定。

| 状态 | 必须覆盖的事实 | 普通/窄 | 深色/浅色 |
| --- | --- | --- | --- |
| `multi-tabs` | 至少两个真实标签、活动标签、同名 Editor ID 不串状态 | 通过（2/2） | 通过（2/2） |
| `multi-tabs-narrow` | 窄窗口标签可见性、关闭按钮和活动标记不重叠 | 通过（2/2） | 通过（2/2） |
| `long-name` | 长路径/长项目名截断但仍可通过 ARIA 名称识别 | 通过（2/2） | 通过（2/2） |
| `unnamed-tabs` | 多个未命名文档的稳定序号与去重 | 通过（2/2） | 通过（2/2） |
| `unsaved-tab` | dirty 标记、关闭确认、取消后焦点回到原标签 | 通过（2/2） | 通过（2/2） |
| `needs-reload` | 父 occurrence 的 stale/需重新加载提示，不误报为 dirty | 通过（2/2） | 通过（2/2） |
| `unresolved-drill` | 未解析实例的下钻入口禁用并展示诊断 | 通过（2/2） | 通过（2/2） |
| `engine-unavailable` | 单文档不可用，不把其他标签染成 unavailable | 通过（2/2） | 通过（2/2） |
| `internal-signals` | occurrence-local 行、值、只读标记和可恢复读取错误 | 通过（2/2） | 通过（2/2） |
| `source-return` | 返回父文档后来源选中、居中和焦点状态 | 通过（2/2） | 通过（2/2） |

2026-09-21 已运行以下取证命令；10 个状态在深色/浅色、普通/窄窗口下共生成 40 张截图，
`visual:probe` 的 21 个状态全部通过：

```powershell
pnpm --filter @circuit-platform/desktop visual:test -- --state=multi-tabs,multi-tabs-narrow,long-name,unnamed-tabs,unsaved-tab,needs-reload,unresolved-drill,engine-unavailable,internal-signals,source-return
pnpm --filter @circuit-platform/desktop visual:probe
```

Spec #67 的子电路库另有真实桌面窗口 DOM 探针：

```sh
pnpm --filter @circuit-platform/desktop test:subcircuit-library-probe
```

脚本打开临时 v2 Project，使用真实 Electron 输入事件以 Space 打开「子电路」侧栏，
再以 Tab 进入定义树并选中同名定义。它核对长名称的完整 title、嵌套层级、
使用次数、同名编号、详情和画布标题；随后通过键盘打开改名表单并提交名称，
验证树与画布同步更新。画布标题省略 `.circuit.json`，树和详情保留完整名称。
需要已构建的 C++ 引擎；在独立 worktree 运行时可用 `CIRCUIT_ENGINE_PATH`
指向主工作区的 `engine/build/circuit-engine.exe`。

`visual:test` 成功只证明页面和夹具能产出截图，不能证明像素哈希稳定；以上状态的 tab
数量、ARIA 标签、dirty/stale/unresolved/unavailable 文案或类名、禁用下钻、来源选中/
居中以及内部行和值，必须由 `visual:probe` 逐条断言。截图矩阵已抽查多标签、未命名标签、
内部信号和来源返回；截图证据仍不替代 DOM 事实断言。

## 运行

在安装依赖后，从仓库根目录执行：

```bash
pnpm --filter @circuit-platform/desktop visual:test
```

脚本启动临时 Vite 服务，并通过 Electron 的 `capturePage()` 为每个状态生成深色/浅色主题和常规/窄窗口截图，写入 `apps/desktop/artifacts/visual-regression/`。该目录已被 `.gitignore` 排除，避免统一 `verify` 携带体积较大的二进制基线。

可用参数：

```bash
pnpm --filter @circuit-platform/desktop visual:test -- --state=default,selected-component --theme=light
pnpm --filter @circuit-platform/desktop visual:test -- --reduced-motion
```

`manifest.json` 记录每张截图的状态、视口和 SHA-256。截图生成本身不参与 `pnpm verify`，因此不会拖慢统一类型检查、单元测试和构建门槛。**哈希不能当作基线**——原因见下面「这套基线**没有**自动回归检测能力」一节；需要自动检测时用 `visual:probe`。

取图前有两个前提，缺一个都会拍到错的画面：

- **等夹具把状态跑完。** 夹具在 `prepare()` 结束后置 `window.__visualReady`，脚本同时等它和 `.app-shell`。只等 `.app-shell` 会在准备过程中取图——例如「元件已经放下、连线还没拉」的那一帧；
- **窗口必须是可见的。** 隐藏窗口不会持续产出新帧，`capturePage()` 会返回很早以前的那一张。脚本因此用显示窗口（与性能基准同样的理由：隐藏页面会被节流），并在取图前 `invalidate()` 主动重画一帧。

## 这套基线**没有**自动回归检测能力

画布网格的亚像素抗锯齿会让两次运行的 PNG 有差异：实测同一状态连续两次运行，差异只落在一个约 150×130 的画布小区域内，最大通道差 3/765（加不加 `--reduced-motion` 都一样，因为来源是网格渲染而不是动画相位）。位宽与信号文本进来之后这个差异更大：**同一份代码连跑两次，绝大多数 PNG 的 sha256 都不一样，而文件只差几十字节。**

因此要把话说准：

- `manifest.json` 里的 sha256 **不是**逐位基线，`scripts/visual-regression.mjs` 也**不拿它做任何比对**——它只是写进 JSON 供人查看；
- 产物目录 `apps/desktop/artifacts/visual-regression/` 被 `.gitignore` 排除，基线**不入库**；
- 于是「比对哈希证明外观没变」在这台机器上**既不成立也不可否证**。任何一处外观改动都不会让截图脚本失败，`pnpm --filter @circuit-platform/desktop visual:test` 只在页面挂载失败或夹具报错时才非零退出。

这套 harness 现在的用途是**产出供人查看的画面**，不是自动回归。它仍然值得跑：页面挂不起来、夹具准备抛错、状态被改坏到渲染不出节点，这几种失败都会当场暴露。

### 多位电路状态的正确性由 DOM 层断言保证

补上自动检测能力的是 `apps/desktop/scripts/visual-state-probe.mjs`——它不比对图片，而是把每个状态真正渲染出来的 DOM 事实取出来逐条断言：

```bash
pnpm --filter @circuit-platform/desktop visual:probe
```

取的是端口的位区间标签与 `data-signal`、`signal-state--*` 类名、位按钮的 `data-value` 与档位、检查器里可编辑属性的当前值与端口行的位宽文案，以及连线上的信号文本。断言因此是逐条可证伪的：位区间标注没画出来、总线文本退化成整条 `X`、位按钮少了一个、收起之后按钮组还在，都会让脚本以非零状态退出并打印是哪一条。

### 需要真实输入的断言

有一类缺陷在源码层与结构层都看不出来，只能靠真实输入复现：**原生控件的默认动作被全局处理器 `preventDefault()` 掉。** 挂在 `window` 上的键盘处理器会看到从任何控件冒泡上来的按键，如果它无条件地把某个键当成自己的，那个控件的原生激活就静默失效了——DOM 结构、类名、属性全都没变，只有「按下去没反应」。

`bus-bit-space` 就是为这一类准备的状态。探针在收集事实之前做两件事：

- **问一句默认动作还在不在。** 原生按钮的 Space 激活只在 `keydown` 没有被 `preventDefault()` 时发生，因此可以在焦点落到位按钮上之后派发一个可取消、会冒泡的合成 `keydown` 并读 `dispatchEvent` 的返回值——返回 `false` 就是有人取消了它。派发合成事件不会触发原生激活，所以这一步测的是「取消与否」，不是取值变化；
- **发一次真实输入。** `webContents.sendInputEvent` 走浏览器自己的输入管线，默认动作会被执行，因此它测的是端到端的那一击：0 位应当翻成 1。

同一个状态里还顺手测了画布作用域的同名按键：同样的合成 Space 落在画布元素上必须**被** `preventDefault`（画布的 Space 是草稿轴向与平移修饰），否则这次修复就把画布的行为一起带走了。两半合起来才是「同一按键按焦点所在的作用域分派」（ADR 0012）。

这条脚本与 `visual:test` 一样不在 `pnpm verify` 里，要单独跑。

## 验收重点

- 深浅主题下，Wire 保持用户预设色，`0 / 1 / X` 文字沿 output → input 方向表达信号状态。
- Dangling 保持线路预设色和悬空端点，但不显示流动文字；pending 使用虚线边框和状态文案；错误使用持久错误条，而不是只显示短暂 Toast。
- Wire 选择和键盘焦点使用连续外描边，内层仍能辨认原线路色；不得退化为宽虚线。
- 720×560 的窄窗口隐藏侧栏但保留工具轨道、画布、工具栏和状态面板，不遮住关键状态。
- `--reduced-motion` 与系统 `prefers-reduced-motion: reduce` 均关闭过渡和流动，将信号文字静态放在线路中央。
- 多位电路（Phase 4.5）：位区间标注出现在每一位宽大于 1 的端口上（`out[7:0]`），带位区间的分支标出自己那一段（`out0[7:4]`）；总线信号以逐位文本显示，某一位未知时是 `X1X0` 而不是整条 `X`；检查器把位宽与位区间列表显示成可编辑属性并报出端口位宽；8 位输入的位按钮每行八列、可展开收起，1 位输入渲染成单个方形按钮。这几条由 `visual:probe` 逐条断言。
