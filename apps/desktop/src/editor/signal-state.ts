import type { Signal } from "@circuit-platform/protocol";

/**
 * 一个信号值在界面上属于哪一档语义状态。
 *
 * 档位按**整值**判定：全 `0` 是低、全 `1` 是高，其余（含任何未知位，也含高低混合的总线）
 * 落到未知一档。逐位文本才是权威读数，档位只负责给它上色，因此一条既不是全 0 也不是全 1 的
 * 总线没有单一的「电平」，只能算未知。
 *
 * **位宽为 1 时这与「确定的 0 / 确定的 1 / 其余」逐字等价**，既有电路的画布外观因此不变。
 * 位宽大于 1 时两者才分道：`00000000` 是一条完全确定的总线，把它染成「未知」是在说谎——
 * `X` 在领域里的含义就是「未知」，而这条值里一个 `X` 都没有。
 *
 * 这一段此前在 `BottomPanel.vue` 与 `CircuitCanvas.vue` 里各写了一遍，函数体逐字相同而注释
 * 互相矛盾，于是两边对 `00000000` 的说法迟早会分叉。合成一处之后档位只有这一个定义。
 * @param value 端口当前的信号值，逐位文本。
 * @returns 与 `styles.css` 里的 `signal-state--*` 类名之一。
 */
export function signalStateClass(value: Signal): string {
  // 空串不是合法的信号值（`isSignal` 要求非空），落到未知而不是让「全都不含 X」的判定
  // 在一片空里得出「全 1」或「全 0」。
  if (value.length > 0 && !value.includes("X")) {
    if (!value.includes("0")) return "signal-state--high";
    if (!value.includes("1")) return "signal-state--low";
  }

  return "signal-state--unknown";
}
