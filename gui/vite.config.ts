/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, strictPort: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
