import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  optimizeDeps: {
    // Three.js TSL uses module-level singletons (currentStack, nodeCache, etc.)
    // that MUST be shared across all sub-path imports. Never use deep-path
    // imports like 'three/src/renderers/...' — they cause Vite to create
    // separate chunks with duplicate singletons, crashing positionLocal.assign().
    include: [
      'three',
      'three/tsl',
      'three/webgpu',
    ],
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) {
            return 'three';
          }
          if (id.includes('node_modules/troika-')) {
            return 'troika';
          }
        },
      },
    },
  },
});
