# Issue Tracker：GitHub

本仓库的 Issue 和规格发布到 `AoralsFout/CircuitPlatform` 的 GitHub Issues。使用 `gh` CLI 执行相关操作。

## 约定

- 创建：`gh issue create --title "..." --body-file "..."`
- 读取：`gh issue view <number> --comments`
- 列出：`gh issue list --state open --json number,title,body,labels,comments`
- 评论：`gh issue comment <number> --body "..."`
- 添加标签：`gh issue edit <number> --add-label "..."`
- 移除标签：`gh issue edit <number> --remove-label "..."`
- 关闭：`gh issue close <number> --comment "..."`

在仓库 clone 内运行时，由 `gh` 根据 Git remote 自动识别仓库。

## Pull Request 是否作为 triage 请求入口

**否。**

外部 Pull Request 不进入与 Issue 相同的 triage 队列。如需改变该约定，可以直接修改本文件。

GitHub 的 Issue 和 Pull Request 共享编号；遇到含义不明的 `#42` 时，先运行 `gh pr view 42`，失败后再运行 `gh issue view 42`。

## 技能操作映射

当技能要求“发布到 Issue Tracker”时，创建 GitHub Issue。

当技能要求“读取相关 ticket”时，运行：

`gh issue view <number> --comments`

发布规格时添加 `ready-for-agent` 标签。
