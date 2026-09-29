const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { resolveEnginePath } = require("../electron/runtime-paths.cjs");

test("installed application uses bundled engine even when a development override exists", () => {
  const resourcesPath = path.resolve("安装目录 with spaces/resources");
  assert.equal(resolveEnginePath({
    isPackaged: true, resourcesPath, desktopRoot: "/unavailable/source", platform: "win32",
    env: { CIRCUIT_ENGINE_PATH: "/unavailable/override" },
  }), path.join(resourcesPath, "engine/circuit-engine.exe"));
});

test("development engine path is independent of cwd and supports test substitution", () => {
  const desktopRoot = path.resolve("apps/desktop");
  assert.equal(resolveEnginePath({ isPackaged: false, resourcesPath: "", desktopRoot, platform: "linux", env: {} }),
    path.resolve(desktopRoot, "../../engine/build/circuit-engine"));
  assert.equal(resolveEnginePath({ isPackaged: false, resourcesPath: "", desktopRoot, env: { CIRCUIT_ENGINE_PATH: "/test/engine" } }), "/test/engine");
});
