import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  // 安装版通过 file:// 加载；资源必须相对 index.html，不能指向文件系统根目录。
  base: "./",
  plugins: [vue(), {
    name: "production-content-security-policy",
    apply: "build",
    // 安装包只运行本地资源；开发服务仍保留 Vite 热更新需要的连接。
    transformIndexHtml() {
      return [{
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'",
        },
        injectTo: "head-prepend",
      }];
    },
  }],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    strictPort: true,
  },
});
