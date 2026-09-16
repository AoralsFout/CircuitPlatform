# 视觉状态截图回归

Issue #15 的页面位于 `apps/desktop/visual-regression.html`，直接挂载正式 Vue `App` 与 `CircuitCanvas`，只用内存 Engine adapter 替代 Electron IPC。状态通过真实 DOM 交互产生，不包含手写静态节点、SVG path 或百分比定位：默认、空画布、选中 Component、选中 Wire、ConnectionDraft、Dangling、pending 和 error。

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

## 验收重点

- 深浅主题下，Wire 保持用户预设色，`0 / 1 / X` 文字沿 output → input 方向表达信号状态。
- Dangling 保持线路预设色和悬空端点，但不显示流动文字；pending 使用虚线边框和状态文案；错误使用持久错误条，而不是只显示短暂 Toast。
- Wire 选择和键盘焦点使用连续外描边，内层仍能辨认原线路色；不得退化为宽虚线。
- 720×560 的窄窗口隐藏侧栏但保留工具轨道、画布、工具栏和状态面板，不遮住关键状态。
- `--reduced-motion` 与系统 `prefers-reduced-motion: reduce` 均关闭过渡和流动，将信号文字静态放在线路中央。
