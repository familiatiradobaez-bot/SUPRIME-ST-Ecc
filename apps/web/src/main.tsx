import { StrictMode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './styles/animations.css';
import './styles/category-nav.css';
import './styles/admin.css';
// `admin.css` se importa aquí y no desde `pages/AdminPage.tsx`. Estaba
// code-split, pero Vite mete la CSS del chunk en un archivo aparte: si ese
// archivo no se descarga, el import dinámico ENTERO revienta (no solo la CSS) y
// el panel se queda en blanco. Pasó en producción: Pages devolvió el index.html
// con content-type text/html para /assets/AdminPage-<hash>.css, que es el
// fallback de la SPA, y el navegador rechazó el módulo por MIME. Son 16,7 KB
// crudos (~3 KB gzip) que se pagan en el bundle inicial a cambio de que el
// panel sea un único chunk de JS sin dependencias de CSS.
// Lo mismo con el resto de rutas y modales: sus formularios van en chunks JS
// aparte, sin CSS propio.

/**
 * Recuperación ante un chunk que no se pudo descargar.
 *
 * Vite dispara este evento cuando falla el import dinámico. La primera vez se
 * recarga la página (el archivo que faltaba ya estará disponible); si vuelve a
 * pasar, se deja que lo muestre el ErrorBoundary con su botón, para no entrar
 * en un bucle de recargas.
 */
const RELOAD_FLAG = 'suprime:chunk-reload';
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  if (sessionStorage.getItem(RELOAD_FLAG)) return;
  sessionStorage.setItem(RELOAD_FLAG, '1');
  window.location.reload();
});
window.addEventListener('load', () => sessionStorage.removeItem(RELOAD_FLAG));

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
);