# 视觉状态截图回归

页面位于 `apps/desktop/visual-regression.html`，直接挂载正式 Vue `App` 与 `CircuitCanvas`，只用内存 Engine adapter 替代 Electron IPC。状态通过真实 DOM 交互产生，不包含手写静态节点、SVG path 或百分比定位：默认、空画布、选中 Component、选中 Wire、ConnectionDraft、Dangling、pending、error、连续运行中和已暂停。

`running` 与 `paused` 两个状态（issue #24）沿用同一条约束：先点「清空画布」并确认，再从元件库把 Clock、D Flip-Flop、输入拖到画布上，拉出 `out → clock` 与 `out → d` 两条连线，最后按工具栏的「开始连续运行」。暂停态在开始之后再按「暂停」。因此画面上是一条 Clock 驱动 D Flip-Flop 的时序电路，加上工具栏的运行态与已推进步数。

内存 adapter 必须覆盖 `EngineAdapter` 的全部方法——`tests/visual-regression.test.ts` 直接读 `src/workspace/index.ts` 的接口定义逐条断言，避免每加一条运行控制就漏一次。`tick` 由夹具挂起、由截图脚本显式放行：连续运行的步数因此不会因为「取图时刻差了半拍」而漂移。

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

`manifest.json` 记录每张截图的状态、视口和 SHA-256。要做人工或 CI 比对，可将一次通过验收的输出目录复制为外部基线，再按 manifest 文件名比较；截图生成本身不参与 `pnpm verify`，因此不会拖慢统一类型检查、单元测试和构建门槛。

取图前有两个前提，缺一个都会拍到错的画面：

- **等夹具把状态跑完。** 夹具在 `prepare()` 结束后置 `window.__visualReady`，脚本同时等它和 `.app-shell`。只等 `.app-shell` 会在准备过程中取图——例如「元件已经放下、连线还没拉」的那一帧；
- **窗口必须是可见的。** 隐藏窗口不会持续产出新帧，`capturePage()` 会返回很早以前的那一张。脚本因此用显示窗口（与性能基准同样的理由：隐藏页面会被节流），并在取图前 `invalidate()` 主动重画一帧。

画布网格的亚像素抗锯齿会让两次运行的 PNG 有极小差异：实测同一状态连续两次运行，差异只落在一个约 150×130 的画布小区域内，最大通道差 3/765（加不加 `--reduced-motion` 都一样，因为来源是网格渲染而不是动画相位）。**基线的比对口径是画面内容与新状态名，不是 SHA-256 逐位相等**；manifest 里的哈希用来判断「与上一次差得远不远」，不当作逐位基线。

## 验收重点

- 深浅主题下，Wire 保持用户预设色，`0 / 1 / X` 文字沿 output → input 方向表达信号状态。
- Dangling 保持线路预设色和悬空端点，但不显示流动文字；pending 使用虚线边框和状态文案；错误使用持久错误条，而不是只显示短暂 Toast。
- Wire 选择和键盘焦点使用连续外描边，内层仍能辨认原线路色；不得退化为宽虚线。
- 720×560 的窄窗口隐藏侧栏但保留工具轨道、画布、工具栏和状态面板，不遮住关键状态。
- `--reduced-motion` 与系统 `prefers-reduced-motion: reduce` 均关闭过渡和流动，将信号文字静态放在线路中央。
