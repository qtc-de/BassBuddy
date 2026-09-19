import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the build works both at a domain root and under a
  // subpath (e.g. GitHub Pages project sites serve at /<repo>/).
  base: './',
  plugins: [vue()],
})
