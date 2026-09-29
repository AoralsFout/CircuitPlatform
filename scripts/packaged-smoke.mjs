import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const unpackedDirectory = resolve(process.argv[2] ?? "release/win-unpacked");
const artifactDirectory = resolve("release/smoke");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

// 浏览器调试端口仅绑定本机，并且只在本次验收进程的命令行上开启。
async function reservePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function connectDebugger(port, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`安装版在连接调试器前退出：${child.exitCode}`);
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
      const page = pages.find((entry) => entry.type === "page" && entry.url.startsWith("file:"));
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        try { await once(socket, "open", { signal: AbortSignal.timeout(2000) }); }
        catch (error) { socket.close(); throw error; }
        let sequence = 0;
        const pending = new Map();
        socket.addEventListener("message", ({ data }) => {
          const message = JSON.parse(data);
          const request = pending.get(message.id);
          if (!request) return;
          pending.delete(message.id);
          clearTimeout(request.timer);
          if (message.error) request.reject(new Error(message.error.message));
          else request.resolve(message.result);
        });
        socket.addEventListener("close", () => {
          for (const request of pending.values()) {
            clearTimeout(request.timer);
            request.reject(new Error("安装版调试连接已关闭"));
          }
          pending.clear();
        });
        return {
          socket,
          send(method, params = {}) {
            return new Promise((resolveRequest, reject) => {
              const id = ++sequence;
              const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`安装版验收超时：${method}`));
              }, 20_000);
              pending.set(id, { resolve: resolveRequest, reject, timer });
              socket.send(JSON.stringify({ id, method, params }));
            });
          },
        };
      }
    } catch {
      // 端口和 file:// 页面尚未就绪时继续等候；总截止时间防止空白窗口挂住验收。
    }
    await delay(100);
  }
  throw new Error("安装版未提供正式 file:// 页面");
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(cdp, expression, description) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return;
    await delay(50);
  }
  throw new Error(`安装版验收未满足：${description}`);
}

async function main() {
  if (process.platform !== "win32") throw new Error("当前安装包验收仅支持 Windows x64");
  const executable = join(unpackedDirectory, "CircuitPlatform.exe");
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "circuitplatform-packaged-"));
  const profile = join(temporaryDirectory, "profile");
  const projectPath = join(temporaryDirectory, "安装回归 with spaces.circuit.json");
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(join(artifactDirectory, "packaged-smoke.json"), `${JSON.stringify({ passed: false, executable, startedAt: new Date().toISOString() }, null, 2)}\n`);
  const port = await reservePort();
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  // 移除开发 PATH/Node 注入变量；同时传入无效开发覆盖，证明生产包忽略这些入口。
  const env = { ...process.env, PATH: `${systemRoot}\\System32;${systemRoot}`, CIRCUIT_ENGINE_PATH: join(temporaryDirectory, "missing.exe"),
    CIRCUIT_PLATFORM_E2E_URL: "http://127.0.0.1:1/must-not-load", CIRCUIT_PLATFORM_E2E: "1" };
  for (const key of Object.keys(env)) {
    if (["path", "node_options", "node_path", "electron_run_as_node"].includes(key.toLowerCase())) delete env[key];
  }
  env.PATH = `${systemRoot}\\System32;${systemRoot}`;
  const child = spawn(executable, [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`],
    { cwd: temporaryDirectory, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-32_768); });
  const exited = once(child, "exit");
  // spawn 失败也会拒绝 exit 的 Promise；立即接住，保证失败报告与临时目录清理仍执行。
  void exited.catch(() => {});
  let cdp;
  try {
    await once(child, "spawn");
    cdp = await connectDebugger(port, child);
    await waitFor(cdp, "Boolean(document.querySelector('.empty-state') && window.circuitPlatform)", "首次启动空状态和 preload");
    const health = await evaluate(cdp, "window.circuitPlatform.checkEngine()");
    assert.equal(health.status, "ok", JSON.stringify(health));
    assert.equal(await evaluate(cdp, "typeof window.circuitPlatform.killForTest"), "undefined");
    assert.equal(await evaluate(cdp, "getComputedStyle(document.querySelector('.empty-state')).display"), "flex", "生产 CSS 应正确加载");

    // 走正式 preload/IPC/引擎进程，验证独立于 UI 的可观察逻辑结果。
    const simulation = await evaluate(cdp, `(async () => {
      const bridge = window.circuitPlatform.forDocument('packaged-smoke');
      try {
        const input = await bridge.addComponent('input');
        const output = await bridge.addComponent('output');
        const gate = await bridge.addComponent('not');
        await bridge.addConnection({componentId: input.componentId, port: 'out'}, {componentId: gate.componentId, port: 'in'});
        await bridge.addConnection({componentId: gate.componentId, port: 'out'}, {componentId: output.componentId, port: 'in'});
        await bridge.setInput(input.componentId, '0');
        await bridge.settle();
        const high = await bridge.getSignal(output.componentId, 'in');
        await bridge.setInput(input.componentId, '1');
        await bridge.tick();
        const low = await bridge.getSignal(output.componentId, 'in');
        return {high: high.value, low: low.value};
      } finally { await bridge.closeDocument(); }
    })()`);
    assert.deepEqual(simulation, { high: "1", low: "0" });

    const fixture = { version: 2, circuit: { components: [
      { id: "source", kind: "input", displayName: "发布输入", position: { x: 160, y: 160 }, ports: [{ name: "out", direction: "output", width: 1 }], data: { value: "1" } },
      { id: "sink", kind: "output", displayName: "发布输出", position: { x: 480, y: 160 }, ports: [{ name: "in", direction: "input", width: 1 }] },
    ], connections: [{ id: "wire", source: { component: "source", port: "out" }, target: { component: "sink", port: "in" } }] }, definitions: {}, libraryRoots: [] };
    const written = await evaluate(cdp, `window.circuitPlatform.writeProjectFile(${JSON.stringify(projectPath)}, ${JSON.stringify(JSON.stringify(fixture))})`);
    assert.equal(written.ok, true);
    assert.deepEqual(JSON.parse(await readFile(projectPath, "utf8")), fixture);
    const recent = [{ path: projectPath, displayName: "安装回归 with spaces.circuit.json", lastUsedAt: Date.now() }];
    await evaluate(cdp, `localStorage.setItem('circuit-platform.recent-projects', ${JSON.stringify(JSON.stringify(recent))})`);
    await cdp.send("Page.reload");
    await waitFor(cdp, "Boolean(document.querySelector('.recent-projects-item'))", "保存后重开入口");
    await evaluate(cdp, "document.querySelector('.recent-projects-item').click()");
    await waitFor(cdp, "document.querySelectorAll('.circuit-node:not(.circuit-node--pending)').length === 2 && document.querySelector('button[title=\"推进一个 tick (F7)\"]')?.disabled === false", "生产界面打开已保存工程");
    await evaluate(cdp, "document.querySelector('button[title=\"推进一个 tick (F7)\"]').click()");
    await waitFor(cdp, "document.querySelector('.run-step')?.textContent.includes('第 1 步')", "界面真实单步");
    await evaluate(cdp, "document.querySelector('.rail-button[aria-label=\"输入设置\"]').click()");
    await waitFor(cdp, "document.querySelector('.input-bit--high')?.disabled === false", "已保存输入值为 1");
    await evaluate(cdp, "document.querySelector('.input-bit--high').click()");
    await waitFor(cdp, "Boolean(document.querySelector('.input-bit--low') && document.querySelector('.document-tab__dirty'))", "输入变更产生未保存状态");
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 });
    const saveDeadline = Date.now() + 10_000;
    while ((await readFile(projectPath, "utf8")) === JSON.stringify(fixture) && Date.now() < saveDeadline) await delay(100);
    assert.notEqual(await readFile(projectPath, "utf8"), JSON.stringify(fixture), "Ctrl+S 应走正式序列化与原子保存");
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    assert.equal(saved.version, 2);
    assert.equal(saved.circuit.components.find((component) => component.id === "source").data.value, "0", "界面输入变更应实际落盘");
    assert.deepEqual(await evaluate(cdp, "[...document.querySelectorAll('[role=alert]')].map(node => node.textContent.trim()).filter(Boolean)"), []);
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifactDirectory, "packaged-smoke.png"), Buffer.from(screenshot.data, "base64"));
    await cdp.send("Browser.close").catch(() => {});
    let shutdownTimer;
    const [exitCode] = await Promise.race([exited, new Promise((_resolve, reject) => {
      shutdownTimer = setTimeout(() => reject(new Error("安装版退出超时")), 10_000);
    })]).finally(() => clearTimeout(shutdownTimer));
    assert.equal(exitCode, 0);
    const logs = await readFile(join(profile, "logs", "circuit-platform.log"), "utf8");
    assert.ok(logs.includes('"event":"app_start"') && logs.includes('"event":"app_quit"'), "启动与退出必须留有诊断证据");
    assert.ok(!logs.includes(projectPath) && !logs.includes("发布输入"), "日志不能包含工程内容或文件路径");
    const report = { passed: true, executable, simulation, fileRoundtrip: true, uiStep: true, uiSave: true, cleanPath: true, productionOverridesIgnored: true, timestamp: new Date().toISOString() };
    await writeFile(join(artifactDirectory, "packaged-smoke.json"), `${JSON.stringify(report, null, 2)}\n`);
    await rm(join(artifactDirectory, "packaged-smoke-error.log"), { force: true });
    console.log("Packaged application smoke passed", JSON.stringify(report));
  } catch (error) {
    await writeFile(join(artifactDirectory, "packaged-smoke-error.log"), `${error.stack}\n${output}`);
    throw error;
  } finally {
    cdp?.socket.close();
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([exited.catch(() => {}), delay(5000)]);
    }
    // 只回收本次 mkdtemp 创建的目录，绝不触及安装目录或真实用户配置。
    const tempRelative = relative(resolve(tmpdir()), resolve(temporaryDirectory));
    assert.ok(!isAbsolute(tempRelative) && !tempRelative.startsWith("..") && dirname(tempRelative) === "." && tempRelative.startsWith("circuitplatform-packaged-"));
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
