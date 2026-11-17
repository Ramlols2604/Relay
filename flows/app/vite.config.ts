import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@clerk/react-router': path.resolve(import.meta.dirname, 'clerk-stub.ts') } },
  server: { fs: { allow: ['../..'] } },
})
