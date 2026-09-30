import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Pantalla blanca cuando un chunk lazy no se puede cargar.
 *
 * Pasó en producción el 2026-09-30: Cloudflare Pages devuelve el index.html
 * (text/html, fallback de la SPA) para un /assets/*.js que todavía no existe en
 * un nodo, el navegador rechaza el módulo ES por MIME y el import dinámico
 * revienta. Como no había nada que capturara el error, la página se quedaba en
 * blanco: ni mensaje, ni panel, ni vuelta atrás. El header y el footer se
 * borraron porque el fallo de React desmonta el árbol entero.
 *
 * Aquí el fallo se muestra y se ofrece recargar, que es lo único que funciona:
 * el asset que faltaba ya estará en su sitio.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Errorboundary:', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const chunkError = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(error.message);

    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-card">
          <h1>No se ha podido cargar esta parte</h1>
          {chunkError ? (
            <p>
              Es un fallo al descargar un archivo de la web, no un error tuyo.
              Recargar la página lo suele arreglar.
            </p>
          ) : (
            <p>Ha ocurrido un error inesperado. Prueba a recargar la página.</p>
          )}
          <p className="error-boundary-detail"><code>{error.message}</code></p>
          <div className="error-boundary-actions">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Recargar</button>
            <button className="btn btn-secondary" onClick={() => { window.location.href = '/'; }}>Ir a la portada</button>
          </div>
        </div>
      </div>
    );
  }
}
