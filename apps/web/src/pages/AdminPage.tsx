import { useState, useEffect } from 'react';
import type { User } from '../types';
import { ImageManager } from '../components/ImageManager';

type AdminStats = {
  products: number;
  orders: number;
  users: number;
  revenue: number;
};

type AdminProduct = {
  id: string;
  name: string;
  description: string;
  image_url: string;
  price_cents: number;
  stock_quantity: number;
  status: string;
  images?: string[];
};

type AdminPageProps = {
  user: User;
  sessionToken: string;
  apiUrl: string;
  onBack: () => void;
};

export function AdminPage({ user, sessionToken, apiUrl, onBack }: AdminPageProps) {
  const [activeTab, setActiveTab] = useState<'stats' | 'users' | 'orders' | 'products' | 'settings'>('stats');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [totpError, setTotpError] = useState('');
  const [totpLoading, setTotpLoading] = useState(false);
  const [showTotpSetup, setShowTotpSetup] = useState(false);
  const [totpSecret, setTotpSecret] = useState('');
  const [totpUri, setTotpUri] = useState('');
  const [totpEnabled, setTotpEnabled] = useState(false);

  // Product form state
  const [productName, setProductName] = useState('');
  const [productDesc, setProductDesc] = useState('');
  const [productImages, setProductImages] = useState<string[]>([]);
  const [productPrice, setProductPrice] = useState('');
  const [productStock, setProductStock] = useState('');

  // Step-up 2FA del panel: el middleware exige concesión de ≤1h.
  // 'checking' -> 'ok' | 'code' (pedir código) | 'setup' (configurar 2FA primero)
  const [stepUp, setStepUp] = useState<'checking' | 'ok' | 'code' | 'setup'>('checking');

  const checkStepUp = async () => {
    try {
      const res = await fetch(`${apiUrl}/admin/stats`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        credentials: 'include',
      });
      if (res.ok) {
        setStepUp('ok');
        return;
      }
      if (res.status === 401) {
        // Sesión muerta: fuera del panel en vez de pedir códigos en bucle
        alert('Tu sesión expiró. Inicia sesión de nuevo.');
        onBack();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.error === 'ADMIN_2FA_SETUP_REQUIRED') {
        setStepUp('setup');
        handleSetup2FA();
      } else {
        setStepUp('code');
      }
    } catch {
      setStepUp('code');
    }
  };

  const handleStepUp = async () => {
    if (!totpCode || totpCode.length !== 6) {
      setTotpError('Introduce el código de 6 dígitos de tu app');
      return;
    }
    setTotpLoading(true);
    setTotpError('');
    try {
      const res = await fetch(`${apiUrl}/auth/admin-stepup`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: totpCode }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStepUp('ok');
        setTotpCode('');
      } else {
        setTotpError(data.error === 'INVALID_TOTP_CODE'
          ? 'Código incorrecto. Revisa la hora de tu teléfono y usa el código actual.'
          : (data.message || 'Error de verificación'));
      }
    } catch {
      setTotpError('Error de conexión');
    } finally {
      setTotpLoading(false);
    }
  };

  // Los datos solo se cargan con step-up vigente
  useEffect(() => {
    checkStepUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, sessionToken]);

  useEffect(() => {
    if (stepUp !== 'ok') return;
    fetchStats();
    if (activeTab === 'products' || activeTab === 'stats') fetchProducts();
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'orders') fetchOrders(0);
  }, [activeTab, stepUp]);

  // Cerrar sidebar con Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Check TOTP status on mount
  useEffect(() => {
    const checkTotpStatus = async () => {
      try {
        const res = await fetch(`${apiUrl}/auth/me/totp/status`, {
          headers: { 'Authorization': `Bearer ${sessionToken}` },
          credentials: 'include',
        });
        const data = await res.json();
        if (data.data?.enabled) {
          setTotpEnabled(true);
        }
      } catch (err) {
        console.error('Error checking TOTP status:', err);
      }
    };
    checkTotpStatus();
  }, [apiUrl, sessionToken]);

  const handleSetup2FA = async () => {
    // Con 2FA activo no se regenera (evita secuestro si la sesión se filtra;
    // para cambiarlo, desactívalo primero con step-up vigente).
    if (totpEnabled) return;
    setTotpLoading(true);
    try {
      const res = await fetch(`${apiUrl}/auth/me/totp/setup`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        setTotpSecret(data.data.secret);
        setTotpUri(data.data.otpauth_uri);
        setShowTotpSetup(true);
      }
    } catch (err) {
      console.error('Error setting up 2FA:', err);
    } finally {
      setTotpLoading(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!window.confirm('¿Desactivar la verificación en dos pasos de esta cuenta? Podrás activarla de nuevo después.')) return;
    setTotpLoading(true);
    try {
      const res = await fetch(`${apiUrl}/auth/me/totp/disable`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        credentials: 'include',
      });
      if (res.ok) {
        setTotpEnabled(false);
      } else {
        alert('No se pudo desactivar. Revalida tu código 2FA entrando de nuevo al panel.');
      }
    } catch {
      alert('Error de conexión.');
    } finally {
      setTotpLoading(false);
    }
  };

  const handleEnable2FA = async () => {
    if (!totpCode || totpCode.length !== 6) {
      setTotpError('Introduce un código de 6 dígitos');
      return;
    }
    setTotpLoading(true);
    setTotpError('');
    try {
      const res = await fetch(`${apiUrl}/auth/me/totp/verify`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: totpCode }),
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        setShowTotpSetup(false);
        setTotpEnabled(true);
        setTotpCode('');
        setTotpSecret('');
        setTotpUri('');
        // El backend concede step-up al activar: entrar directo
        setStepUp('ok');
      } else {
        setTotpError(data.error === 'INVALID_TOTP_CODE' ? 'Código incorrecto' : 'Error de verificación');
      }
    } catch (err) {
      setTotpError('Error de conexión');
    } finally {
      setTotpLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${apiUrl}/admin/stats`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        credentials: 'include',
      });
      const data = await res.json();
      if (data.data) setStats(data.data);
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/catalog/products`);
      const data = await res.json();
      if (data.data) setProducts(data.data);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${apiUrl}/admin/users`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        credentials: 'include',
      });
      const data = await res.json();
      if (data.data) setUsers(data.data);
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const [users, setUsers] = useState<any[]>([]);

  const [orders, setOrders] = useState<any[]>([]);
  const [ordersPage, setOrdersPage] = useState(0);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const ORDERS_PAGE_SIZE = 20;

  const ORDERS_NEXT: Record<string, string[]> = {
    pending: ['paid', 'cancelled'],
    paid: ['shipped', 'cancelled'],
    shipped: ['delivered'],
    delivered: [],
    cancelled: [],
  };

  const changeOrderStatus = async (orderId: string, next: string) => {
    try {
      const res = await fetch(`${apiUrl}/admin/orders/${orderId}/status`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || 'No se pudo cambiar el estado');
        return;
      }
      fetchOrders(ordersPage);
      fetchStats();
    } catch {
      alert('Error de conexión');
    }
  };

  const fetchOrders = async (page: number) => {
    try {
      const res = await fetch(`${apiUrl}/admin/orders?limit=${ORDERS_PAGE_SIZE}&offset=${page * ORDERS_PAGE_SIZE}`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        credentials: 'include',
      });
      const data = await res.json();
      if (data.data) {
        setOrders(data.data);
        setOrdersPage(page);
        setOrdersTotal(data.pagination?.total || 0);
      }
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const createProduct = async () => {
    try {
      const res = await fetch(`${apiUrl}/admin/products`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          name: productName,
          description: productDesc,
          image_url: productImages[0] || '',
          images: productImages,
          price_cents: Math.round(parseFloat(productPrice) * 100),
          stock_quantity: parseInt(productStock),
        }),
      });
      const data = await res.json();
      if (data.data) {
        setShowProductForm(false);
        resetProductForm();
        fetchProducts();
        fetchStats();
      } else {
        alert('Error: ' + (data.error || 'unknown'));
      }
    } catch (err) {
      alert('Error creating product');
    }
  };

  const updateProduct = async () => {
    if (!editingProduct) return;
    try {
      const res = await fetch(`${apiUrl}/admin/products/${editingProduct.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          name: productName || editingProduct.name,
          description: productDesc || editingProduct.description,
          image_url: productImages[0] || editingProduct.image_url,
          images: productImages.length > 0 ? productImages : editingProduct.images || [editingProduct.image_url],
          price_cents: Math.round(parseFloat(productPrice) * 100),
          stock_quantity: parseInt(productStock),
        }),
      });
      const data = await res.json();
      if (data.data) {
        setEditingProduct(null);
        resetProductForm();
        fetchProducts();
        fetchStats();
      } else {
        alert('Error: ' + (data.error || 'unknown'));
      }
    } catch (err) {
      alert('Error updating product');
    }
  };

  const deleteProduct = async (productId: string) => {
    if (!confirm('¿Estás seguro de eliminar este producto?')) return;
    try {
      const res = await fetch(`${apiUrl}/admin/products/${productId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        credentials: 'include',
      });
      if (res.ok) {
        fetchProducts();
        fetchStats();
      }
    } catch (err) {
      alert('Error deleting product');
    }
  };

  const resetProductForm = () => {
    setProductName('');
    setProductDesc('');
    setProductImages([]);
    setProductPrice('');
    setProductStock('');
  };

  const startEditProduct = (product: AdminProduct) => {
    setEditingProduct(product);
    setProductName(product.name);
    setProductDesc(product.description);
    setProductImages(product.images?.length ? product.images : (product.image_url ? [product.image_url] : []));
    setProductPrice((product.price_cents / 100).toFixed(2));
    setProductStock(product.stock_quantity.toString());
    setShowProductForm(true);
  };

  const tabs = [
    { id: 'stats', label: 'Dashboard', icon: '📊' },
    { id: 'products', label: 'Productos', icon: '📦' },
    { id: 'users', label: 'Usuarios', icon: '👥' },
    { id: 'orders', label: 'Órdenes', icon: '📋' },
    { id: 'settings', label: 'Configuración', icon: '⚙️' },
  ];

  // Jerarquía: stock_manager gestiona catálogo y pedidos; usuarios y ajustes
  // de tienda son owner/admin (el servidor lo exige igual: PUT /settings 403).
  const canManageStore = user.role_id === 'role-owner' || user.role_id === 'role-admin';
  const visibleTabs = tabs.filter((t) =>
    (t.id === 'users' || t.id === 'settings') ? canManageStore : true
  );

  // Ajustes de tienda (owner/admin)
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [settingsMsg, setSettingsMsg] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    if (activeTab !== 'settings' || !canManageStore || settings) return;
    fetch(`${apiUrl}/admin/settings`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` },
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((payload) => { if (payload.data) setSettings(payload.data); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, apiUrl, sessionToken]);

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    setSettingsMsg('');
    try {
      const res = await fetch(`${apiUrl}/admin/settings`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          store_name: settings.store_name ?? '',
          store_description: settings.store_description ?? '',
          shipping_cost: settings.shipping_cost ?? '',
          free_shipping_threshold: settings.free_shipping_threshold ?? '',
          tax_rate: settings.tax_rate ?? '',
          maintenance_mode: settings.maintenance_mode ?? '0',
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSettingsMsg(payload.message || 'No se pudo guardar (¿permisos?)');
        return;
      }
      setSettingsMsg('✓ Configuración guardada. Los portes aplican al instante.');
    } catch {
      setSettingsMsg('Error de conexión.');
    } finally {
      setSavingSettings(false);
    }
  };

  // NOTA: el 2FA se verifica en el login (POST /auth/verify-2fa), no aquí.
  // Este panel asume sesión válida (el middleware admin la exige).

  // Step-up 2FA al entrar al panel (concesión de 1 hora)
  if (stepUp === 'checking') {
    return (
      <div className="admin-page">
        <div className="admin-main">
          <div className="loading"><div className="spinner"></div></div>
        </div>
      </div>
    );
  }

  if (stepUp === 'code') {
    return (
      <div className="modal-overlay">
        <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Verificación en dos pasos">
          <div className="modal-header">
            <h2>Verificación de Dos Pasos</h2>
            <button className="close-btn" onClick={onBack} aria-label="Cerrar diálogo">✕</button>
          </div>
          <div className="form">
            <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
              Por seguridad, confirma tu identidad para entrar al panel.
              Esta verificación vale por 1 hora.
            </p>
            <div className="form-group">
              <label htmlFor="admin-stepup-code">Código de tu app de autenticación</label>
              <input
                id="admin-stepup-code"
                type="text"
                inputMode="numeric"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                autoComplete="one-time-code"
                className="otp-input"
              />
            </div>
            {totpError && <p className="error" style={{ color: 'var(--error)', marginBottom: '1rem' }}>{totpError}</p>}
            <div className="form-actions">
              <button className="btn btn-primary btn-glow" onClick={handleStepUp} disabled={totpLoading}>
                {totpLoading ? 'Verificando...' : 'Verificar y entrar'}
              </button>
              <button className="btn btn-secondary" onClick={onBack}>Cancelar</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show 2FA setup modal
  if (showTotpSetup) {    return (
      <div className="modal-overlay">
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Configurar Verificación de Dos Pasos</h2>
            <button className="close-btn" onClick={() => setShowTotpSetup(false)}>✕</button>
          </div>
          <div className="form">
            <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
              Escanea este código QR con tu aplicación de autenticación (Google Authenticator, Authy, etc.)
            </p>
            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <div style={{
                width: '200px',
                height: '200px',
                margin: '0 auto',
                background: 'white',
                padding: '10px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(totpUri)}`}
                  alt="QR Code"
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Secreto (manual)</label>
              <input
                type="text"
                value={totpSecret}
                readOnly
                style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="admin-totp-verify">Código de Verificación</label>
              <input
                id="admin-totp-verify"
                type="text"
                inputMode="numeric"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                autoComplete="one-time-code"
                className="otp-input"
              />
            </div>
            {totpError && <p className="error" style={{ color: 'var(--error)', marginBottom: '1rem' }}>{totpError}</p>}
            <div className="form-actions">
              <button className="btn btn-primary btn-glow" onClick={handleEnable2FA} disabled={totpLoading}>
                {totpLoading ? 'Activando...' : 'Activar 2FA'}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowTotpSetup(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      {/* Mobile Sidebar Overlay */}
      <div
        className={`admin-sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Mobile Sidebar Toggle */}
      <button
        className="admin-sidebar-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle sidebar"
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* Sidebar */}
      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="admin-sidebar-header">
          <div className="admin-sidebar-logo">⚡</div>
          <span className="admin-sidebar-title">SUPRIME</span>
        </div>

        <nav className="admin-sidebar-nav">
          {visibleTabs.map(tab => (
            <button
              key={tab.id}
              className={`admin-sidebar-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(tab.id as any);
                setSidebarOpen(false);
              }}
            >
              <span className="admin-sidebar-icon">{tab.icon}</span>
              <span className="admin-sidebar-label">{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-sidebar-user">
            <div className="admin-sidebar-avatar">👤</div>
            <div className="admin-sidebar-user-info">
              <div className="admin-sidebar-username">{user.display_name || user.username}</div>
              <div className="admin-sidebar-role">{user.role_id.replace('role-', '')}</div>
            </div>
          </div>
          <button
            className={`admin-sidebar-item ${totpEnabled ? 'active' : ''}`}
            onClick={totpEnabled ? undefined : handleSetup2FA}
            disabled={totpEnabled}
            title={totpEnabled ? '2FA ya activado en esta cuenta' : 'Configurar verificación en dos pasos'}
            style={{ marginTop: '0.5rem' }}
          >
            <span className="admin-sidebar-icon">{totpEnabled ? '✅' : '🔐'}</span>
            <span className="admin-sidebar-label">{totpEnabled ? '2FA Activado' : 'Configurar 2FA'}</span>
          </button>
          {totpEnabled && (
            <button
              className="admin-sidebar-item"
              onClick={handleDisable2FA}
              title="Desactivar 2FA (exige step-up vigente)"
            >
              <span className="admin-sidebar-icon">🚫</span>
              <span className="admin-sidebar-label">Desactivar 2FA</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="admin-main">
        <div className="admin-header">
          <button className="btn btn-secondary" onClick={onBack}>← Volver</button>
          <h1 className="admin-header-title">Panel de Administración</h1>
          <div className="admin-header-actions">
            <span className="admin-header-user">
              👤 {user.display_name || user.username}
              <span className="admin-role-badge">{user.role_id.replace('role-', '')}</span>
            </span>
          </div>
        </div>

        <div className="admin-content-wrapper">
          {loading && <div className="loading"><div className="spinner"></div></div>}

        {/* DASHBOARD TAB */}
        {activeTab === 'stats' && stats && (
          <div className="admin-stats">
            <div className="stat-card">
              <div className="stat-value">{stats.products}</div>
              <div className="stat-label">Productos</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.orders}</div>
              <div className="stat-label">Órdenes</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.users}</div>
              <div className="stat-label">Usuarios</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{(stats.revenue / 100).toFixed(2)}€</div>
              <div className="stat-label">Ingresos</div>
            </div>
          </div>
        )}
        {activeTab === 'stats' && (() => {
          const lowStock = products.filter(p => p.stock_quantity <= 5);
          if (lowStock.length === 0) return null;
          return (
            <div className="admin-low-stock">
              <h3>⚠️ Stock bajo ({lowStock.length})</h3>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Stock</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.slice(0, 10).map(p => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{p.stock_quantity === 0 ? '❌ Agotado' : `⚠️ ${p.stock_quantity}`}</td>
                      <td>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => { startEditProduct(p); setActiveTab('products'); }}
                        >
                          Reponer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* PRODUCTS TAB */}
        {activeTab === 'products' && (
          <div className="admin-products">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2>Gestión de Productos</h2>
              <button className="btn btn-primary btn-glow" onClick={() => { setShowProductForm(true); setEditingProduct(null); resetProductForm(); }}>
                ➕ Nuevo Producto
              </button>
            </div>

            {showProductForm && (
              <div className="admin-product-form">
                <h3>{editingProduct ? 'Editar Producto' : 'Nuevo Producto'}</h3>
                <div className="form-group">
                  <label>Nombre:</label>
                  <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Nombre del producto" />
                </div>
                <div className="form-group">
                  <label>Descripción:</label>
                  <textarea value={productDesc} onChange={(e) => setProductDesc(e.target.value)} placeholder="Descripción del producto" />
                </div>
                <div className="form-group">
                  <label>Imágenes del Producto:</label>
                  <ImageManager
                    images={productImages}
                    onChange={setProductImages}
                    maxImages={10}
                    apiUrl={apiUrl}
                    authToken={sessionToken}
                  />
                </div>
                <div className="form-group">
                  <label>Precio (€):</label>
                  <input type="number" inputMode="decimal" step="0.01" value={productPrice} onChange={(e) => setProductPrice(e.target.value)} placeholder="0.00" />
                </div>
                <div className="form-group">
                  <label>Stock:</label>
                  <input type="number" inputMode="numeric" value={productStock} onChange={(e) => setProductStock(e.target.value)} placeholder="0" />
                </div>
                <div className="form-actions">
                  <button className="btn btn-primary" onClick={editingProduct ? updateProduct : createProduct}>
                    {editingProduct ? '💾 Guardar' : '➕ Crear'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setShowProductForm(false); setEditingProduct(null); }}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <div className="table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Precio</th>
                  <th>Stock</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{(p.price_cents / 100).toFixed(2)}€</td>
                    <td>{p.stock_quantity}</td>
                    <td>{p.status === 'active' ? '✅' : '❌'}</td>
                    <td>
                      <button className="btn btn-sm btn-secondary" onClick={() => startEditProduct(p)}>✏️</button>
                      <button className="btn btn-sm btn-danger" onClick={() => deleteProduct(p.id)}>🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* USERS TAB */}
        {activeTab === 'users' && (
          <div className="admin-users">
            <h2>Gestión de Usuarios</h2>
            <div className="table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>{u.email}</td>
                    <td>
                      <select
                        value={u.role_id}
                        onChange={async (e) => {
                          await fetch(`${apiUrl}/admin/users/${u.id}/role`, {
                            method: 'PUT',
                            headers: {
                              'Authorization': `Bearer ${sessionToken}`,
                              'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ role_id: e.target.value }),
                          });
                          fetchUsers();
                        }}
                        className="role-select"
                      >
                        <option value="role-customer">Customer</option>
                        <option value="role-stock-manager">Stock Manager</option>
                        <option value="role-admin">Admin</option>
                        <option value="role-owner">Owner</option>
                      </select>
                    </td>
                    <td>{u.is_active ? '✅ Activo' : '❌ Inactivo'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* ORDERS TAB */}
        {activeTab === 'orders' && (
          <div className="admin-orders">
            <h2>Gestión de Órdenes{ordersTotal > 0 && ` (${ordersTotal})`}</h2>
            {orders.length === 0 ? (
              <p>No hay órdenes todavía.</p>
            ) : (
              <>
                <div className="table-wrapper">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Cliente</th>
                        <th>Total</th>
                        <th>Estado</th>
                        <th>Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(o => (
                        <tr key={o.id}>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{String(o.id).slice(0, 8)}…</td>
                          <td>{o.username || o.email || '—'}</td>
                          <td>{(o.total_cents / 100).toFixed(2)}€</td>
                          <td>
                            <select
                              value={o.status}
                              onChange={(e) => changeOrderStatus(o.id, e.target.value)}
                              className="order-status-select"
                              aria-label={`Cambiar estado de orden ${String(o.id).slice(0, 8)}`}
                            >
                              <option value={o.status}>{o.status}</option>
                              {(ORDERS_NEXT[o.status] || []).map(s => (
                                <option key={s} value={s}>→ {s}</option>
                              ))}
                            </select>
                          </td>
                          <td>{o.created_at ? new Date(o.created_at).toLocaleDateString('es-ES') : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {ordersTotal > ORDERS_PAGE_SIZE && (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => fetchOrders(ordersPage - 1)}
                      disabled={ordersPage === 0}
                    >
                      ← Anterior
                    </button>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      Página {ordersPage + 1} de {Math.ceil(ordersTotal / ORDERS_PAGE_SIZE)}
                    </span>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => fetchOrders(ordersPage + 1)}
                      disabled={(ordersPage + 1) * ORDERS_PAGE_SIZE >= ordersTotal}
                    >
                      Siguiente →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* SETTINGS TAB (owner/admin) */}
        {activeTab === 'settings' && canManageStore && (
          <div className="admin-settings">
            <h2>Configuración de la Tienda</h2>
            {!settings && <p>Cargando…</p>}
            {settings && (
              <>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                  Los portes se aplican al instante en el checkout. El modo mantenimiento
                  cierra la compra (la tienda se puede mirar, pero no pedir).
                </p>
                <div className="form-group">
                  <label htmlFor="set-name">Nombre de la tienda:</label>
                  <input id="set-name" type="text" value={settings.store_name ?? ''} onChange={(e) => setSettings({ ...settings, store_name: e.target.value })} maxLength={60} />
                </div>
                <div className="form-group">
                  <label htmlFor="set-desc">Descripción:</label>
                  <input id="set-desc" type="text" value={settings.store_description ?? ''} onChange={(e) => setSettings({ ...settings, store_description: e.target.value })} maxLength={200} />
                </div>
                <div className="form-row-2col">
                  <div className="form-group">
                    <label htmlFor="set-ship">Envío (€):</label>
                    <input id="set-ship" type="number" inputMode="decimal" step="0.01" min="0" value={((parseInt(settings.shipping_cost ?? '490', 10) || 0) / 100).toFixed(2)} onChange={(e) => setSettings({ ...settings, shipping_cost: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="set-threshold">Gratis desde (€):</label>
                    <input id="set-threshold" type="number" inputMode="decimal" step="1" min="0" value={((parseInt(settings.free_shipping_threshold ?? '6000', 10) || 0) / 100).toFixed(0)} onChange={(e) => setSettings({ ...settings, free_shipping_threshold: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="set-tax">IVA (%):</label>
                  <input id="set-tax" type="number" inputMode="decimal" step="1" min="0" max="100" value={settings.tax_rate ?? ''} onChange={(e) => setSettings({ ...settings, tax_rate: e.target.value })} />
                </div>
                <div className="form-group remember-me">
                  <label className="checkbox-label" htmlFor="set-maint" style={{ minHeight: '44px' }}>
                    <input
                      id="set-maint"
                      type="checkbox"
                      checked={settings.maintenance_mode === '1'}
                      onChange={(e) => setSettings({ ...settings, maintenance_mode: e.target.checked ? '1' : '0' })}
                    />
                    <span>🔧 Modo mantenimiento (cierra la compra)</span>
                  </label>
                </div>
                <div className="form-actions">
                  <button className="btn btn-primary" onClick={saveSettings} disabled={savingSettings}>
                    {savingSettings ? 'Guardando…' : '💾 Guardar configuración'}
                  </button>
                </div>
                {settingsMsg && <p style={{ marginTop: '0.75rem' }}>{settingsMsg}</p>}
              </>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
