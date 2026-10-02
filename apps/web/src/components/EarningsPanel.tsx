import { useCallback, useEffect, useState } from 'react';
import { formatPrice } from '../lib/api';

// Pantalla de resumen económico. Entra desde la tarjeta "Ingresos" del
// dashboard. Los importes vienen en céntimos de la API.

type Props = { apiUrl: string; sessionToken: string };

type Earnings = {
  days: number;
  orders: number;
  revenue: number;
  shipping_cents: number;
  products_revenue: number;
  units_sold: number;
  average_ticket: number;
  cancelled_orders: number;
  cancelled_amount: number;
  by_status: Array<{ status: string; orders: number; amount: number }>;
  top_products: Array<{ product_id: string; name: string; units: number; revenue: number }>;
  top_customers: Array<{ shipping_name: string; shipping_email: string; orders: number; amount: number }>;
  daily: Array<{ day: string; revenue: number; orders: number }>;
};

const PERIODS = [
  { value: '7', label: '7 días' },
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
  { value: '365', label: '12 meses' },
  { value: '0', label: 'Todo' },
];

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente', paid: 'Pagado', shipped: 'Enviado',
  delivered: 'Entregado', cancelled: 'Cancelado', archived: 'Archivado',
};

export function EarningsPanel({ apiUrl, sessionToken }: Props) {
  const [days, setDays] = useState('30');
  const [data, setData] = useState<Earnings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (period: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/admin/earnings?days=${period}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
        credentials: 'include',
      });
      const payload = await res.json();
      if (!res.ok) { setError(payload.message || payload.error || 'No se pudo cargar el resumen'); return; }
      setData(payload.data);
    } catch {
      setError('No se pudo conectar con el servidor');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, sessionToken]);

  useEffect(() => { load(days); }, [days, load]);

  const max = data && data.daily.length ? Math.max(...data.daily.map((d) => d.revenue)) : 0;
  const periodo = PERIODS.find((p) => p.value === days)?.label ?? '';

  return (
    <div className="earnings">
      <div className="earnings-head">
        <h2>💰 Ganancias</h2>
        <div className="earnings-periods">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              className={`btn btn-sm ${days === p.value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDays(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <p className="earnings-sub">Resumen de los últimos <strong>{periodo.toLowerCase()}</strong></p>

      {error && <p className="error" aria-live="polite">{error}</p>}
      {loading && <div className="loading"><div className="spinner"></div></div>}

      {data && !loading && (
        <>
          {/* Cifras grandes */}
          <div className="earnings-kpis">
            <div className="earnings-kpi main">
              <small>Ingresos totales</small>
              <strong>{formatPrice(data.revenue)}</strong>
            </div>
            <div className="earnings-kpi">
              <small>Pedidos</small>
              <strong>{data.orders}</strong>
            </div>
            <div className="earnings-kpi">
              <small>Ticket medio</small>
              <strong>{formatPrice(data.average_ticket)}</strong>
            </div>
            <div className="earnings-kpi">
              <small>Unidades vendidas</small>
              <strong>{data.units_sold}</strong>
            </div>
          </div>

          {/* Reparto del dinero */}
          <div className="earnings-split">
            <div className="earnings-bar">
              <div className="seg products" style={{ width: `${data.revenue ? (data.products_revenue / data.revenue) * 100 : 0}%` }} />
              <div className="seg shipping" style={{ width: `${data.revenue ? (data.shipping_cents / data.revenue) * 100 : 0}%` }} />
            </div>
            <div className="earnings-legend">
              <span><i className="dot products" /> Productos {formatPrice(data.products_revenue)}</span>
              <span><i className="dot shipping" /> Envío cobrado {formatPrice(data.shipping_cents)}</span>
              {data.cancelled_orders > 0 && (
                <span className="cancelled">Cancelados {data.cancelled_orders} ({formatPrice(data.cancelled_amount)})</span>
              )}
            </div>
            <small className="earnings-note">
              Aquí solo hay ingresos brutos. Cuando conectemos el coste real de cada
              producto (dropshipping) aquí aparecerá la ganancia neta real.
            </small>
          </div>

          {/* Gráfico diario */}
          {data.daily.length > 0 && (
            <div className="earnings-card">
              <h3>Ingresos por día</h3>
              <div className="earnings-chart">
                {data.daily.map((d) => (
                  <div className="chart-col" key={d.day} title={`${d.day}: ${formatPrice(d.revenue)} · ${d.orders} pedido(s)`}>
                    <div className="chart-bar" style={{ height: `${max ? Math.max((d.revenue / max) * 100, 3) : 3}%` }} />
                    <small>{d.day.slice(8)}/{d.day.slice(5, 7)}</small>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Productos y estados */}
          <div className="earnings-grid">
            <div className="earnings-card">
              <h3>Productos que más venden</h3>
              {data.top_products.length === 0 && <p className="earnings-empty">Sin ventas en este periodo.</p>}
              {data.top_products.map((p, i) => (
                <div className="earn-row" key={p.product_id || i}>
                  <span className="rank">{i + 1}</span>
                  <span className="name">{p.name || 'Producto eliminado'}</span>
                  <span className="qty">{p.units} uds</span>
                  <span className="amount">{formatPrice(p.revenue)}</span>
                </div>
              ))}
            </div>

            <div className="earnings-card">
              <h3>Estado de los pedidos</h3>
              {data.by_status.length === 0 && <p className="earnings-empty">Sin pedidos en este periodo.</p>}
              {data.by_status.map((s) => (
                <div className="earn-row" key={s.status}>
                  <span className="name">{STATUS_LABEL[s.status] || s.status}</span>
                  <span className="qty">{s.orders}</span>
                  <span className="amount">{formatPrice(s.amount)}</span>
                </div>
              ))}
            </div>
          </div>

          {data.top_customers.length > 0 && (
            <div className="earnings-card">
              <h3>Mejores clientes</h3>
              {data.top_customers.map((c, i) => (
                <div className="earn-row" key={`${c.shipping_email}-${i}`}>
                  <span className="rank">{i + 1}</span>
                  <span className="name">{c.shipping_name || c.shipping_email}</span>
                  <span className="qty">{c.orders} pedido(s)</span>
                  <span className="amount">{formatPrice(c.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}