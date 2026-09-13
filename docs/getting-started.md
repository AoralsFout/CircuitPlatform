# 开发环境

## 必需工具

- Node.js 和 pnpm
- CMake
- MinGW g++

## 安装前端依赖

```powershell
pnpm install
```

## 编译 C++ 引擎

```powershell
pnpm build:engine
```

## 启动桌面应用

先编译引擎，再启动前端和 Electron：

```powershell
pnpm build:engine
pnpm dev
```

## 验证

```powershell
pnpm verify
```

如果 CMake 选择了不同的生成器，需要相应调整 `build:engine` 脚本或手动执行 CMake 命令。
