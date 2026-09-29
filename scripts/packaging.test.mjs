import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";
import { createPackage } from "@electron/asar";
import { checkPackageContents } from "./check-package.mjs";
import { readReleaseVersion } from "./release-version.mjs";

async function removeFixture(directory) {
  const fixtureRelative = relative(resolve(tmpdir()), resolve(directory));
  assert.ok(!isAbsolute(fixtureRelative) && !fixtureRelative.startsWith("..") && dirname(fixtureRelative) === "." && /^circuit-(?:version|package)-/.test(fixtureRelative));
  await rm(directory, { recursive: true, force: true });
}

test("发布版本不一致时在构建前拒绝产包", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "circuit-version-"));
  context.after(() => removeFixture(root));
  await mkdir(join(root, "apps/desktop"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(join(root, "apps/desktop/package.json"), JSON.stringify({ version: "0.2.0" }));
  assert.throws(() => readReleaseVersion(root), /发布版本不一致/);
});

test("发布校验拒绝缺引擎、开发页面及 file 协议无法加载的绝对资源", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "circuit-package-"));
  context.after(() => removeFixture(root));
  const app = join(root, "app");
  const output = join(root, "release");
  await Promise.all(["electron", "dist/assets"].map((directory) => mkdir(join(app, directory), { recursive: true })));
  await mkdir(join(output, "resources/engine"), { recursive: true });
  await writeFile(join(app, "package.json"), JSON.stringify({ version: "0.1.0", main: "electron/main.cjs" }));
  await writeFile(join(app, "electron/main.cjs"), "");
  await writeFile(join(app, "electron/preload.cjs"), "");
  await writeFile(join(app, "dist/assets/index.js"), "");
  const binary = Buffer.alloc(128);
  binary.write("MZ");
  binary.writeUInt32LE(64, 0x3c);
  binary.writeUInt32LE(0x00004550, 64);
  binary.writeUInt16LE(0x8664, 68);
  await writeFile(join(output, "CircuitPlatform.exe"), binary);
  await writeFile(join(app, "dist/index.html"), '<script src="/assets/index.js"></script>');
  await createPackage(app, join(output, "resources/app.asar"));
  assert.throws(() => checkPackageContents(output, "0.1.0"), /发布包缺少.*circuit-engine/);
  await writeFile(join(output, "resources/engine/circuit-engine.exe"), binary);
  assert.throws(() => checkPackageContents(output, "0.1.0"), /绝对资源路径/);
  await writeFile(join(app, "dist/index.html"), '<script src="./assets/index.js"></script>');
  await createPackage(app, join(output, "resources/app.asar"));
  assert.equal(checkPackageContents(output, "0.1.0").version, "0.1.0");
  assert.throws(() => checkPackageContents(output, "0.2.0"), /安装内容与源码版本不一致/);
  await mkdir(join(app, "scripts"));
  await writeFile(join(app, "scripts/e2e.html"), "development only");
  await createPackage(app, join(output, "resources/app.asar"));
  assert.throws(() => checkPackageContents(output, "0.1.0"), /混入开发文件/);
});
