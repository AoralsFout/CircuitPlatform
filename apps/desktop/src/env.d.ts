/// <reference types="vite/client" />

interface Window {
  circuitPlatform: {
    checkEngine: () => Promise<{
      status: "ok" | "error" | "unavailable";
      message?: string;
      engine?: string;
    }>;
  };
}
