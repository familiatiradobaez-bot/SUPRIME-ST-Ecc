// tests/e2e/admin.spec.mjs — Panel: entrar con TOTP y usar el panel (tarea #24).
//
// Esta es la parte que el smoke de API no puede ver: que el formulario del
// código aparezca, que "Bloquear panel" vuelva a cerrarlo, y que la jerarquía
// de roles se respete en la interfaz. Con TOTP calculado en la propia prueba,
// porque la cuenta de smoke tiene el secreto en _SECRETS/smoke.env.
import { test, expect } from '@playwright/test';
import { API, requireCreds, uiLogin, freshCode, lockPanelFromApi, waitForDeploy } from './helpers.mjs';

test.beforeAll(() => requireCreds());
// Un despliegue a medias se ve como un error de MIME que no explica nada.
test.beforeEach(async ({ request }) => { await waitForDeploy(request); });

const PANEL_HEADING = { name: /Panel de Administración/i };

/**
 * Mete el código en el diálogo de step-up y espera a entrar al panel.
 *
 * Reintenta hasta 3 veces. El contador anti-replay vive en la D1 y NO se
 * reinicia entre ejecuciones: si una corrida anterior (o el propio smoke) ya
 * gastó el contador del paso actual, la API rechaza el código aunque sea
 * correcto, porque exige contador estrictamente mayor que el último guardado.
 * Cuando eso pasa solo queda esperar al paso de 30 s siguiente, que es lo que
 * haría una persona: mirar la app y teclear el código nuevo.
 */
async function submitCode(page) {
  for (let intento = 1; intento <= 3; intento++) {
    await page.locator('#admin-stepup-code').fill(await freshCode());
    await page.locator('[data-testid="admin-stepup-submit"]').click();

    // Gana el panel, o el error visible de código incorrecto / límite.
    const panel = page.getByRole('heading', PANEL_HEADING);
    const error = page.locator('.error');
    const resultado = await Promise.race([
      panel.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'ok').catch(() => 'timeout'),
      error.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'error').catch(() => 'timeout'),
    ]);
    if (resultado === 'ok') return;

    const texto = (await error.innerText().catch(() => '')).trim();
    if (intento === 3) {
      throw new Error(`el código no entró tras 3 intentos. Último error: "${texto}"`);
    }
    if (/Demasiados intentos/i.test(texto)) {
      // Rate-limit de 2FA: no tiene sentido reintentar ya, está todo parado.
      throw new Error(`límite de intentos de 2FA alcanzado (429). Espera 15 min o revisa RL.twofa.`);
    }
    // Código incorrecto: el contador ya se gastó. Al siguiente paso.
  }
}

/**
 * Abre el panel y mete el código hasta que entre.
 *
 * En móvil el botón de Admin no está en la cabecera: vive dentro del menú
 * lateral (`.mobile-menu`), que está fuera de pantalla hasta que se abre. Por
 * eso se busca el botón y, si no se ve, se abre el menú antes de reintentarlo.
 */
async function enterAdmin(page) {
  // El grant vive 1 h en el servidor: sin revocarlo antes, el panel se abriría
  // directo y el formulario del código no aparecería nunca.
  await lockPanelFromApi();

  // En móvil hay DOS botones de Admin: el de la cabecera (oculto por CSS) y el
  // del menú lateral. `.locator('visible=true')` para no agarrar el que no está,
  // que es un click que se queda esperando a los 15 s y luego falla.
  const adminBtn = page.getByRole('button', { name: /Admin/ }).locator('visible=true').first();
  if (await adminBtn.count() === 0) {
    await page.getByRole('button', { name: 'Menu' }).click();
  }
  await adminBtn.click({ timeout: 20_000 });

  await expect(page.locator('#admin-stepup-code')).toBeVisible({ timeout: 20_000 });
  await submitCode(page);
  await expect(page.getByRole('heading', PANEL_HEADING)).toBeVisible({ timeout: 5_000 });
}

/**
 * Abre el sidebar del panel si está plegado.
 *
 * En ≤1024 px el sidebar del admin sale de pantalla (translateX(-100%)) y hay
 * que pulsarlo con su botón. En escritorio el toggle NO existe y el sidebar ya
 * está abierto, así que no se espera ningún '.open' que nunca va a aparecer.
 */
async function openAdminSidebar(page) {
  const toggle = page.locator('.admin-sidebar-toggle');
  const hayToggle = await toggle.isVisible({ timeout: 2_000 }).catch(() => false);
  if (hayToggle) {
    await toggle.click();
    await expect(page.locator('.admin-sidebar.open')).toBeVisible({ timeout: 10_000 });
  } else {
    // Escritorio: el sidebar está siempre visible, no hay nada que abrir.
    await expect(page.locator('.admin-sidebar')).toBeVisible({ timeout: 10_000 });
  }
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
    // En móvil el pie del sidebar está fuera de pantalla hasta que se abre.
    await openAdminSidebar(page);

    await page.locator('[data-testid="lock-panel"]').click();
    // Tras bloquear reaparece el formulario: es el grant revocado, comprobado
    // desde la interfaz y no por la API.
    await expect(page.getByRole('dialog', { name: /Verificación en dos pasos/i })).toBeVisible({ timeout: 20_000 });

    // Y al meter el código otra vez, entra: el revoke no rompió nada. freshCode()
    // espera al paso de 30 s siguiente si el anterior ya se gastó, porque la
    // API rechaza por anti-replay un código con contador repetido.
    await submitCode(page);
    await expect(page.getByRole('heading', PANEL_HEADING)).toBeVisible({ timeout: 5_000 });
  });

  test('el pie del sidebar mantiene "Bloquear panel" dentro del viewport', async ({ page }) => {
    await uiLogin(page);
    await enterAdmin(page);
    await openAdminSidebar(page);

    // El pie es sticky: con la ventana de móvil (390x844) no cabe todo, así
    // que se comprueba que el botón sigue siendo visible sin hacer scroll.
    const lock = page.locator('[data-testid="lock-panel"]');
    await expect(lock).toBeVisible();
    const box = await lock.boundingBox();
    const viewport = page.viewportSize();
    expect(box).toBeTruthy();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  });

  test('la jerarquía de roles oculta Usuarios y Configuración a stock_manager', async ({ page }) => {
    await uiLogin(page);
    await enterAdmin(page);
    await openAdminSidebar(page);

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
