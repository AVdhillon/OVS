import { defineConfig, type Plugin } from 'vite'
import fs from 'fs'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// Dev-only companion to routes.tsx's basename setting. Client-side
// navigation within the admin app (clicking a <Link>) never hits this —
// react-router just updates history in the browser. This only matters for
// a hard refresh or a manually-typed URL under /admin or /admin/* (e.g.
// /admin/dashboard): that's a real HTTP request to Vite's dev server, and
// without this, Vite has no file at that path and returns a genuine 404
// (as opposed to the React Router "No routes matched" error the basename
// setting prevents). Mirrors what vercel.json's /admin + /admin/(.*) rewrite
// does in production — same rule, same admin.html target, just expressed
// as Vite dev-server middleware here instead of a host-level rewrite.
function adminHtmlDevFallback(): Plugin {
  const adminHtmlPath = path.resolve(__dirname, 'admin.html')
  return {
    name: 'admin-html-dev-fallback',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (url !== '/admin' && !url.startsWith('/admin/')) {
          next()
          return
        }
        try {
          const raw = fs.readFileSync(adminHtmlPath, 'utf-8')
          const html = await server.transformIndexHtml('/admin.html', raw)
          res.setHeader('Content-Type', 'text/html')
          res.end(html)
        } catch (err) {
          next(err as Error)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    adminHtmlDevFallback(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  // Second build entry for the standalone admin app (admin.html ->
  // src/admin/main.tsx). Without an explicit rollupOptions.input, `vite build`
  // only emits index.html's entry — this doesn't affect `vite dev`, which
  // serves any HTML file at its own path (e.g. /admin.html) with no config
  // needed, but a production build would silently drop the admin app entirely.
  //
  // The two apps are one static build output deployed to the SAME origin
  // (not separate subdomains): /admin and everything under /admin/* is
  // rewritten to this admin.html entry at the host level (see vercel.json),
  // same idea as the bare "/" -> index.html mapping every static host does
  // by default. See routes.tsx's basename and this file's
  // adminHtmlDevFallback plugin above for the dev-server equivalent of that
  // host-level rewrite.
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        admin: path.resolve(__dirname, 'admin.html'),
      },
    },
  },
})
