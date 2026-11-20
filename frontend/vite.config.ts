import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: "autoUpdate",

      includeAssets: ["favicon.ico"],

      manifest: {
        name: "AFTERGRID — Emergency Resilience Network",
        short_name: "AFTERGRID",
        description:
          "Offline-first humanitarian emergency coordination",

        theme_color: "#0e1728",
        background_color: "#080e1b",

        display: "standalone",
        start_url: "/",
        scope: "/",

        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },

      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        navigateFallback: "/index.html",
      },
    }),
  ],
});