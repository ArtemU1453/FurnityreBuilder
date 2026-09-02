import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    // The product must work offline and pull nothing from third-party hosts.
    // Everything is bundled locally; see docs/BRAND_INDEPENDENCE_AUDIT.md.
    assetsInlineLimit: 4096,
  },
});
