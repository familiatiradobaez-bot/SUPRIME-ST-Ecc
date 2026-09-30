// tests/e2e/tienda.spec.mjs — Camino de compra de punta a punta (tarea #24).
//
// El smoke de API comprueba que los endpoints responden; esto comprueba que la
// PÁGINA funciona: que el botón está, que el modal abre, que el formulario
// acepta lo que se escribe y que la confirmación aparece. Un botón que no monta
// deja la API perfectamente verde.
import { test, expect } from '@playwright/test';
import {
  API, creds, requireCreds, uiLogin, acceptCookiesIfPresent, waitForDeploy,
} from './helpers.mjs';

test.beforeAll(() => requireCreds());
// Un despliegue a medias se ve como un error de MIME que no explica nada.
test.beforeEach(async ({ request }) => { await waitForDeploy(request); });

test.describe('tienda', () => {
  test('la home carga productos reales (no un esqueleto eterno)', async ({ page }) => {
    await page.goto('/');
    await acceptCookiesIfPresent(page);

    // Los botones de "Agregar al carrito" son lo último que monta ProductCard:
    // si el fetch de catálogo falla, esto no aparece nunca.
    const cards = page.locator('[data-testid="add-to-cart"]');
    await expect(cards.first()).toBeVisible({ timeout: 20_000 });
    expect(await cards.count()).toBeGreaterThan(0);

    // El pie montado: una pantalla en blanco por un hook colocado después de un
    // return deja el DOM a medias aunque los datos hayan llegado.
    await expect(page.locator('footer')).toBeAttached();
  });

  test('la PDP de un producto real muestra precio y botón de comprar', async ({ page, request }) => {
    // Se saca un slug real de la API, no uno inventado: la PDP de un producto
    // borrado es el 404 de la SPA y probaría otra cosa.
    const res = await request.get(`${API}/catalog/products`);
    expect(res.ok()).toBeTruthy();
    const products = (await res.json()).data;
    const product = products.find((p) => p.slug && (p.stock_quantity || 0) > 0);
    expect(product, 'la API debe devolver al menos un producto con stock').toBeTruthy();

    await page.goto(`/producto/${product.slug}`);
    await acceptCookiesIfPresent(page);
    await expect(page.getByRole('heading', { name: new RegExp(product.name.slice(0, 12), 'i') })).toBeVisible({ timeout: 20_000 });
    // El precio se pinta en euros; solo se comprueba que hay un símbolo.
    await expect(page.locator('body')).toContainText('€', { timeout: 10_000 });
  });

  test('una URL inexistente cae en el 404 de la SPA con salidas', async ({ page }) => {
    await page.goto('/ruta-que-no-existe-jamas');
    await acceptCookiesIfPresent(page);
    // Página real de 404, no un index en blanco.
    await expect(page.getByRole('link').first()).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });
});

test.describe('compra', () => {
  test('login → añadir al carrito → checkout → pedido confirmado', async ({ page }) => {
    await uiLogin(page);

    // 1) Añadir al carrito. Sin sesión la app abre el login en vez de añadir,
    //    así que el orden (login primero) es parte de lo que se prueba.
    const addBtn = page.locator('[data-testid="add-to-cart"]:not([disabled])').first();
    await addBtn.scrollIntoViewIfNeeded();
    await expect(addBtn).toBeVisible({ timeout: 20_000 });
    await addBtn.click();

    await expect(page.locator('[data-testid="cart-count"]')).toHaveText(/[1-9]/, { timeout: 15_000 });

    // 2) Abrir el carrito y pasar a pago.
    await page.locator('[data-testid="open-cart"]').click();
    await expect(page.getByRole('button', { name: /Cerrar carrito/i })).toBeVisible();
    await page.locator('[data-testid="go-checkout"]').click();

    // 3) Rellenar el checkout. PayPal para no meter datos de tarjeta.
    const form = page.getByRole('dialog', { name: /Finalizar compra/i });
    await form.waitFor({ state: 'visible', timeout: 15_000 });
    await form.locator('#co-name').fill('Cliente E2E');
    await form.locator('#co-email').fill(creds.email);
    await form.locator('#co-phone').fill('+34 612 345 678');
    await form.locator('#co-address').fill('Calle E2E 1');
    await form.locator('#co-city').fill('Madrid');
    await form.locator('#co-postal').fill('28001');
    await form.getByRole('radio', { name: /PayPal/i }).check();
    await form.locator('[data-testid="accept-terms"]').check();
    await form.locator('[data-testid="place-order"]').click();

    // 4) Confirmación. Este es el paso que se rompe cuando un hook queda
    //    después de un return condicional: la petición va bien y la pantalla
    //    se queda en blanco.
    await expect(form.getByText(/Gracias por tu compra/i)).toBeVisible({ timeout: 30_000 });

    // El carrito queda vacío tras el pedido.
    await expect(page.locator('[data-testid="cart-count"]')).toHaveText('0', { timeout: 15_000 });
  });

  test('el carrito exige sesión: sin ella abre el login y no añade', async ({ page }) => {
    await page.goto('/');
    await acceptCookiesIfPresent(page);
    const addBtn = page.locator('[data-testid="add-to-cart"]:not([disabled])').first();
    await addBtn.scrollIntoViewIfNeeded();
    await addBtn.click();
    // Aviso + modal de login, y el contador sigue en 0.
    await expect(page.getByRole('dialog', { name: /Acceso a cuenta/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="cart-count"]')).toHaveText('0');
  });
});
