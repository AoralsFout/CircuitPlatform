import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { signalStateClass } from "../src/editor/signal-state.ts";

const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** 位宽为 1 时，逐字符比较与整值比较必须逐字等价——这是「既有电路外观不变」的判据。 */
test("a one bit signal is classified exactly as it was before", () => {
  // 改造前的那份实现，原样抄在这里当作等价性的参照。
  const previous = (value: string): string => {
    if (value === "1") return "signal-state--high";
    if (value === "0") return "signal-state--low";
    return "signal-state--unknown";
  };

  for (const value of ["0", "1", "X", "", "01", "00", "11"]) {
    if (value.length > 1) continue;
    assert.equal(signalStateClass(value), previous(value), JSON.stringify(value));
  }

  assert.equal(signalStateClass("0"), "signal-state--low");
  assert.equal(signalStateClass("1"), "signal-state--high");
  assert.equal(signalStateClass("X"), "signal-state--unknown");
});

/** 多位值按整值判档：全 0 是低、全 1 是高，含未知位或高低混合落到未知。 */
test("a multi bit signal is classified by the whole value", () => {
  // 完全确定的总线不再被染成未知：这条值里一个 X 都没有。
  assert.equal(signalStateClass("00000000"), "signal-state--low");
  assert.equal(signalStateClass("11111111"), "signal-state--high");
  assert.equal(signalStateClass("0"), "signal-state--low");

  // 只要有一位未知，整条就没有确定的电平。
  assert.equal(signalStateClass("10X00000"), "signal-state--unknown");
  assert.equal(signalStateClass("X"), "signal-state--unknown");
  assert.equal(signalStateClass("XXXX"), "signal-state--unknown");

  // 高低混合的总线同样没有单一电平。
  assert.equal(signalStateClass("10101010"), "signal-state--unknown");
  assert.equal(signalStateClass("00010000"), "signal-state--unknown");

  // 空串不是合法的信号值，落到未知而不是在一片空里得出「全 1」。
  assert.equal(signalStateClass(""), "signal-state--unknown");
});

/** 档位只有这一处实现：两个组件都必须导入它，而不是各写一份逐字相同的副本。 */
test("the signal state mapping has a single implementation", async () => {
  const consumers = ["CircuitCanvas.vue", "BottomPanel.vue"];
  for (const name of consumers) {
    const source = await readFile(join(desktopRoot, "src", "components", name), "utf8");
    assert.match(source, /import \{ signalStateClass \} from "\.\.\/editor\/signal-state\.ts"/, name);
    // 组件里不再有本地的同名实现，也不再有直接比较 "0" / "1" 的档位判定。
    assert.doesNotMatch(source, /function signalClass/, name);
    assert.doesNotMatch(source, /return "signal-state--(high|low|unknown)"/, name);
  }
});
