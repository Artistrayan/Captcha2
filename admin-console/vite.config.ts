import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The admin console intentionally imports shared UI components from ../src.
// Resolve their browser dependencies from this app's own node_modules.
const sharedReact = fileURLToPath(import.meta.resolve('react'));
const sharedReactDomClient = fileURLToPath(import.meta.resolve('react-dom/client'));
const sharedLucide = fileURLToPath(import.meta.resolve('lucide-react'));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^react$/, replacement: sharedReact },
      { find: /^react-dom\/client$/, replacement: sharedReactDomClient },
      { find: /^lucide-react$/, replacement: sharedLucide },
    ],
    dedupe: ['react', 'react-dom'],
  },
  preview: { allowedHosts: ['shieldcaptcha-admin.onrender.com'] },
  build: { outDir: 'dist', emptyOutDir: true },
});
