import { useEffect, useState } from 'react';

type Borrador = {
  productId: string;
  title?: string;
  price?: string;
  description?: string;
  status?: string;
  fotos?: Array<{ name?: string; url?: string }>;
};

type BorradoresPanelProps = {
  apiUrl: string;
  sessionToken: string;
};

export function BorradoresPanel({ apiUrl, sessionToken }: BorradoresPanelProps) {
  const [items, setItems] = useState<Borrador[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  async function cargar() {
    setLoading(true);
    try {
      const r = await fetch('/borradores/borradores.json', { cache: 'no-store' });
      const data = await r.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setMsg('Error cargando: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function publicado(productId: string) {
    setMsg('Marcando como publicado...');
    const r = await fetch(`${apiUrl}/admin/borradores/publicado`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ productId }),
    });
    const j = await r.json();
    setMsg(j.data ? 'Marado como publicado ✓' : (j.error || 'error'));
    cargar();
  }

  useEffect(() => { cargar(); }, []);

  return (
    <div>
      <h2>Borradores del scraping</h2>
      <button onClick={cargar}>Refrescar</button>
      {msg && <p aria-live="polite">{msg}</p>}
      {loading && <p>Cargando...</p>}
      <table className="admin-table">
        <thead><tr><th>ID</th><th>Título</th><th>Precio</th><th>Fotos</th><th>Acción</th></tr></thead>
        <tbody>
          {items.filter((b) => b.status !== 'publicado').map((b) => (
            <tr key={b.productId}>
              <td>{b.productId}</td>
              <td>{(b.title || '').slice(0, 70)}</td>
              <td>{b.price}</td>
              <td>{(b.fotos || []).length}</td>
              <td><button onClick={() => publicado(b.productId)}>Publicado ✅</button></td>
            </tr>
          ))}
          {!loading && items.filter((b) => b.status !== 'publicado').length === 0 && (
            <tr><td colSpan={5}>No hay borradores pendientes.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
