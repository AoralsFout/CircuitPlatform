# CI 与统一 Electron 回归

Phase 6 为桌面应用提供基础验证、真实 Electron 回归和 Windows x64 安装器发布门槛。CI 配置分别位于 `.github/workflows/ci.yml` 与 `.github/workflows/release.yml`。

## 本地入口

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm regression
```

`verify` 负责类型检查、Node 测试、生产页面构建、C++ 构建、CTest 与真实引擎时序回归。`regression` 顺序执行以下场景，要求生产页面和引擎已构建；可通过 `CIRCUIT_ENGINE_PATH` 指定真实引擎的绝对路径。

| 场景 | 验证范围 |
| --- | --- |
| multidocument-e2e | 多文档隔离、内嵌定义编辑、保存与引擎恢复 |
| embedded-snapshot-e2e | 导入、保存、自包含快照与移动源文件后重新打开 |
| subcircuit-library-probe | 定义树、DOM、键盘操作与真实文件导出 |
| embedded-definition-navigation-e2e | 内嵌定义导航、只读视图、端口顺序与连线端点 |
| embedded-port-repair-e2e | 修复确认、取消、悬空连线与兼容接口恢复 |
| canvas-selection-regression | Wire 选择清除、原生鼠标点击放置与预览落点 |
| visual-state-probe | 21 种视觉夹具的 DOM 状态和键盘行为 |
| runtime-startup-probe | 日志目录不可写时正式应用仍能启动并连接真实引擎 |

每项必须同时满足退出码为 0 与完成标记存在；缺引擎、`SKIP`、未完成、进程异常、180 秒超时均失败。超时会清理该场景的进程树。各场景使用独立临时用户目录，避免污染开发者的最近项目、日志和设置；Vite 端口由操作系统分配，避免 Windows 保留端口或并行开发服务发生冲突。

每项 stdout/stderr 写入 `artifacts/regression/<场景>.log`，汇总写入 `summary.json`；正式运行时日志存在时会复制到 `<场景>-runtime/`。这些文件由 Git 忽略，CI 无论成功失败均保留为 artifact 14 天。执行失败时先查看 summary 中第一项失败，再查看同名日志。Node runner 的失效测试随 `pnpm test` 执行，覆盖缺完成标记、跳过、非零退出、无法启动和超时。

截图采集 `visual:test` 和交互性能 `performance:benchmark` 继续作为单独的验收工具；统一回归不会把截图哈希当成像素基线，也不会用 DOM 探针结果替代性能测量。详见[视觉回归](visual-regression.md)和[性能基准](performance-benchmark.md)。

## PR 与分支推送

CI 在 `pull_request` 和分支 `push` 上运行，矩阵为 `windows-2022` 与 `ubuntu-24.04`，两者均执行 `pnpm verify` 和 `pnpm regression`。

- Node 固定在 24 主版本，pnpm 读取根 `package.json` 的 `packageManager` 精确版本；依赖安装使用 frozen lockfile。
- Windows 使用 MSYS2 UCRT64 的 GCC、CMake 与 MinGW Makefiles，与本地工具链一致。
- Linux 安装 CMake、G++、Make、Electron 系统库与 Xvfb；回归通过 `xvfb-run --auto-servernum --server-args="-screen 0 1440x900x24" pnpm regression` 运行。测试启动器会从命令行向 Linux Electron 子进程传入 `--no-sandbox`，因为 runner 中 npm 下载的 `chrome-sandbox` 未配置 root/4755，原生启动检查早于测试 JavaScript 执行；该参数仅用于回归，不改变正式应用的安全配置。
- 官方 Actions 固定提交 SHA。默认 token 只有 `contents: read`，checkout 不保留凭据；新提交取消同一 ref 的旧 CI，矩阵单边失败不会中断另一边。

本地 Windows 通过不代表 Linux runner 已通过；首次合并前应以两项实际 GitHub Actions 检查结果为准。工作流语法可用 `actionlint .github/workflows/ci.yml .github/workflows/release.yml` 检查。

## Windows 安装器草稿

推送 `v*` 标签启动发布工作流，标签必须与根版本严格匹配。只读构建 job 完成基础验证、全部 Electron 回归、NSIS 构建、打包资源与引擎依赖检查、打包应用烟测和 `pnpm package:install-smoke` 的安装/启动/卸载验证后，才生成 `SHA256SUMS.txt` 并上传经过验证的安装器。

创建草稿是独立 job，仅此 job 获得 `contents: write`。它下载本次构建的 artifact，复核 SHA-256，使用 `gh release create --verify-tag --draft` 创建未公开的 Release。构建步骤不接收发布写权限，不运行自动上传；任何前置失败都阻止创建草稿。

当前未配置代码签名，草稿说明必须保留这一事实。维护者需完成 Windows 安装界面与签名状态检查后再发布。发布步骤与限制见[发布文档](../releasing.md)。工作流文件本身不会创建标签，本阶段的本地验证不会发布 Release。
