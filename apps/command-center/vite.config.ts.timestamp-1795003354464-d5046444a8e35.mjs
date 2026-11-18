// vite.config.ts
import { defineConfig } from "file:///C:/Users/Phemelo%20Mashome/OneDrive%20-%20Sol%20Plaatje%20University/Desktop/PMS/post-mine-sentinel/apps/command-center/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/Phemelo%20Mashome/OneDrive%20-%20Sol%20Plaatje%20University/Desktop/PMS/post-mine-sentinel/apps/command-center/node_modules/@vitejs/plugin-react/dist/index.mjs";
import { fileURLToPath, URL } from "node:url";
var __vite_injected_original_import_meta_url = "file:///C:/Users/Phemelo%20Mashome/OneDrive%20-%20Sol%20Plaatje%20University/Desktop/PMS/post-mine-sentinel/apps/command-center/vite.config.ts";
var dataDir = fileURLToPath(new URL("../../data", __vite_injected_original_import_meta_url));
var vite_config_default = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", __vite_injected_original_import_meta_url)),
      "@data": dataDir
    }
  },
  server: {
    port: 5173,
    // The canonical datasets live in /data at the repo root (shared with the API seed).
    fs: { allow: [".", dataDir] },
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws": { target: "ws://localhost:8000", ws: true }
    }
  },
  build: {
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          r3f: ["@react-three/fiber", "@react-three/drei", "@react-three/postprocessing", "postprocessing"],
          charts: ["recharts"]
        }
      }
    }
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxQaGVtZWxvIE1hc2hvbWVcXFxcT25lRHJpdmUgLSBTb2wgUGxhYXRqZSBVbml2ZXJzaXR5XFxcXERlc2t0b3BcXFxcUE1TXFxcXHBvc3QtbWluZS1zZW50aW5lbFxcXFxhcHBzXFxcXGNvbW1hbmQtY2VudGVyXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxQaGVtZWxvIE1hc2hvbWVcXFxcT25lRHJpdmUgLSBTb2wgUGxhYXRqZSBVbml2ZXJzaXR5XFxcXERlc2t0b3BcXFxcUE1TXFxcXHBvc3QtbWluZS1zZW50aW5lbFxcXFxhcHBzXFxcXGNvbW1hbmQtY2VudGVyXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy9QaGVtZWxvJTIwTWFzaG9tZS9PbmVEcml2ZSUyMC0lMjBTb2wlMjBQbGFhdGplJTIwVW5pdmVyc2l0eS9EZXNrdG9wL1BNUy9wb3N0LW1pbmUtc2VudGluZWwvYXBwcy9jb21tYW5kLWNlbnRlci92aXRlLmNvbmZpZy50c1wiOy8vLyA8cmVmZXJlbmNlIHR5cGVzPVwidml0ZXN0XCIgLz5cbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnO1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0JztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGgsIFVSTCB9IGZyb20gJ25vZGU6dXJsJztcblxuY29uc3QgZGF0YURpciA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi4vLi4vZGF0YScsIGltcG9ydC5tZXRhLnVybCkpO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgJ0AnOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4vc3JjJywgaW1wb3J0Lm1ldGEudXJsKSksXG4gICAgICAnQGRhdGEnOiBkYXRhRGlyLFxuICAgIH0sXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDUxNzMsXG4gICAgLy8gVGhlIGNhbm9uaWNhbCBkYXRhc2V0cyBsaXZlIGluIC9kYXRhIGF0IHRoZSByZXBvIHJvb3QgKHNoYXJlZCB3aXRoIHRoZSBBUEkgc2VlZCkuXG4gICAgZnM6IHsgYWxsb3c6IFsnLicsIGRhdGFEaXJdIH0sXG4gICAgcHJveHk6IHtcbiAgICAgICcvYXBpJzogeyB0YXJnZXQ6ICdodHRwOi8vbG9jYWxob3N0OjgwMDAnLCBjaGFuZ2VPcmlnaW46IHRydWUgfSxcbiAgICAgICcvd3MnOiB7IHRhcmdldDogJ3dzOi8vbG9jYWxob3N0OjgwMDAnLCB3czogdHJ1ZSB9LFxuICAgIH0sXG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgY2h1bmtTaXplV2FybmluZ0xpbWl0OiAxODAwLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIG91dHB1dDoge1xuICAgICAgICBtYW51YWxDaHVua3M6IHtcbiAgICAgICAgICB0aHJlZTogWyd0aHJlZSddLFxuICAgICAgICAgIHIzZjogWydAcmVhY3QtdGhyZWUvZmliZXInLCAnQHJlYWN0LXRocmVlL2RyZWknLCAnQHJlYWN0LXRocmVlL3Bvc3Rwcm9jZXNzaW5nJywgJ3Bvc3Rwcm9jZXNzaW5nJ10sXG4gICAgICAgICAgY2hhcnRzOiBbJ3JlY2hhcnRzJ10sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG4gIHRlc3Q6IHtcbiAgICBlbnZpcm9ubWVudDogJ25vZGUnLFxuICAgIGluY2x1ZGU6IFsnc3JjLyoqLyoudGVzdC50cyddLFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQ0EsU0FBUyxvQkFBb0I7QUFDN0IsT0FBTyxXQUFXO0FBQ2xCLFNBQVMsZUFBZSxXQUFXO0FBSGdULElBQU0sMkNBQTJDO0FBS3BZLElBQU0sVUFBVSxjQUFjLElBQUksSUFBSSxjQUFjLHdDQUFlLENBQUM7QUFFcEUsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssY0FBYyxJQUFJLElBQUksU0FBUyx3Q0FBZSxDQUFDO0FBQUEsTUFDcEQsU0FBUztBQUFBLElBQ1g7QUFBQSxFQUNGO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUE7QUFBQSxJQUVOLElBQUksRUFBRSxPQUFPLENBQUMsS0FBSyxPQUFPLEVBQUU7QUFBQSxJQUM1QixPQUFPO0FBQUEsTUFDTCxRQUFRLEVBQUUsUUFBUSx5QkFBeUIsY0FBYyxLQUFLO0FBQUEsTUFDOUQsT0FBTyxFQUFFLFFBQVEsdUJBQXVCLElBQUksS0FBSztBQUFBLElBQ25EO0FBQUEsRUFDRjtBQUFBLEVBQ0EsT0FBTztBQUFBLElBQ0wsdUJBQXVCO0FBQUEsSUFDdkIsZUFBZTtBQUFBLE1BQ2IsUUFBUTtBQUFBLFFBQ04sY0FBYztBQUFBLFVBQ1osT0FBTyxDQUFDLE9BQU87QUFBQSxVQUNmLEtBQUssQ0FBQyxzQkFBc0IscUJBQXFCLCtCQUErQixnQkFBZ0I7QUFBQSxVQUNoRyxRQUFRLENBQUMsVUFBVTtBQUFBLFFBQ3JCO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxNQUFNO0FBQUEsSUFDSixhQUFhO0FBQUEsSUFDYixTQUFTLENBQUMsa0JBQWtCO0FBQUEsRUFDOUI7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
