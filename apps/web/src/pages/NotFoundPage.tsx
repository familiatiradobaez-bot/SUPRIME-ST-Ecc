import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

type NotFoundPageProps = {
  onSearch: (term: string) => void;
};

/**
 * 404 de la SPA (tarea #21 del plan).
 *
 * Antes, `path="*"` hacía `Navigate to="/"`: una URL mala o un producto que ya no
 * existía landingaba en la home sin explicación. Aquí el visitante ve qué pasa y
 * tiene una salida: buscar, volver a la tienda o ir a un apartado.
 *
 * SEO: Cloudflare Pages sirve la SPA con 200 para cualquier ruta (el `/*` de
 * `_redirects` es una reescritura), así que no se puede devolver un 404 real sin
 * una Function. Lo que sí se controla es que estas URLs no se indexen: se marca
 * `noindex` mientras la página está montada.
 */
export function NotFoundPage({ onSearch }: NotFoundPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [term, setTerm] = useState('');
  useDocumentTitle('Página no encontrada', 'La página que buscas no existe o ha cambiado de sitio.');

  useEffect(() => {
    let meta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'robots');
      document.head.appendChild(meta);
    }
    const previous = meta.getAttribute('content');
    meta.setAttribute('content', 'noindex, follow');
    return () => {
      // Al navegar a otra ruta dentro de la SPA el meta se queda puesto, así que
      // se restaura explícitamente.
      if (previous) meta.setAttribute('content', previous);
      else meta.remove();
    };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = term.trim();
    if (clean) onSearch(clean);
    else navigate('/');
  };

  return (
    <div className="layout-main">
      <div className="container">
        <section className="products-section">
          <div className="empty-state">
            <p style={{ fontSize: '3rem', margin: 0 }} aria-hidden="true">🧭</p>
            <h3>Página no encontrada</h3>
            <p>
              No existe la dirección <code>{location.pathname}</code>. Puede que el enlace esté mal
              escrito o que el producto ya no esté en la tienda.
            </p>

            <form onSubmit={submit} role="search" style={{ width: '100%', maxWidth: '420px', margin: '0.5rem 0 1rem' }}>
              <input
                className="search-input"
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Busca lo que necesitas"
                aria-label="Buscar productos"
                enterKeyHint="search"
                style={{ width: '100%' }}
              />
            </form>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => navigate('/')}>🛍️ Ver la tienda</button>
              <button className="btn btn-secondary" onClick={() => navigate('/contacto')}>💬 Contacto</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
