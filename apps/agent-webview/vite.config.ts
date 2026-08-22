import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const isServerDevelopment = mode === "server";
  const environment = loadEnv(mode, process.cwd(), "");
  const serverUrl = environment.UI_FORGE_SERVER_URL ?? "http://127.0.0.1:4310";

  return {
    plugins: [
      react(),
      {
        name: "ui-forge-development-entry",
        apply: "serve",
        transformIndexHtml: (html) => html.replace(
          "/src/main.tsx",
          isServerDevelopment ? "/development/server.tsx" : "/fixtures/dev.tsx",
        ),
      },
    ],
    base: "./",
    ...(isServerDevelopment
      ? {
          server: {
            proxy: {
              "/api": {
                target: serverUrl,
                changeOrigin: true,
              },
            },
          },
        }
      : {}),
    build: {
      outDir: "dist",
      emptyOutDir: true,
      chunkSizeWarningLimit: 700,
    },
  };
});
