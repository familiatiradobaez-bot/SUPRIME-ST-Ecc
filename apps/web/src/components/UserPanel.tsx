import { useState, useEffect } from 'react';
import type { User } from '../types';
import { formatPrice } from '../lib/api';

type UserPanelProps = {
  user: User;
  apiUrl: string;
  sessionToken: string;
  onClose: () => void;
  onLogout: () => void;
  onSaveShipping: (data: { full_name: string; phone: string; address: string; city: string; postal_code: string }) => Promise<void>;
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  paid: 'Pagado',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

type OrderSummary = {
  id: string;
  status: string;
  total_cents: number;
  created_at: string;
};

type OrderDetail = OrderSummary & {
  items: Array<{ product_id: string; product_name: string; quantity: number; price_cents: number }>;
};

export function UserPanel({ user, apiUrl, sessionToken, onClose, onLogout, onSaveShipping }: UserPanelProps) {
  const [name, setName] = useState(user.shipping?.full_name || '');
  const [phone, setPhone] = useState(user.shipping?.phone || '');
  const [address, setAddress] = useState(user.shipping?.address || '');
  const [city, setCity] = useState(user.shipping?.city || '');
  const [postal, setPostal] = useState(user.shipping?.postal_code || '');
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [openOrder, setOpenOrder] = useState<OrderDetail | null>(null);

  useEffect(() => {
    setOrdersLoading(true);
    fetch(`${apiUrl}/orders`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` },
      credentials: 'include',
    })
      .then(r => r.json())
      .then(payload => { if (payload.data) setOrders(payload.data); })
      .catch(() => {})
      .finally(() => setOrdersLoading(false));
  }, [apiUrl, sessionToken]);

  const loadOrderDetail = async (id: string) => {
    if (openOrder?.id === id) {
      setOpenOrder(null);
      return;
    }
    try {
      const res = await fetch(`${apiUrl}/orders/${id}`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        credentials: 'include',
      });
      const payload = await res.json();
      if (payload.data) setOpenOrder(payload.data);
    } catch {
      // Ignore
    }
  };

  return (
    <div className="modal-overlay anim-modal-overlay" onClick={onClose}>
      <div className="modal anim-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Mi Cuenta</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '1.5rem' }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>Información de la cuenta</h3>
            <p><strong>Usuario:</strong> {user.username}</p>
            <p><strong>Email:</strong> {user.email}</p>
            <p><strong>Nombre:</strong> {user.display_name}</p>
            {(user.role_id === 'role-owner' || user.role_id === 'role-admin' || user.role_id === 'role-stock-manager') && (
              <p><strong>Rol:</strong> {user.role_id.replace('role-', '').replace('_', ' ')}</p>
            )}
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>Vincular cuenta de Google</h3>
            <p style={{ color: '#68736b', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
              Vincula tu cuenta de Google para iniciar sesión más fácilmente
            </p>
            <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => alert('Google OAuth - Próximamente')}>
              🔗 Vincular con Google
            </button>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>Datos de envío</h3>
            <p style={{ color: '#68736b', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
              Estos datos se usarán automáticamente en el checkout
            </p>
            <div className="form-group">
              <label>Nombre completo:</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Juan Pérez" />
            </div>
            <div className="form-group">
              <label>Teléfono:</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+34 123 456 789" />
            </div>
            <div className="form-group">
              <label>Dirección:</label>
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle Principal 123, Madrid" />
            </div>
            <div className="form-group">
              <label>Ciudad:</label>
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Madrid" />
            </div>
            <div className="form-group">
              <label>Código postal:</label>
              <input type="text" value={postal} onChange={(e) => setPostal(e.target.value)} placeholder="28001" />
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={async () => {
              // Verificar si ya se editó hoy
              const lastEdit = localStorage.getItem('su_prime_shipping_last_edit');
              const today = new Date().toISOString().split('T')[0];
              if (lastEdit === today) {
                alert('Solo puedes editar tus datos de envío una vez al día. Vuelve mañana.');
                return;
              }
              await onSaveShipping({ full_name: name, phone, address, city, postal_code: postal });
              localStorage.setItem('su_prime_shipping_last_edit', today);
              alert('Datos de envío guardados en la nube');
            }}>
              💾 Guardar datos de envío
            </button>
            {localStorage.getItem('su_prime_shipping_last_edit') === new Date().toISOString().split('T')[0] && (
              <p style={{ color: '#68736b', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                ⚠️ Ya editaste tus datos hoy. Podrás editarlos mañana.
              </p>
            )}
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>Mis pedidos</h3>
            {ordersLoading && <p>Cargando pedidos...</p>}
            {!ordersLoading && orders.length === 0 && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Aún no tienes pedidos.</p>
            )}
            {orders.map(o => (
              <div key={o.id} className="user-order">
                <button
                  type="button"
                  className="user-order-header"
                  onClick={() => loadOrderDetail(o.id)}
                >
                  <span style={{ fontFamily: 'monospace' }}>{o.id.slice(0, 8)}…</span>
                  <span className={`order-status order-status-${o.status}`}>{ORDER_STATUS_LABELS[o.status] || o.status}</span>
                  <span>{formatPrice(o.total_cents)}</span>
                </button>
                {openOrder?.id === o.id && (
                  <div className="user-order-detail">
                    {openOrder.items.map((it, i) => (
                      <p key={i}>{it.product_name || it.product_id} × {it.quantity} — {formatPrice(it.price_cents * it.quantity)}</p>
                    ))}
                    <small style={{ color: 'var(--text-secondary)' }}>
                      {o.created_at ? new Date(o.created_at).toLocaleString('es-ES') : ''}
                    </small>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem' }}>
            <button className="btn btn-secondary" style={{ width: '100%', borderColor: '#a3422b', color: '#a3422b' }} onClick={onLogout}>
              Cerrar Sesión
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
