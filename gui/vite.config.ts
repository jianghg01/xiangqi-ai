/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // 打包版用 file:// 加载，资源必须相对路径
  server: { port: 5173, strictPort: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
