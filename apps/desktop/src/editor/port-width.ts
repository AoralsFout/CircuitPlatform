import type { PortSpec } from "@circuit-platform/protocol";
import type { EditorComponent, EditorConnection } from "./index.ts";

/**
 * 在元件的端口清单里查找一个端口。
 * @param component 元件；清单未知时返回 undefined。
 * @param portName 引擎端口名。
 * @returns 端口声明；元件没有清单或端口不在清单里时返回 undefined。
 */
export function portOf(
  component: EditorComponent | undefined,
  portName: string,
): PortSpec | undefined {
  return component?.ports?.find((port) => port.name === portName);
}

/**
 * 判断一条连接的两端位宽是否已经不相同。
 *
 * 这是引擎 `isDangling` 的第二个条件在前端的同一份判定：两端都还解析得到，只是位宽不再相等。
 * 两端任一解析不出来时不在这里下结论——那是「端点缺失」那条路径的事，由编辑器文档的
 * `danglingEndpoints` 表达。
 * @param connection 要判断的编辑器连接。
 * @param components 按编辑器 ID 索引的元件。
 * @returns 两端位宽都能读到且不相等时返回 true。
 */
export function hasWidthMismatch(
  connection: EditorConnection,
  components: ReadonlyMap<string, EditorComponent>,
): boolean {
  const source = portOf(components.get(connection.source.componentId), connection.source.port);
  const target = portOf(components.get(connection.target.componentId), connection.target.port);
  if (!source || !target) return false;
  return source.width !== target.width;
}

/**
 * 判断一条连接在投影中是否算悬空。
 *
 * 悬空只有一种表达——不参与仿真、可查看、可删除、可重接——但有两个来源：端点缺失，或两端
 * 位宽不再相同。两者在画布上因此共用同一套悬空外观，不另造「失效连接」。
 * @param connection 要判断的编辑器连接。
 * @param components 按编辑器 ID 索引的元件。
 * @returns 满足任一悬空条件时返回 true。
 */
export function isProjectedDangling(
  connection: EditorConnection,
  components: ReadonlyMap<string, EditorComponent>,
): boolean {
  return connection.danglingEndpoints.length > 0 || hasWidthMismatch(connection, components);
}
