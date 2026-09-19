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
  const unsavedDialog = document.querySelector('.confirmation-dialog[role="alertdialog"]');
  const emptyState = document.querySelector(".empty-state");
  const recentItems = [...document.querySelectorAll(".recent-projects-item")].map((item) => ({
    name: text(item.querySelector(".recent-projects-name")),
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
    emptyState: emptyState === null
      ? null
      : {
          recentItems: recentItems.length,
          recentFirst: recentItems[0]?.name ?? null,
        },
    unsavedDialog: unsavedDialog === null
      ? null
      : {
          title: text(unsavedDialog.querySelector("h2")),
          confirmText: text(unsavedDialog.querySelector("button.dialog-button--danger")),
        },
  };
})()`;

/** 依次执行断言，把失败原因收集起来一起报，而不是第一条就中断。 */
function check(failures, condition, message) {
  if (!condition) failures.push(message);
}

/** 探针在收集事实之前发出的真实输入，结果按状态名挂在这里，随后并进 facts。 */
const measurements = {};

/**
 * 焦点落在位按钮上按 Space。
 *
 * 这里做两件事，各自钉住一半：
 *
 * 1. **默认动作有没有被取消。** 原生按钮的 Space 激活只在 `keydown` 没有被 `preventDefault()`
 *    时发生，因此「按下去会不会切换」这件事可以精确地在 `dispatchEvent` 的返回值上读出来——
 *    它返回 false 就说明有人把默认动作取消了。派发合成 `KeyboardEvent` 不会触发原生激活，
 *    所以这一步测的是取消与否，而不是取值变化。
 * 2. **真实输入。** `webContents.sendInputEvent` 走的是浏览器自己的输入管线，默认动作会被执行，
 *    因此它测的是端到端的那一击。这是本缺陷当初漏掉的那一类验证：只读源码或只断言 DOM 结构，
 *    都看不出「默认动作被窗口级处理器吃掉」。
 *
 * 顺带把画布作用域的同名按键也测一遍：同一个合成事件落在画布上必须被画布认领，否则修复会
 * 把画布的 Space（草稿轴向、平移修饰）一起改掉。
 */
async function pressSpaceOnFocusedBit(window) {
  const measured = await window.webContents.executeJavaScript(`(async () => {
    const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let button = null;
    // 位按钮由 canToggleInput 决定是否禁用，而它要求引擎绑定已经就绪。直接按在禁用按钮上
    // 什么都不会发生，画面停在默认值上而探针不会报错。
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const candidate = document.querySelectorAll(".input-bit")[0];
      if (candidate && !candidate.disabled) { button = candidate; break; }
      await settle(25);
    }
    if (!button) return { error: "位按钮一直不可用" };

    button.focus();
    if (document.activeElement !== button) return { error: "位按钮没有拿到焦点" };

    const valueOf = () => document.querySelector(".input-setting-value")?.textContent?.trim() ?? null;
    const before = valueOf();

    // dispatchEvent 返回 !event.defaultPrevented：false 就是默认动作被取消了。
    const defaultActionSurvives = button.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
    );

    // 画布作用域：同一个合成 Space 落在画布上应当被画布认领（返回 false 即被 preventDefault）。
    const canvas = document.querySelector(".circuit-canvas");
    let canvasClaimsSpace = null;
    if (canvas) {
      canvasClaimsSpace = !canvas.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
      );
      // 收尾：画布处理器会把 spacePressed 置真，补一个 keyup 让状态回位。
      canvas.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true }));
    }

    return { before, defaultActionSurvives, canvasClaimsSpace };
  })()`);

  // sendInputEvent 需要窗口处于聚焦状态；探针窗口是 show: true 的。
  window.focus();
  window.webContents.focus();
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: " " });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: " " });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const afterReal = await window.webContents.executeJavaScript(
    `(() => {
      const setting = document.querySelector(".input-setting");
      const bits = [...(setting?.querySelectorAll(".input-bit") ?? [])].map((bit) => bit.dataset.value);
      return {
        value: document.querySelector(".input-setting-value")?.textContent?.trim() ?? null,
        bits: bits.join(""),
      };
    })()`,
  );

  measurements["bus-bit-space"] = { spaceProbe: { ...measured, afterReal: afterReal.value, afterRealBits: afterReal.bits } };
}

/** 需要真实输入才能验证的状态；其余状态由夹具自己的 DOM 交互摆好。 */
const interactions = {
  "bus-bit-space": pressSpaceOnFocusedBit,
};

/** 每个状态一条断言集：只断言「这个状态确实渲染成了它该有的样子」。 */
const expectations = {
  "unsaved-confirm": (facts, failures) => {
    check(failures, facts.unsavedDialog !== null, "置脏后新建应呈现未保存确认对话框");
    check(failures, facts.unsavedDialog?.title === "新建文档？", `对话框标题不符：${facts.unsavedDialog?.title}`);
    check(failures, typeof facts.unsavedDialog?.confirmText === "string" && facts.unsavedDialog.confirmText.length > 0, "对话框缺少放弃操作的确认按钮");
  },
  "first-start-recent": (facts, failures) => {
    check(failures, facts.emptyState !== null, "首启应渲染空状态面板");
    check(failures, facts.emptyState?.recentItems === 2, `最近项目列表应有 2 条，实际是 ${facts.emptyState?.recentItems}`);
    check(failures, facts.emptyState?.recentFirst === "八位加法器.circuit.json", `最近使用的一项应排在最前，实际是 ${facts.emptyState?.recentFirst}`);
  },
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
  "bus-bit-space": (facts, failures) => {
    const probe = facts.spaceProbe;
    check(failures, facts.railPage === "输入设置", `侧栏停在第 ${facts.railPage} 页，不是输入设置`);
    check(failures, probe !== undefined, "探针没有拿到 Space 的测量结果");

    // 焦点在位按钮上时，这个键属于输入设置作用域：默认动作必须活下来，原生按钮才能激活。
    check(
      failures,
      probe?.defaultActionSurvives === true,
      "焦点在位按钮上按 Space 时 keydown 被 preventDefault 了，原生按钮的激活语义因此失效",
    );
    // 真实输入那一击：0 位应当翻成 1。
    check(failures, probe?.afterReal === "10000000", `真实 Space 没有切换聚焦位，整组取值是 ${probe?.afterReal}`);
    check(failures, probe?.afterRealBits === "10000000", `位按钮上的文本没有跟上，实际是 ${probe?.afterRealBits}`);
    // 画布作用域的同名按键没有被这次修复带走。
    check(
      failures,
      probe?.canvasClaimsSpace === true,
      "画布不再认领 Space：落焦在画布上的 Space 没有被 preventDefault，布线草稿的轴向切换会跟着失效",
    );
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
      const interaction = interactions[state];
      if (interaction) await interaction(window);
      const facts = await window.webContents.executeJavaScript(COLLECT);
      Object.assign(facts, measurements[state] ?? {});
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
