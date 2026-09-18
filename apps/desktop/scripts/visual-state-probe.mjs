import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 多位电路截图状态的 DOM 层断言。
 *
 * 截图基线在这台机器上不可重复：同一份代码连跑两次，40 张截图里 35 张的 sha256 不同（文件只差
 * 几十字节），因此 `manifest.json` 里的哈希不能当作逐位基线，也就不具备回归检测能力。本脚本补的
 * 正是这一块：它不比对图片，而是把每个状态真正渲染出来的 DOM 事实取出来逐条断言——端口的位区间
 * 标签、`data-signal`、按位按钮的 `data-value`、检查器里可编辑属性的当前值。
 *
 * 状态本身由夹具用真实 DOM 交互产生，本脚本只读结果，不构造任何节点。
 */

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function waitForServer(url, timeoutMs = 15_000) {
  const startedAt = Date.now();
  return new Promise((resolvePromise, reject) => {
    const poll = async () => {
      try {
        const response = await fetch(url);
        if (response.ok) return resolvePromise();
      } catch {
        // Vite is still starting.
      }
      if (Date.now() - startedAt > timeoutMs) return reject(new Error(`Vite did not start at ${url}`));
      setTimeout(poll, 100);
    };
    void poll();
  });
}

/** 在页面里把该状态渲染出的 DOM 事实收集成一个普通对象；不在此处做断言。 */
const COLLECT = `(async () => {
  const text = (element) => element ? element.textContent.trim() : null;
  const nodes = [...document.querySelectorAll(".circuit-node")].map((node) => ({
    kind: text(node.querySelector("strong")),
    ports: [...node.querySelectorAll(".node-port")].map((port) => ({
      id: port.dataset.portId,
      label: text(port.querySelector(".node-port__label")),
      signal: port.dataset.signal,
      state: [...port.classList].find((name) => name.startsWith("signal-state--")) ?? null,
    })),
  }));
  const bitGroups = [...document.querySelectorAll(".input-setting")].map((setting) => ({
    label: text(setting.querySelector(".input-setting-copy strong")),
    width: text(setting.querySelector(".input-setting-copy small")),
    value: text(setting.querySelector(".input-setting-value")),
    expanded: setting.querySelector(".input-setting-disclosure")?.getAttribute("aria-expanded") ?? null,
    bits: [...setting.querySelectorAll(".input-bit")].map((bit) => ({
      index: bit.dataset.bit,
      place: bit.dataset.bitPlace,
      value: bit.dataset.value,
      state: [...bit.classList].find((name) => name.startsWith("input-bit--")) ?? null,
    })),
  }));
  const attributeValues = [...document.querySelectorAll(".inspector-attributes label")].map((label) => ({
    label: text(label.querySelector("span")),
    value: label.querySelector("input")?.value ?? null,
    type: label.querySelector("input")?.getAttribute("type") ?? null,
  }));
  return {
    nodeKinds: nodes.map((node) => node.kind),
    ports: nodes.flatMap((node) => node.ports.map((port) => ({ kind: node.kind, ...port }))),
    portLabels: nodes.flatMap((node) => node.ports.map((port) => port.label)),
    wireSignals: [...document.querySelectorAll(".wire-signal-label")].map((label) => text(label)),
    bitGroups,
    attributeValues,
    inspectorPortRows: [...document.querySelectorAll(".inspector-port-row")].map((row) => text(row)),
    railPage: document.querySelector(".sidebar-heading h1")?.textContent?.trim() ?? null,
  };
})()`;

/** 依次执行断言，把失败原因收集起来一起报，而不是第一条就中断。 */
function check(failures, condition, message) {
  if (!condition) failures.push(message);
}

/** 每个状态一条断言集：只断言「这个状态确实渲染成了它该有的样子」。 */
const expectations = {
  "bus-canvas": (facts, failures) => {
    check(failures, facts.nodeKinds.includes("SPLITTER"), "画布上没有拆线器");
    check(failures, facts.nodeKinds.includes("MERGER"), "画布上没有合线器");
    // 位区间标注：8 位总线端口显示 `out[7:0]`，1 位端口仍然只显示端口名。
    check(failures, facts.portLabels.includes("out[7:0]"), `没有 out[7:0] 位区间标注，实际有 ${facts.portLabels.join(", ")}`);
    // 逐位二进制文本：最高位拨成 1、第 5 位设为 X，总线上因此是 10X00000 而不是一整条 X。
    const bus = facts.ports.find((port) => port.kind === "INPUT" && port.id === "out");
    check(failures, bus?.signal === "10X00000", `Input 的读数应为 10X00000，实际是 ${bus?.signal}`);
    check(failures, bus?.state === "signal-state--unknown", `混合 0/1/X 的读数应落到未知一档，实际是 ${bus?.state}`);
    check(
      failures,
      facts.wireSignals.includes("10X00000"),
      `连线上没有逐位二进制文本，实际有 ${JSON.stringify(facts.wireSignals)}`,
    );
  },
  "bus-inspector": (facts, failures) => {
    const width = facts.attributeValues.find((attribute) => attribute.type === "number");
    check(failures, width !== undefined, "检查器里没有位宽数字输入框");
    check(failures, width?.value === "8", `位宽输入框的值应为 8，实际是 ${width?.value}`);
    check(
      failures,
      facts.inspectorPortRows.some((row) => row.includes("8 位")),
      `检查器的端口行没有报出位宽，实际有 ${JSON.stringify(facts.inspectorPortRows)}`,
    );
  },
  "bus-ranges": (facts, failures) => {
    const ranges = facts.attributeValues.find((attribute) => attribute.type === "text");
    check(failures, ranges !== undefined, "检查器里没有位区间文本输入框");
    check(failures, ranges?.value === "7:4, 3:0", `位区间列表应为 7:4, 3:0，实际是 ${ranges?.value}`);
    // 提交之后两条分支的位区间标注跟着清单走。
    check(failures, facts.portLabels.includes("out0[7:4]"), `没有 out0[7:4]，实际有 ${facts.portLabels.join(", ")}`);
    check(failures, facts.portLabels.includes("out1[3:0]"), `没有 out1[3:0]，实际有 ${facts.portLabels.join(", ")}`);
  },
  "bus-bits-expanded": (facts, failures) => {
    const group = facts.bitGroups[0];
    check(failures, facts.railPage === "输入设置", `侧栏停在第 ${facts.railPage} 页，不是输入设置`);
    check(failures, group?.expanded === "true", "位按钮组没有展开");
    check(failures, group?.width === "SOURCE / 8 bit", `位宽文案应为 SOURCE / 8 bit，实际是 ${group?.width}`);
    check(failures, group?.bits.length === 8, `8 位输入应有 8 个位按钮，实际有 ${group?.bits.length}`);
    check(
      failures,
      group?.bits.map((bit) => bit.value).join("") === "010X0000",
      `位按钮的取值应为 010X0000，实际是 ${group?.bits.map((bit) => bit.value).join("")}`,
    );
    check(
      failures,
      group?.bits.filter((bit) => bit.state === "input-bit--unknown").length === 1,
      "只有被设为 X 的那一位应当落到未知档位",
    );
    // 位序号从高到低：第一位是最高位。
    check(failures, group?.bits[0]?.place === "7", `第一位应是第 7 位，实际是 ${group?.bits[0]?.place}`);
  },
  "bus-bits-collapsed": (facts, failures) => {
    const group = facts.bitGroups[0];
    check(failures, group?.expanded === "false", "位按钮组没有收起");
    check(failures, group?.bits.length === 0, "收起之后不应再渲染位按钮");
    // 收起只藏起按钮组，取值本身仍然照旧显示在标题行上。
    check(failures, group?.value === "010X0000", `收起后标题行的取值应为 010X0000，实际是 ${group?.value}`);
  },
  "bus-bit-single": (facts, failures) => {
    check(failures, facts.bitGroups.length === 2, `默认电路有两个 Input，实际有 ${facts.bitGroups.length} 个`);
    for (const group of facts.bitGroups) {
      check(failures, group.width === "SOURCE / 1 bit", `1 位输入应显示 SOURCE / 1 bit，实际是 ${group.width}`);
      check(failures, group.bits.length === 1, `1 位输入应只有一个位按钮，实际有 ${group.bits.length}`);
      check(failures, group.bits[0]?.place === "0", `1 位输入的位序号应是 0，实际是 ${group.bits[0]?.place}`);
    }
    // 第一个 1 位 Input 的初值是 "1"（`inputA` 兼容投影），点一下应当翻成 "0"。
    // 这一条同时守住「点下去真的生效」：按钮被禁用或点击落空时它会停在 "1"。
    check(failures, facts.bitGroups[0].value === "0", `点击最高位之后取值应为 0，实际是 ${facts.bitGroups[0].value}`);
    check(failures, facts.bitGroups[0].bits[0]?.value === "0", "位按钮上的文本没有跟上取值");
    check(failures, facts.bitGroups[0].bits[0]?.state === "input-bit--low", "取 0 的位应落到低档位");
  },
};

async function main() {
  // 与视觉截图（4175）和性能基准（4176–4180）都错开，两者同时跑也不会抢端口。
  const port = 4181;
  // 这三项必须在 app ready 之前设置，否则会被忽略或直接报错。
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("no-sandbox");
  const vite = await createServer({ root: desktopRoot, server: { host: "127.0.0.1", port, strictPort: true } });
  try {
    await vite.listen();
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(`${baseUrl}/visual-regression.html`);
    await app.whenReady();
    const window = new BrowserWindow({
      show: true,
      width: 1440,
      height: 900,
      webPreferences: { sandbox: true, backgroundThrottling: false },
    });
    const results = [];
    const failures = [];
    for (const [state, expect] of Object.entries(expectations)) {
      await window.loadURL(`${baseUrl}/visual-regression.html?state=${state}&theme=dark`);
      await window.webContents.executeJavaScript(
        "new Promise((resolve, reject) => { const started = Date.now(); const check = () => {"
        + " if (window.__visualError) return reject(new Error(`视觉夹具准备失败：${window.__visualError}`));"
        + " if (document.querySelector('.app-shell') && window.__visualReady) return resolve(true);"
        + " if (Date.now() - started > 20000) return reject(new Error('真实 Vue App 未完成准备'));"
        + " setTimeout(check, 50); }; check(); })",
      );
      const facts = await window.webContents.executeJavaScript(COLLECT);
      const stateFailures = [];
      expect(facts, stateFailures);
      results.push({ state, ok: stateFailures.length === 0, failures: stateFailures });
      failures.push(...stateFailures.map((message) => `${state}：${message}`));
    }
    console.log(JSON.stringify({ states: results.map(({ state, ok }) => ({ state, ok })) }, null, 2));
    if (failures.length > 0) {
      throw new Error(`多位电路截图状态未渲染成预期：\n- ${failures.join("\n- ")}`);
    }
    console.log(`Visual state probe passed for ${results.length} states`);
  } finally {
    await vite.close();
    if (app.isReady()) app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
