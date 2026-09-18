/// <reference types="vite/client" />

import type { ComponentKindName, EngineResponse, PortSpec, Signal } from "@circuit-platform/protocol";

declare global {
  interface Window {
    circuitPlatform: {
      checkEngine: () => Promise<{
        status: "ok" | "error" | "unavailable";
        message?: string;
        engine?: string;
      }>;
      addComponent: (kind: ComponentKindName, ports?: readonly PortSpec[]) => Promise<EngineResponse>;
      addConnection: (
        source: { componentId: number; port: string },
        target: { componentId: number; port: string },
      ) => Promise<EngineResponse>;
      removeComponent: (componentId: number) => Promise<EngineResponse>;
      removeConnection: (connectionId: number) => Promise<EngineResponse>;
      setInput: (componentId: number, value: Signal) => Promise<EngineResponse>;
      settle: () => Promise<EngineResponse>;
      tick: () => Promise<EngineResponse>;
      reset: () => Promise<EngineResponse>;
      getSignal: (componentId: number, port: string) => Promise<EngineResponse>;
      setPortWidth: (componentId: number, ports: readonly PortSpec[]) => Promise<EngineResponse>;
      /** 保存对话框；用户取消时返回 `reason: "canceled"`，不是错误。 */
      pickSavePath: (options?: { defaultPath?: string }) => Promise<{ ok: true; path: string } | { ok: false; reason: string }>;
      /** 原子写入项目文件；文件系统失败以 `reason` 带回可展示原因。 */
      writeProjectFile: (filePath: string, content: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
    };
  }
}
