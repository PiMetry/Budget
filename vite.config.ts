import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// GitHub Pages serves a project site from /<repo>/; everywhere else the app sits at the root.
const repository = process.env.GITHUB_REPOSITORY?.split('/')[1]
const projectSite = repository && !repository.endsWith('.github.io')

export default defineConfig({
  base: projectSite ? `/${repository}/` : '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'] },
})
