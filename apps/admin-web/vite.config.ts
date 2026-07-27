import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

export default defineConfig({
  plugins: [
    vue(),
    Components({
      dts: false,
      resolvers: [
        ElementPlusResolver({
          importStyle: false,
        }),
      ],
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/oss-assets': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/guidance-defaults': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return;
          }

          if (id.includes('@element-plus/icons-vue')) {
            return 'element-plus-icons';
          }

          if (id.includes('element-plus')) {
            return 'element-plus';
          }

          if (id.includes('node_modules/vue-router')) {
            return 'vue-router';
          }

          if (id.includes('node_modules/vue') || id.includes('node_modules/@vue')) {
            return 'vue-core';
          }

          if (id.includes('axios')) {
            return 'network';
          }
        },
      },
    },
  },
});
