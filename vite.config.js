import { defineConfig } from 'vite';

// Google Drive can emit invalid watcher events for files that are being edited.
// QA reloads the page explicitly after each build, so disabling the dev watcher
// keeps the local loop stable without changing the production bundle.
export default defineConfig({
  server: {
    host: '0.0.0.0',
    watch: null,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
