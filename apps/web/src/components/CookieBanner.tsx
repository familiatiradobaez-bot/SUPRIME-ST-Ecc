import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const CONSENT_KEY = 'suprime_cookie_consent';

// Banner RGPD: solo usamos almacenamiento técnico (sesión, carrito,
// preferencias). Sin terceros de tracking. Aceptar = seguir navegando.
export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(CONSENT_KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

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
    <div className="cookie-banner" role="dialog" aria-modal="false" aria-label="Aviso de cookies">
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
