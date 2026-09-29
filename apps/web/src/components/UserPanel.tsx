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
  onSaveProfile: (displayName: string) => Promise<void>;
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

const SPANISH_PROVINCES = ['Álava','Albacete','Alicante','Almería','Asturias','Ávila','Badajoz','Barcelona','Burgos','Cáceres','Cádiz','Cantabria','Castellón','Ceuta','Ciudad Real','Córdoba','Cuenca','Girona','Granada','Guadalajara','Guipúzcoa','Huelva','Huesca','Islas Baleares','Jaén','La Coruña','La Rioja','Las Palmas','León','Lleida','Lugo','Madrid','Málaga','Melilla','Murcia','Navarra','Orense','Palencia','Pontevedra','Salamanca','Santa Cruz de Tenerife','Segovia','Sevilla','Soria','Tarragona','Teruel','Toledo','Valencia','Valladolid','Vizcaya','Zamora','Zaragoza'];

export function UserPanel({ user, apiUrl, sessionToken, onClose, onLogout, onSaveShipping, onSaveProfile }: UserPanelProps) {
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [name, setName] = useState(user.shipping?.full_name || '');
  const [phone, setPhone] = useState(user.shipping?.phone || '');
  const [address, setAddress] = useState(user.shipping?.address || '');
  const [city, setCity] = useState(user.shipping?.city || '');
  const [postal, setPostal] = useState(user.shipping?.postal_code || '');
  const [locating, setLocating] = useState(false);
  const [locateMsg, setLocateMsg] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const editedToday = typeof localStorage !== 'undefined'
    && localStorage.getItem('su_prime_shipping_last_edit') === new Date().toISOString().split('T')[0];
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

  // Rellena ciudad/CP con la ubicación actual (el portal solo pide permiso;
  // la calle se completa a mano). Falla silenciosamente sin GPS o sin red.
  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocateMsg('Tu dispositivo no ofrece geolocalización.');
      return;
    }
    setLocating(true);
    setLocateMsg('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=es`,
            { signal: AbortSignal.timeout(8000) }
          );
          const geo = await res.json();
          if (geo?.city) setCity(geo.city);
          if (geo?.postcode) setPostal(String(geo.postcode));
          setLocateMsg(geo?.city ? `Ubicación: ${geo.city}${geo.postcode ? ` (${geo.postcode})` : ''}. Revisa la calle.` : 'Ubicación obtenida. Completa la calle.');
        } catch {
          setLocateMsg('No se pudo resolver la dirección. Introdúcela a mano.');
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        setLocateMsg(
          err?.code === 1
            ? 'Permiso de ubicación denegado. Actívalo en el navegador o introduce la dirección a mano.'
            : err?.code === 3
              ? 'La ubicación tardó demasiado (típico en interiores). Introdúcela a mano.'
              : 'Ubicación no disponible aquí. Introdúcela a mano.'
        );
      },
      { timeout: 8000, maximumAge: 600000, enableHighAccuracy: false }
    );
  };

  const saveName = async () => {
    const clean = displayName.trim();
    if (!clean || clean === user.display_name) {
      setEditingName(false);
      setDisplayName(user.display_name || '');
      return;
    }
    setSavingName(true);
    try {
      await onSaveProfile(clean);
      setEditingName(false);
    } catch {
      alert('No se pudo guardar el nombre.');
    } finally {
      setSavingName(false);
    }
  };
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
            {editingName ? (
              <p>
                <strong>Nombre:</strong>{' '}
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={100}
                  style={{ maxWidth: '180px' }}
                  aria-label="Nombre visible"
                />{' '}
                <button className="btn btn-secondary btn-sm" onClick={saveName} disabled={savingName}>
                  {savingName ? '…' : 'Guardar'}
                </button>{' '}
                <button className="btn btn-secondary btn-sm" onClick={() => { setEditingName(false); setDisplayName(user.display_name || ''); }}>
                  Cancelar
                </button>
              </p>
            ) : (
              <p><strong>Nombre:</strong> {user.display_name}{' '}
                <button className="btn btn-secondary btn-sm" onClick={() => setEditingName(true)} aria-label="Editar nombre">
                  ✏️
                </button>
              </p>
            )}
            {(user.role_id === 'role-owner' || user.role_id === 'role-admin' || user.role_id === 'role-stock-manager') && (
              <p><strong>Rol:</strong> {user.role_id.replace('role-', '').replace('_', ' ')}</p>
            )}
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>Vincular cuenta de Google</h3>
            <p style={{ color: '#68736b', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
              Disponible tras la apertura (el login con Google ya funciona para entrar).
            </p>
            <button className="btn btn-secondary" style={{ width: '100%' }} disabled title="Disponible tras la apertura">
              🔗 Vincular con Google
            </button>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>Datos de envío</h3>
            <p style={{ color: '#68736b', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
              Estos datos se usarán automáticamente en el checkout. Sin ellos completos no podrás comprar.
            </p>
            <button className="btn btn-secondary" style={{ width: '100%', marginBottom: '0.75rem' }} onClick={useMyLocation} disabled={locating}>
              {locating ? '📍 Localizando…' : '📍 Usar mi ubicación actual'}
            </button>
            {locateMsg && (
              <p style={{ color: '#68736b', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{locateMsg}</p>
            )}
            <div className="form-group">
              <label htmlFor="up-name">Nombre completo:</label>
              <input id="up-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Juan Pérez" autoComplete="name" />
            </div>
            <div className="form-group">
              <label htmlFor="up-phone">Teléfono:</label>
              <input id="up-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+34 612 345 678" pattern="\+?[0-9\s.\-()]{9,20}" title="9-15 dígitos, p. ej. +34 612 345 678" autoComplete="tel" />
            </div>
            <div className="form-group">
              <label htmlFor="up-address">Dirección:</label>
              <input id="up-address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle Principal 123, 2ºB" autoComplete="street-address" />
            </div>
            <div className="form-group">
              <label htmlFor="up-city">Ciudad:</label>
              <input id="up-city" type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Madrid" list="suprime-provinces" autoComplete="address-level2" />
              <datalist id="suprime-provinces">
                {SPANISH_PROVINCES.map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div className="form-group">
              <label htmlFor="up-postal">Código postal:</label>
              <input id="up-postal" type="text" inputMode="numeric" value={postal} onChange={(e) => setPostal(e.target.value)} placeholder="28001" pattern="[0-9]{5}" title="5 dígitos, p. ej. 28001" maxLength={5} autoComplete="postal-code" />
            </div>
            {editedToday && (
              <p style={{ color: '#68736b', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                ⚠️ Ya editaste tus datos hoy. Podrás editarlos mañana.
              </p>
            )}
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={editedToday} onClick={async () => {
              if (!name.trim() || !phone.trim() || !address.trim() || !city.trim() || !postal.trim()) {
                alert('Completa nombre, teléfono, dirección, ciudad y código postal.');
                return;
              }
              try {
                await onSaveShipping({ full_name: name.trim(), phone: phone.trim(), address: address.trim(), city: city.trim(), postal_code: postal.trim() });
              } catch (err) {
                alert(err instanceof Error ? err.message : 'No se pudo guardar.');
                return;
              }
              localStorage.setItem('su_prime_shipping_last_edit', new Date().toISOString().split('T')[0]);
              setSavedMsg('Datos de envío guardados en la nube ✓');
            }}>
              💾 Guardar datos de envío
            </button>
            {savedMsg && (
              <p style={{ color: 'var(--accent)', fontSize: '0.85rem', marginTop: '0.5rem' }}>{savedMsg}</p>
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
