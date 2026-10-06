import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Only the app's own entry is scanned for dependencies. Without this Vite crawls every .html file under the
  // project folder — including the multi-GB trial projects in Apps_Trial — and the page hangs while it loads.
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    allowedHosts: ['.devtunnels.ms'],
    // don't watch the trial input projects (hundreds of thousands of files); they are picked in the browser, not imported
    watch: {
      ignored: ['**/Apps_Trial/**'],
    },
  },
})
