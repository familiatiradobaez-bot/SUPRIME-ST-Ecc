import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApiUrl } from '../hooks/useApiUrl';
import { formatPrice } from '../lib/api';

// Página dedicada de un pedido: todo el detalle + número de seguimiento.
// El botón de rastreo queda preparado (número ya visible) pero sin conectar:
// falta decidir el rastreador global y de dónde se saca el número.

type Item = {
  product_id: string | null;
  product_name: string | null;
  product_image: string | null;
  quantity: number;
  price_cents: number;
};

type Order = {
  id: string;
  status: string;
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  shipping_name: string | null;
  shipping_email: string | null;
  shipping_phone: string | null;
  shipping_address: string | null;
  payment_method: string | null;
  created_at: string;
  tracking_number: string | null;
  tracking_carrier: string | null;
  tracking_updated_at: string | null;
  items: Item[];
};

const STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pendiente', color: '#f59e0b' },
  paid: { label: 'Pagado', color: '#22c55e' },
  shipped: { label: 'Enviado', color: '#3b82f6' },
  delivered: { label: 'Entregado', color: '#16a34a' },
  cancelled: { label: 'Cancelado', color: '#ef4444' },
};

// Dónde sigue cada estado. El cliente ve en qué punto está su paquete.
const STEPS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'pending', label: 'Pedido recibido', hint: 'Hemos confirmado tu pedido' },
  { key: 'paid', label: 'Pago confirmado', hint: 'Todo listo para preparar' },
  { key: 'shipped', label: 'En camino', hint: 'Salió del almacén hacia ti' },
  { key: 'delivered', label: 'Entregado', hint: 'Ya está en tus manos' },
];

function getToken(): string {
  try {
    for (const store of [localStorage, sessionStorage]) {
      const raw = store.getItem('suprime_session');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.token) return parsed.token;
      }
    }
  } catch { /* ignore */ }
  return '';
}

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const apiUrl = useApiUrl();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [trackerMsg, setTrackerMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const token = getToken();
    if (!token) {
      setError('Necesitas iniciar sesión para ver tu pedido');
      setLoading(false);
      return;
    }
    fetch(`${apiUrl}/orders/${id}`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' })
      .then(async (r) => {
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(payload.error === 'FORBIDDEN' ? 'Ese pedido no es tuyo' : 'No encontramos ese pedido');
          return;
        }
        if (!cancelled) setOrder(payload.data);
      })
      .catch(() => setError('No se pudo cargar el pedido'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [apiUrl, id]);

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  if (error || !order) {
    return (
      <div className="order-page">
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>← Volver</button>
        <h1>{error || 'Pedido no encontrado'}</h1>
        <button className="btn btn-primary" onClick={() => navigate('/')}>Ir a la tienda</button>
      </div>
    );
  }

  const status = STATUS[order.status] || { label: order.status, color: '#6b7280' };
  const currentStep = STEPS.findIndex((s) => s.key === order.status);

  return (
    <div className="order-page">
      <button className="btn btn-secondary" onClick={() => navigate(-1)}>← Volver a mis pedidos</button>

      <header className="order-head">
        <div>
          <h1>Pedido <span className="order-code">#{order.id.slice(0, 8)}</span></h1>
          <p className="order-date">
            Realizado el {new Date(order.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
            {' · '}
            {new Date(order.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <span className="order-status" style={{ background: `${status.color}22`, color: status.color, borderColor: `${status.color}55` }}>
          {status.label}
        </span>
      </header>

      {/* ── Seguimiento ── */}
      <section className="order-card">
        <h2>📦 Seguimiento del paquete</h2>
        {order.tracking_number ? (
          <>
            <div className="tracking-row">
              <div>
                <small>Número de seguimiento</small>
                <strong className="tracking-number">{order.tracking_number}</strong>
                {order.tracking_carrier && <small className="carrier">{order.tracking_carrier}</small>}
              </div>
              <button
                className="btn btn-track"
                onClick={() => setTrackerMsg('Pronto: conectamos el rastreador con este número.')}
              >
                🔍 Rastrear paquete
              </button>
            </div>
            {trackerMsg && <p className="tracker-msg" aria-live="polite">{trackerMsg}</p>}
          </>
        ) : (
          <p className="tracker-pending">
            Aún no hay número de seguimiento. Te avisaremos en cuanto el paquete salga
            y se actualice aquí.
          </p>
        )}
      </section>

      {/* ── Pasos ── */}
      <section className="order-card">
        <h2>Estado del envío</h2>
        <ol className="order-steps">
          {STEPS.map((s, i) => {
            const done = currentStep >= i && order.status !== 'cancelled';
            const isLastDone = currentStep === i;
            return (
              <li key={s.key} className={done ? 'done' : ''}>
                <span className="dot">{done ? '✓' : i + 1}</span>
                <div>
                  <strong>{s.label}</strong>
                  <small>{s.hint}</small>
                </div>
                {isLastDone && <span className="now">Ahora</span>}
              </li>
            );
          })}
        </ol>
      </section>

      {/* ── Productos ── */}
      <section className="order-card">
        <h2>Artículos</h2>
        {order.items.map((it, i) => (
          <div className="order-item" key={`${it.product_id}-${i}`}>
            {it.product_image && <img src={it.product_image} alt={it.product_name || ''} />}
            <div className="order-item-info">
              <strong>{it.product_name || 'Producto'}</strong>
              <small>{it.quantity} × {formatPrice(it.price_cents)}</small>
            </div>
            <span className="order-item-total">{formatPrice(it.price_cents * it.quantity)}</span>
          </div>
        ))}
        <div className="order-totals">
          <div><span>Subtotal</span><span>{formatPrice(order.subtotal_cents)}</span></div>
          <div><span>Envío</span><span>{order.shipping_cents ? formatPrice(order.shipping_cents) : 'Gratis'}</span></div>
          <div className="grand"><span>Total</span><span>{formatPrice(order.total_cents)}</span></div>
        </div>
      </section>

      {/* ── Dirección ── */}
      <section className="order-card">
        <h2>Dirección de envío</h2>
        <p className="order-address">
          {order.shipping_name}<br />
          {order.shipping_address}<br />
          {order.shipping_phone && <>Tel. {order.shipping_phone}<br /></>}
          {order.shipping_email}
        </p>
        {order.payment_method && <small className="order-pay">Método de pago: {order.payment_method}</small>}
      </section>

      <button className="btn btn-secondary" onClick={() => navigate('/')} style={{ width: '100%' }}>
        Seguir comprando
      </button>
    </div>
  );
}