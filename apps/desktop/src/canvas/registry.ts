export {
  ComponentDefinitionRegistry,
  componentGeometryFor,
  createComponentDefinitionRegistry,
  DEFAULT_COMPONENT_DEFINITIONS,
  defaultComponentDefinitionRegistry,
  type ComponentDefinition,
  type ComponentGeometry,
  type PortLayout,
  // 显式带上扩展名：这份薄壳要被 Node 的 strip-types 加载器直接引入（编辑器会话从它取元件
  // 展示定义），而按目录名找 `index` 是打包器才认的写法。
} from "./index.ts";
