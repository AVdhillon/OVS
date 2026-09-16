import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  // EDIT (Phase 1 — auth model consolidation, subphase 1.10): second build
  // entry for the standalone admin app (admin.html -> src/admin/main.tsx).
  // Without an explicit rollupOptions.input, `vite build` only emits
  // index.html's entry — this doesn't affect `vite dev`, which serves any
  // HTML file at its own path (e.g. /admin.html) with no config needed, but
  // a production build would silently drop the admin app entirely without
  // this. The two apps are deployed as one static build output with two
  // entry HTML files (index.html at the main app's origin, admin.html at
  // the admin subdomain — see main.ts's ADMIN_ALLOWED_ORIGINS, subphase
  // 1.3); they are not two separate Vite projects.
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        admin: path.resolve(__dirname, 'admin.html'),
      },
    },
  },
})
