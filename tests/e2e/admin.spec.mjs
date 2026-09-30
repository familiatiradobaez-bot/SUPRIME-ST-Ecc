// tests/e2e/admin.spec.mjs — Panel: entrar con TOTP y usar el panel (tarea #24).
//
// Esta es la parte que el smoke de API no puede ver: que el formulario del
// código aparezca, que "Bloquear panel" vuelva a cerrarlo, y que la jerarquía
// de roles se respete en la interfaz. Con TOTP calculado en la propia prueba,
// porque la cuenta de smoke tiene el secreto en _SECRETS/smoke.env.
import { test, expect } from '@playwright/test';
import { API, requireCreds, uiLogin, totpNow, lockPanelFromApi, waitForDeploy } from './helpers.mjs';

test.beforeAll(() => requireCreds());
// Un despliegue a medias se ve como un error de MIME que no explica nada.
test.beforeEach(async ({ request }) => { await waitForDeploy(request); });

const STEPUP_DIALOG = { name: /Verificación en dos pasos/i };

/** Abre el panel y mete el código hasta que el panel entre. */
async function enterAdmin(page) {
  // El grant vive 1 h en el servidor: sin revocarlo antes, el panel se abriría
  // directo y el formulario del código no aparecería nunca.
  await lockPanelFromApi();
  await page.getByRole('button', { name: /Admin/ }).first().click();

  const code = page.locator('#admin-stepup-code');
  await expect(code).toBeVisible({ timeout: 20_000 });
  await code.fill(totpNow());
  await page.locator('[data-testid="admin-stepup-submit"]').click();

  // Entra cuando aparece la cabecera del panel, no cuando desaparece el modal.
  await expect(page.getByRole('heading', { name: /Panel de Administración/i })).toBeVisible({ timeout: 20_000 });
}

test.describe('panel de administración', () => {
  test('entra con TOTP y ve el dashboard', async ({ page }) => {
    await uiLogin(page);
    await enterAdmin(page);

    await expect(page.locator('.admin-sidebar')).toBeVisible();
    // El panel sustituye a la tienda: si el catálogo sigue en el DOM, el
    // return temprano de App.tsx (rama showAdminPanel) no se aplicó.
    await expect(page.locator('[data-testid="add-to-cart"]')).toHaveCount(0);
  });

  test('"Bloquear panel" vuelve a pedir el código y se puede volver a entrar', async ({ page }) => {
    await uiLogin(page);
    await enterAdmin(page);

    await page.locator('[data-testid="lock-panel"]').click();
    // Tras bloquear reaparece el formulario: es el grant revocado, comprobado
    // desde la interfaz y no por la API.
    await expect(page.getByRole('dialog', STEPUP_DIALOG)).toBeVisible({ timeout: 20_000 });

    // Y al meter el código otra vez, entra: el revoke no rompió nada.
    await page.locator('#admin-stepup-code').fill(totpNow());
    await page.locator('[data-testid="admin-stepup-submit"]').click();
    await expect(page.getByRole('heading', { name: /Panel de Administración/i })).toBeVisible({ timeout: 20_000 });
  });

  test('el pie del sidebar mantiene "Bloquear panel" dentro del viewport', async ({ page }) => {
    await uiLogin(page);
    await enterAdmin(page);

    // El pie es sticky: con la ventana de móvil (390x844) no cabe todo, así
    // que se comprueba que el botón sigue siendo visible sin hacer scroll.
    const lock = page.locator('[data-testid="lock-panel"]');
    const box = await lock.boundingBox();
    const viewport = page.viewportSize();
    expect(box).toBeTruthy();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  });

  test('la jerarquía de roles oculta Usuarios y Configuración a stock_manager', async ({ page }) => {
    await uiLogin(page);
    await enterAdmin(page);

    // La cuenta de smoke es stock_manager a propósito: Catálogo y Pedidos sí,
    // Usuarios y Configuración no. El servidor lo exige igual (403), pero la
    // UI no debe ofrecer botones que van a fallar.
    await expect(page.getByRole('button', { name: /Productos/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Catálogo/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Usuarios/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Configuración/i })).toHaveCount(0);
  });
});

test.describe('permisos en la API', () => {
  test('sin sesión, /admin/users responde 401', async ({ request }) => {
    const res = await request.get(`${API}/admin/users`, {
      headers: { Authorization: 'Bearer token-falso' },
    });
    expect(res.status()).toBe(401);
  });
});
