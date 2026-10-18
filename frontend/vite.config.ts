import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Pet art lives in ../shared/petArt (also used by the backend for NFT images).
  server: { fs: { allow: [".."] } },
})
