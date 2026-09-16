export const WIRE_COLOR_PRESETS = [
  { id: "blue", label: "电气蓝" },
  { id: "cyan", label: "示波青" },
  { id: "green", label: "板卡绿" },
  { id: "violet", label: "探针紫" },
  { id: "pink", label: "标记粉" },
] as const;

export type WireColorId = (typeof WIRE_COLOR_PRESETS)[number]["id"];

export const DEFAULT_WIRE_COLOR: WireColorId = "blue";
export const DEFAULT_WIRE_COLOR_STORAGE_KEY = "circuit-platform.default-wire-color";

/** 判断持久化或文档中的值是否为受支持的 Wire 预设色。 */
export function isWireColorId(value: unknown): value is WireColorId {
  return WIRE_COLOR_PRESETS.some((preset) => preset.id === value);
}

/** 读取新建 Wire 的默认预设色；存储不可用或值无效时回退到电气蓝。 */
export function readDefaultWireColor(storage: Storage | null): WireColorId {
  if (!storage) return DEFAULT_WIRE_COLOR;
  try {
    const value = storage.getItem(DEFAULT_WIRE_COLOR_STORAGE_KEY);
    return isWireColorId(value) ? value : DEFAULT_WIRE_COLOR;
  } catch {
    return DEFAULT_WIRE_COLOR;
  }
}

/** 保存并返回新建 Wire 的默认预设色；存储不可用时仍更新当前会话。 */
export function writeDefaultWireColor(storage: Storage | null, color: WireColorId): WireColorId {
  try {
    storage?.setItem(DEFAULT_WIRE_COLOR_STORAGE_KEY, color);
  } catch {
    // 隐私模式或禁用存储时，调用方仍可在当前内存会话使用返回值。
  }
  return color;
}
