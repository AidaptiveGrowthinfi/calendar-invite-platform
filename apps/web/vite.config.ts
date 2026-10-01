import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * ADR 0056: React, Vite and Tailwind, built new.
 *
 * The build is static files the VPS reverse proxy serves directly, which is the
 * reason the framework choice is not consequential and therefore the argument
 * for the cheaper one. Next.js would mean a second Node process beside the
 * NestJS application on the same box, for server rendering an entirely
 * authenticated dashboard does not need.
 *
 * The public pages - hosted RSVP, unsubscribe, one-click unsubscribe - are NOT
 * here. They are rendered by the API (ADR 0053, carried forward by 0056)
 * because they must work without JavaScript, answer a mail client's automated
 * unsubscribe correctly, and be fast on first byte from an email link.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
