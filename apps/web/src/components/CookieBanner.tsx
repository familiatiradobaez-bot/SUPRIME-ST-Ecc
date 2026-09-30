import { useState } from 'react';
import { Link } from 'react-router-dom';

const CONSENT_KEY = 'suprime_cookie_consent';

// Banner RGPD: solo usamos almacenamiento técnico (sesión, carrito,
// preferencias). Sin terceros de tracking. Aceptar = seguir navegar.
//
// IMPORTANTE (PageSpeed 2026-09-30): el estado inicial se lee en el PRIMER
// render, no en un useEffect. Antes montaba con useState(false) y lo activaba
// después, así que entraba tarde y, al ser un bloque fijo grande, se convertía
// en el elemento LCP de la home en móvil (3,6 s, con TTFB 0 ms y 3330 ms de
// retraso de renderizado). El escritorio no lo sufría porque renderizaba antes.
function readConsent(): boolean {
  try {
    return !localStorage.getItem(CONSENT_KEY);
  } catch {
    // Sin acceso a storage (modo privado): se muestra por defecto.
    return true;
  }
}

export function CookieBanner() {
  const [visible, setVisible] = useState(readConsent);

  const decide = (accepted: boolean) => {
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify({ necessary: true, accepted, date: new Date().toISOString() }));
    } catch {
      // Ignore storage errors
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="cookie-banner" role="region" aria-label="Aviso de cookies">
      <p>
        Usamos almacenamiento técnico (sesión, carrito, preferencias) para que la tienda funcione.
        Sin rastreadores de terceros. Más info en <Link to="/privacidad">Privacidad</Link>.
      </p>
      <div className="cookie-actions">
        <button className="btn btn-secondary btn-sm" onClick={() => decide(false)}>Rechazar</button>
        <button className="btn btn-primary btn-sm" onClick={() => decide(true)}>Aceptar</button>
      </div>
    </div>
  );
}
