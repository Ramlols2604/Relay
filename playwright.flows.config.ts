import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const root = import.meta.dirname
const python = fs.existsSync(path.join(root, 'backend/.venv/bin/python')) ? '.venv/bin/python' : 'python'
const apiPort = 8012
// The API already allows this origin for CORS.
const webPort = 5174

const blankRemote = {
  SNOWFLAKE_ACCOUNT: '',
  SNOWFLAKE_USER: '',
  SNOWFLAKE_PASSWORD: '',
  SNOWFLAKE_WAREHOUSE: '',
  SNOWFLAKE_DATABASE: '',
  SNOWFLAKE_SCHEMA: '',
  SNOWFLAKE_ROLE: '',
  GEMINI_API_KEY: '',
  BACKBOARD_API_KEY: '',
  OLLAMA_HOST: '',
}

/** Browser flows against a real API and the real Activity page. Needs no Clerk keys. */
export default defineConfig({
  testDir: './flows',
  testMatch: /.*\.flow\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'retain-on-failure',
    viewport: { width: 420, height: 1000 },
  },
  projects: [
    {
      name: 'flows',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 420, height: 1000 },
        // Set when the Playwright-managed browser is not installed, e.g. in a sandbox.
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
      },
    },
  ],
  webServer: [
    {
      command: `rm -f flows.db && ${python} -m uvicorn app.main:app --host 127.0.0.1 --port ${apiPort}`,
      cwd: path.join(root, 'backend'),
      url: `http://127.0.0.1:${apiPort}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        ...blankRemote,
        DATABASE_URL: 'sqlite:///./flows.db',
        RELAY_AUTH_DISABLED: '1',
      },
    },
    {
      command: `npx vite flows/app --config flows/app/vite.config.ts --host 127.0.0.1 --port ${webPort} --strictPort`,
      cwd: root,
      url: `http://127.0.0.1:${webPort}`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { ...process.env, VITE_API_URL: `http://127.0.0.1:${apiPort}` },
    },
  ],
})
