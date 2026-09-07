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
    // 本地管理端只绑定回环地址并严格占用 5173；避免与其他项目的 Vite 服务
    // 同时监听该端口时，浏览器被路由到错误的项目页面。
    port: 5173,
    host: '127.0.0.1',
    strictPort: true,
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
