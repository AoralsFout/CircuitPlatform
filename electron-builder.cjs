/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "io.github.aoralsfout.circuitplatform",
  productName: "CircuitPlatform",
  executableName: "CircuitPlatform",
  directories: {
    app: "apps/desktop",
    output: "release",
  },
  // Vue 和共享协议已由 Vite 打入 dist，发布包只保留实际运行入口。
  files: ["dist/**/*", "electron/**/*.cjs", "package.json", "!node_modules/**/*"],
  extraResources: [
    { from: "engine/build/circuit-engine.exe", to: "engine/circuit-engine.exe" },
  ],
  asar: true,
  npmRebuild: false,
  publish: null,
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    artifactName: "${productName}-${version}-windows-${arch}-setup.${ext}",
    requestedExecutionLevel: "asInvoker",
  },
  nsis: {
    // 固定现有 appId 的标准 UUID，供升级、卸载和安装验收共同识别应用。
    guid: "9d10f762-4a58-5a87-9921-752e6c3828ba",
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    packElevateHelper: false,
    runAfterFinish: false,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "CircuitPlatform",
  },
};
