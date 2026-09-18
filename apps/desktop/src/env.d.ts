/// <reference types="vite/client" />

import type { ComponentKindName, EngineResponse, Signal } from "@circuit-platform/protocol";

declare global {
  interface Window {
    circuitPlatform: {
      checkEngine: () => Promise<{
        status: "ok" | "error" | "unavailable";
        message?: string;
        engine?: string;
      }>;
      addComponent: (kind: ComponentKindName) => Promise<EngineResponse>;
      addConnection: (
        source: { componentId: number; port: string },
        target: { componentId: number; port: string },
      ) => Promise<EngineResponse>;
      removeComponent: (componentId: number) => Promise<EngineResponse>;
      removeConnection: (connectionId: number) => Promise<EngineResponse>;
      setInput: (componentId: number, value: Signal) => Promise<EngineResponse>;
      settle: () => Promise<EngineResponse>;
      tick: () => Promise<EngineResponse>;
      getSignal: (componentId: number, port: string) => Promise<EngineResponse>;
    };
  }
}
