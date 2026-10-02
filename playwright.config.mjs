// playwright.config.mjs — E2E contra el FRONT Y LA API ya desplegados (tarea #24).
//
// No se levanta un servidor local a propósito: lo que se prueba es lo que está
// vivo, con la misma API y el mismo CSP que ve un visitante. Un E2E contra un
// `vite preview` con la API local se pasa en verde mientras producción está rota.
//
// Para probar contra otro entorno:  E2E_WEB=... E2E_API=... npm run e2e
import { defineConfig, devices } from '@playwright/test';

const WEB = process.env.E2E_WEB || 'https://suprime.xyz';
const API = process.env.E2E_API || 'https://api.suprime.xyz/api/v1';

export default defineConfig({
  testDir: './tests/e2e',
  // Las pruebas hacen login y piden el step-up: en paralelo dos workers
  // comparten el grant de 1 h y el anti-replay del TOTP se come el código del
  // otro. Es un límite real del diseño, no del runner.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 90 s (no 60): las pruebas de admin reintentan hasta 3 veces el código TOTP
  // y cada reintento puede esperar al siguiente paso de 30 s por el anti-replay.
  // Con 60 s el test se quedaba sin tiempo a mitad del último reintento y
  // fallaba sin que hubiera ningún fallo real.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'movil', use: { ...devices['Pixel 7'] } },
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
  ],
  metadata: { apiUrl: API },
});
