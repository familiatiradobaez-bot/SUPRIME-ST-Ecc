import { useState, useEffect } from 'react';
import type { User } from '../types';
import { ImageManager } from '../components/ImageManager';
import { CatalogManager } from '../components/CatalogManager';
import { BorradoresPanel } from '../components/BorradoresPanel';
import { EarningsPanel } from '../components/EarningsPanel';
import type { CatalogDepartment } from '../components/CatalogManager';
// La CSS del panel se importa desde main.tsx, no desde aquí. Estaba en este
// archivo para code-split, pero Vite la emitía como archivo aparte y, si ese
// archivo no se descargaba, el import dinámico del panel entero fallaba y la
// pantalla quedaba en blanco. Ver el comentario en main.tsx.

type AdminStats = {
  products: number;
  orders: number;
  users: number;
  revenue: number;
};

// WebAuthn en base64url: puente entre lo que devuelve la API y lo que espera
// el navegador (challenge, credencial, firma).
function b64uToBuf(value: string): ArrayBuffer {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function bufToB64u(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type AdminProduct = {
  id: string;
  name: string;
  description: string;
  image_url: string;
  price_cents: number;
  stock_quantity: number;
  status: string;
  images?: string[];
  subdepartment_id?: string;
  department_name?: string;
  subdepartment_name?: string;
};

type AdminPageProps = {
  user: User;
  sessionToken: string;
  apiUrl: string;
  onBack: () => void;
};

export function AdminPage({ user, sessionToken, apiUrl, onBack }: AdminPageProps) {
  const [activeTab, setActiveTab] = useState<'stats' | 'earnings' | 'users' | 'orders' | 'products' | 'catalog' | 'borradores' | 'settings'>('stats');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [totpError, setTotpError] = useState('');
  const [totpLoading, setTotpLoading] = useState(false);
  // Segundo factor con la huella (passkey) en vez del código TOTP.
  const [pkStepupSupported, setPkStepupSupported] = useState<boolean | null>(null);
  const [pkStepupLoading, setPkStepupLoading] = useState(false);
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
  const [productSubId, setProductSubId] = useState('');
  const [productStatus, setProductStatus] = useState<'draft' | 'active'>('draft');

  // Jerarquía de catálogo: alimenta el selector de subdepartamento del producto.
  const [catalog, setCatalog] = useState<CatalogDepartment[]>([]);

  // Step-up 2FA del panel: el middleware exige concesión de ≤1h.
  // 'checking' -> 'ok' | 'code' (pedir código) | 'setup' (configurar 2FA primero)
  const [stepUp, setStepUp] = useState<'checking' | 'ok' | 'code' | 'setup'>('checking');
  const [lockingPanel, setLockingPanel] = useState(false);

  // "Bloquear panel": tira el grant de 1 h sin cerrar la sesión de la tienda.
  // Sin esto, dejar el panel abierto en un ordenador compartido daba acceso al
  // admin durante una hora sin volver a pedir el código.
  const handleLockPanel = async () => {
    if (lockingPanel) return;
    setLockingPanel(true);
    try {
      const res = await fetch(`${apiUrl}/auth/admin-stepup/revoke`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        credentials: 'include',
      });
      if (!res.ok && res.status !== 401) {
        console.error('No se pudo bloquear el panel:', res.status);
      }
      // Se vuelve a comprobar el paso real: si el revoke falló, checkStepUp
      // seguirá diciendo 'ok' y el panel se queda como estaba.
      checkStepUp();
    } catch {
      checkStepUp();
    } finally {
      setLockingPanel(false);
    }
  };

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
      // 403 es esperado (step-up requerido), no es error de consola
      const data = await res.json().catch(() => ({}));
      if (data.error === 'ADMIN_2FA_SETUP_REQUIRED') {
        setStepUp('setup');
        handleSetup2FA();
      } else if (res.status === 403) {
        setStepUp('code');
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

  // ── Step-up con la huella (passkey) ─────────────────────────────────────
  // Pregunta al servidor si este usuario tiene passkeys y si el navegador
  // soporta la API. Solo entonces se ofrece el botón.
  useEffect(() => {
    if (stepUp !== 'code') return;
    let cancelled = false;
    const canUse = typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';
    setPkStepupSupported(canUse);
    if (!canUse) return;
    fetch(`${apiUrl}/auth/passkey/stepup/options`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      credentials: 'include',
    })
      .then((r) => r.status !== 404)
      .then((hayPasskey) => { if (!cancelled) setPkStepupSupported(!!hayPasskey); })
      .catch(() => { if (!cancelled) setPkStepupSupported(false); });
    return () => { cancelled = true; };
  }, [stepUp, apiUrl, sessionToken]);

  const handlePasskeyStepUp = async () => {
    setPkStepupLoading(true);
    setTotpError('');
    try {
      const optRes = await fetch(`${apiUrl}/auth/passkey/stepup/options`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const optPayload = await optRes.json();
      if (!optRes.ok) { setTotpError(optPayload.message || 'No hay passkeys registrados'); return; }
      const o = optPayload.data;

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: b64uToBuf(o.challenge),
          rpId: o.rpId,
          timeout: o.timeout,
          userVerification: o.userVerification,
          allowCredentials: (o.allowCredentials || []).map((c: any) => ({ id: b64uToBuf(c.id), type: 'public-key' })),
        },
      }) as PublicKeyCredential | null;
      if (!assertion) { setTotpError('Cancelado'); return; }
      const response = assertion.response as AuthenticatorAssertionResponse;

      const res = await fetch(`${apiUrl}/auth/passkey/stepup/verify`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          challenge: o.challenge,
          credentialId: bufToB64u(assertion.rawId),
          clientDataJSON: bufToB64u(response.clientDataJSON),
          authenticatorData: bufToB64u(response.authenticatorData),
          signature: bufToB64u(response.signature),
          userHandle: response.userHandle ? bufToB64u(response.userHandle) : null,
        }),
      });
      if (res.ok) {
        setStepUp('ok');
        setTotpCode('');
      } else {
        const data = await res.json().catch(() => ({}));
        setTotpError(data.message || 'No se pudo verificar la huella');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error';
      if (!/cancel/i.test(msg)) setTotpError(msg);
    } finally {
      setPkStepupLoading(false);
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
    // El formulario de producto necesita la jerarquía para validar el alta.
    if (activeTab === 'products' || activeTab === 'catalog') fetchCatalog();
  }, [activeTab, stepUp]);

  const fetchCatalog = async () => {
    try {
      const res = await fetch(`${apiUrl}/admin/catalog`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.data)) setCatalog(data.data);
    } catch (err) {
      console.error('Error:', err);
    }
  };

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
        const payload = await res.json().catch(() => ({}));
        alert(payload.error === 'SAFETY_LOCKED'
          ? '🔒 Modo seguro activo: apágalo en Configuración para tocar el 2FA.'
          : 'No se pudo desactivar. Revalida tu código 2FA entrando de nuevo al panel.');
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
      const res = await fetch(`${apiUrl}/admin/products`, { headers: { Authorization: `Bearer ${sessionToken}` } });
      const data = await res.json();
      if (data.data) setProducts(data.data);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const [users, setUsers] = useState<any[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(0);
  const [usersSort, setUsersSort] = useState<'created_at' | 'username' | 'email' | 'role'>('created_at');
  const [usersDir, setUsersDir] = useState<'asc' | 'desc'>('desc');
  const [usersLoading, setUsersLoading] = useState(false);
  const USERS_PAGE_SIZE = 20;

  const fetchUsers = async (page = usersPage, sort = usersSort, dir = usersDir) => {
    setUsersLoading(true);
    try {
      const res = await fetch(
        `${apiUrl}/admin/users?limit=${USERS_PAGE_SIZE}&offset=${page * USERS_PAGE_SIZE}&sort=${sort}&dir=${dir}`,
        {
          headers: { 'Authorization': `Bearer ${sessionToken}` },
          credentials: 'include',
        }
      );
      const data = await res.json();
      if (data.data) {
        setUsers(data.data);
        setUsersTotal(data.pagination?.total ?? data.data.length);
        setUsersPage(page);
      }
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setUsersLoading(false);
    }
  };

  // Clic en una cabecera: misma columna alterna asc/desc, otra columna empieza
  // en asc. Al cambiar el orden se vuelve a la página 0, que si no deja al
  // usuario en una página que ya no existe.
  const sortUsers = (col: typeof usersSort) => {
    if (col === usersSort) {
      const next = usersDir === 'asc' ? 'desc' : 'asc';
      setUsersDir(next);
      fetchUsers(0, col, next);
    } else {
      setUsersSort(col);
      setUsersDir('asc');
      fetchUsers(0, col, 'asc');
    }
  };

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
    if (!productSubId) {
      alert('Elige el subdepartamento del producto (pestaña Catálogo para crear uno).');
      return;
    }
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
          subdepartment_id: productSubId,
          price_cents: Math.round(parseFloat(productPrice) * 100),
          stock_quantity: parseInt(productStock),
          status: productStatus,
        }),
      });
      const data = await res.json();
      if (data.data) {
        setShowProductForm(false);
        resetProductForm();
        fetchProducts();
        fetchStats();
      } else {
        alert('Error: ' + (data.error || 'unknown') + (data.message ? `\n\n${data.message}` : ''));
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
          // Defaults obligatorios: si `description` o `image_url` llegan
          // undefined, D1 hace bind(undefined) y el PUT revienta con 500
          // ("Error updating product" en el panel).
          description: productDesc || editingProduct.description || '',
          image_url: productImages[0] || editingProduct.image_url || (editingProduct.images && editingProduct.images[0]) || '',
          images: productImages.length > 0 ? productImages : editingProduct.images || [editingProduct.image_url],
          // Solo se manda si se eligió: si no, el backend conserva el actual.
          ...(productSubId ? { subdepartment_id: productSubId } : {}),
          price_cents: Math.round(parseFloat(productPrice) * 100),
          stock_quantity: parseInt(productStock),
          status: productStatus,
        }),
      });
      const data = await res.json();
      if (data.data) {
        setEditingProduct(null);
        resetProductForm();
        fetchProducts();
        fetchStats();
      } else {
        alert('Error: ' + (data.error || 'unknown') + (data.message ? `\n\n${data.message}` : ''));
      }
    } catch (err) {
      alert('Error updating product: ' + String(err));
    }
  };

  // Pasar un producto oculto (draft) a la lista de activos sin abrir el formulario.
  const activateProduct = async (p: any) => {
    try {
      const res = await fetch(`${apiUrl}/admin/products/${p.id}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: p.name,
          description: p.description || '',
          image_url: p.image_url || (p.images && p.images[0]) || '',
          images: p.images || [p.image_url],
          price_cents: p.price_cents,
          stock_quantity: p.stock_quantity,
          status: 'active',
        }),
      });
      const data = await res.json();
      if (data.data) { fetchProducts(); fetchStats(); }
      else alert('Error: ' + (data.error || 'unknown'));
    } catch (err) {
      alert('No se pudo activar: ' + String(err));
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
    setProductSubId('');
    setProductStatus('draft');
  };

  const startEditProduct = (product: AdminProduct) => {
    setEditingProduct(product);
    setProductName(product.name);
    setProductDesc(product.description);
    setProductImages(product.images?.length ? product.images : (product.image_url ? [product.image_url] : []));
    setProductPrice((product.price_cents / 100).toFixed(2));
    setProductStock(product.stock_quantity.toString());
    setProductSubId(product.subdepartment_id || '');
    setProductStatus(product.status === 'active' ? 'active' : 'draft');
    setShowProductForm(true);
  };

  const tabs = [
    { id: 'stats', label: 'Dashboard', icon: '📊' },
    { id: 'earnings', label: 'Ganancias', icon: '💰' },
    { id: 'products', label: 'Productos', icon: '📦' },
    { id: 'catalog', label: 'Catálogo', icon: '🗂️' },
    { id: 'borradores', label: 'Borradores', icon: '📝' },
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
  // `settings` guarda EXACTAMENTE lo que devuelve la API (los portes en
  // céntimos). Los dos campos de dinero tienen su propio borrador en euros:
  // antes se pintaba `parseInt(valor)/100` sobre el valor ya editado, así que
  // tras cambiar el envío a 5,50 el campo se recolocaba a 0,05 al tocar
  // cualquier otro campo. El servidor espera euros y multiplica por 100.
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [moneyDraft, setMoneyDraft] = useState({ shipping: '', threshold: '' });
  const [settingsErrors, setSettingsErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const centsToEuros = (cents: string | undefined) => ((parseInt(cents ?? '0', 10) || 0) / 100).toFixed(2);

  const showToast = (kind: 'ok' | 'error', text: string) => {
    setToast({ kind, text });
    // El toast se va solo: un mensaje que no desaparece tapa el formulario.
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 4000);
  };

  useEffect(() => {
    if (activeTab !== 'settings' || !canManageStore || settings) return;
    fetch(`${apiUrl}/admin/settings`, {
      headers: { 'Authorization': `Bearer ${sessionToken}` },
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.data) return;
        setSettings(payload.data);
        setMoneyDraft({
          shipping: centsToEuros(payload.data.shipping_cost),
          threshold: centsToEuros(payload.data.free_shipping_threshold),
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, apiUrl, sessionToken]);

  // Validación en el cliente, con los mismos límites que el servidor
  // (0..1000 € de portes, 0..100 % de IVA). Si el número no es válido se
  // avisa en el campo y no se manda nada: guardar un envío de "-4,90" solo
  // se descubriría en el checkout de un cliente.
  const validateSettings = () => {
    const errs: Record<string, string> = {};
    const num = (v: string) => parseFloat(String(v).replace(',', '.'));
    if (!String(settings?.store_name ?? '').trim()) errs.store_name = 'El nombre no puede estar vacío.';
    if (!Number.isFinite(num(moneyDraft.shipping)) || num(moneyDraft.shipping) < 0) errs.shipping = 'Portes: 0 o más.';
    else if (num(moneyDraft.shipping) > 1000) errs.shipping = 'Portes: máximo 1000 €.';
    if (!Number.isFinite(num(moneyDraft.threshold)) || num(moneyDraft.threshold) < 0) errs.threshold = 'Umbral: 0 o más.';
    else if (num(moneyDraft.threshold) > 100000) errs.threshold = 'Umbral: máximo 100.000 €.';
    const tax = num(String(settings?.tax_rate ?? ''));
    if (!Number.isFinite(tax)) errs.tax_rate = 'IVA: número entre 0 y 100.';
    else if (tax < 0 || tax > 100) errs.tax_rate = 'IVA: entre 0 y 100.';
    setSettingsErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const saveSettings = async () => {
    if (!settings) return;
    if (!validateSettings()) {
      showToast('error', 'Revisa los campos marcados: no se guardó nada.');
      return;
    }
    setSavingSettings(true);
    try {
      const res = await fetch(`${apiUrl}/admin/settings`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        credentials: 'include',
        // El servidor convierte euros -> céntimos, así que aquí van euros.
        body: JSON.stringify({
          store_name: settings.store_name ?? '',
          store_description: settings.store_description ?? '',
          shipping_cost: moneyDraft.shipping.replace(',', '.'),
          free_shipping_threshold: moneyDraft.threshold.replace(',', '.'),
          tax_rate: settings.tax_rate ?? '',
          maintenance_mode: settings.maintenance_mode ?? '0',
          safety_lock: settings.safety_lock ?? '1',
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', payload.message || 'No se pudo guardar (¿permisos?).');
        return;
      }
      // Se relee del servidor: es el único que sabe qué céntimos quedaron, y
      // así el formulario no se queda con el redondeo del navegador.
      const fresh = await fetch(`${apiUrl}/admin/settings`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        credentials: 'include',
      })
        .then((r) => r.json())
        .catch(() => null);
      if (fresh?.data) {
        setSettings(fresh.data);
        setMoneyDraft({
          shipping: centsToEuros(fresh.data.shipping_cost),
          threshold: centsToEuros(fresh.data.free_shipping_threshold),
        });
      }
      showToast('ok', 'Configuración guardada. Los portes aplican al instante.');
    } catch {
      showToast('error', 'Error de conexión.');
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
              <button className="btn btn-primary btn-glow" onClick={handleStepUp} disabled={totpLoading} data-testid="admin-stepup-submit">
                {totpLoading ? 'Verificando...' : 'Verificar y entrar'}
              </button>
              <button className="btn btn-secondary" onClick={onBack}>Cancelar</button>
            </div>

            {/* Alternativa con la huella: mismo candado, otro factor. Solo
                aparece si este dispositivo/navegador puede usar passkeys. */}
            {pkStepupSupported && (
              <>
                <div className="auth-divider"><span>o con tu huella</span></div>
                <button
                  className="btn btn-passkey"
                  style={{ width: '100%' }}
                  disabled={pkStepupLoading || totpLoading}
                  onClick={handlePasskeyStepUp}
                  data-testid="admin-stepup-passkey"
                >
                  {pkStepupLoading ? '⏳ Esperando tu huella…' : '👆 Entrar al panel con la huella'}
                </button>
                <small style={{ display: 'block', textAlign: 'center', color: 'var(--text-secondary)', marginTop: '6px' }}>
                  FaceID, huella o PIN. Concede el mismo acceso que el código, 1 hora.
                </small>
              </>
            )}
            {pkStepupSupported === false && (
              <small style={{ display: 'block', textAlign: 'center', color: 'var(--text-secondary)', marginTop: '0.75rem' }}>
                ¿Prefieres la huella? Añádela en tu cuenta → Seguridad → Añadir passkey.
              </small>
            )}
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
          <img className="admin-sidebar-logo" src="/rayo-128.png" alt="" width={34} height={44} />
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
          <button
            className="admin-sidebar-item"
            onClick={handleLockPanel}
            disabled={lockingPanel}
            data-testid="lock-panel"
            title="Cerrar el panel y volver a pedir el código 2FA al entrar"
          >
            <span className="admin-sidebar-icon">🔒</span>
            <span className="admin-sidebar-label">{lockingPanel ? 'Bloqueando...' : 'Bloquear panel'}</span>
          </button>
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
            {/* Cada recuadro lleva a su zona. Usuarios solo es clicable si el
                rol puede verlo: la pestaña Usuarios está oculta para
                stock_manager y el servidor devuelve 403 en /admin/users. */}
            <button
              className="stat-card stat-card-link"
              onClick={() => setActiveTab('products')}
              aria-label="Ir a Productos"
            >
              <div className="stat-value">{stats.products}</div>
              <div className="stat-label">Productos →</div>
            </button>
            <button
              className="stat-card stat-card-link"
              onClick={() => setActiveTab('orders')}
              aria-label="Ir a Órdenes"
            >
              <div className="stat-value">{stats.orders}</div>
              <div className="stat-label">Órdenes →</div>
            </button>
            {canManageStore ? (
              <button
                className="stat-card stat-card-link"
                onClick={() => setActiveTab('users')}
                aria-label="Ir a Usuarios"
              >
                <div className="stat-value">{stats.users}</div>
                <div className="stat-label">Usuarios →</div>
              </button>
            ) : (
              <div className="stat-card">
                <div className="stat-value">{stats.users}</div>
                <div className="stat-label">Usuarios</div>
              </div>
            )}
            <button
              className="stat-card stat-card-link"
              onClick={() => setActiveTab('earnings')}
              aria-label="Ver el resumen completo de ganancias"
            >
              <div className="stat-value">{(stats.revenue / 100).toFixed(2)}€</div>
              <div className="stat-label">Ingresos · ver resumen →</div>
            </button>
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
                  <label>Departamento / Subdepartamento:</label>
                  {catalog.length === 0 ? (
                    <p className="admin-hint">
                      No hay subdepartamentos. Créalos en la pestaña <strong>Catálogo</strong> 🗂️ antes de añadir productos.
                    </p>
                  ) : (
                    <select
                      value={productSubId}
                      onChange={(e) => setProductSubId(e.target.value)}
                      aria-label="Subdepartamento del producto"
                    >
                      <option value="">Elige subdepartamento…</option>
                      {catalog.map((d) => (
                        <optgroup key={d.id} label={d.name}>
                          {d.subdepartments.length === 0 && <option disabled value={`${d.id}__empty`}>{'(sin subdepartamentos)'}</option>}
                          {d.subdepartments.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  )}
                </div>
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
                <div className="form-group">
                  <label>Visibilidad:</label>
                  <select value={productStatus} onChange={(e) => setProductStatus(e.target.value as 'draft' | 'active')} aria-label="Visibilidad del producto">
                    <option value="draft">🚫 Oculto (borrador) — no sale en la web</option>
                    <option value="active">✅ Activo — visible en la web</option>
                  </select>
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
                  <th>Ubicación</th>
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
                    <td>
                      <span className="admin-hint">
                        {p.department_name
                          ? `${p.department_name} › ${p.subdepartment_name ?? '—'}`
                          : (p.subdepartment_name || '—')}
                      </span>
                    </td>
                    <td>{(p.price_cents / 100).toFixed(2)}€</td>
                    <td>{p.stock_quantity}</td>
                    <td>{p.status === 'active' ? '✅ Activo' : (p.status === 'draft' ? '🚫 Oculto (borrador)' : `— ${p.status}`)}</td>
                    <td>
                      {p.status !== 'active' && (
                        <button className="btn btn-sm btn-primary" onClick={() => activateProduct(p)}>👁️ Activar</button>
                      )}
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

        {/* CATALOG TAB — departamentos y subdepartamentos (tarea #25) */}
        {activeTab === 'catalog' && (
          <CatalogManager
            apiUrl={apiUrl}
            sessionToken={sessionToken}
            onCatalogChange={(next) => setCatalog(next)}
          />
        )}

        {/* USERS TAB */}
        {activeTab === 'earnings' && (
          <EarningsPanel apiUrl={apiUrl} sessionToken={sessionToken} />
        )}

        {activeTab === 'borradores' && (
          <BorradoresPanel apiUrl={apiUrl} sessionToken={sessionToken} />
        )}
        {activeTab === 'users' && (
          <div className="admin-users">
            <h2>Gestión de Usuarios</h2>
            <div className="table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>
                    <button type="button" className="th-sort" onClick={() => sortUsers('username')} aria-label="Ordenar por usuario">
                      Usuario{usersSort === 'username' ? (usersDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="th-sort" onClick={() => sortUsers('email')} aria-label="Ordenar por email">
                      Email{usersSort === 'email' ? (usersDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="th-sort" onClick={() => sortUsers('role')} aria-label="Ordenar por rol">
                      Rol{usersSort === 'role' ? (usersDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {usersLoading && users.length === 0
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={`sk-${i}`} className="skeleton-row">
                        <td><span className="skeleton-bar" style={{ width: '70%' }} /></td>
                        <td><span className="skeleton-bar" style={{ width: '85%' }} /></td>
                        <td><span className="skeleton-bar" style={{ width: '50%' }} /></td>
                        <td><span className="skeleton-bar" style={{ width: '60%' }} /></td>
                      </tr>
                    ))
                  : users.map(u => (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>{u.email}</td>
                    <td>
                      <select
                        value={u.role_id}
                        aria-label={`Rol de ${u.username}`}
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
            {usersTotal > USERS_PAGE_SIZE && (
              <div className="table-pagination">
                <button
                  className="btn btn-secondary"
                  onClick={() => fetchUsers(usersPage - 1)}
                  disabled={usersPage === 0 || usersLoading}
                >
                  ← Anterior
                </button>
                <span className="table-pagination-info">
                  Página {usersPage + 1} de {Math.max(1, Math.ceil(usersTotal / USERS_PAGE_SIZE))} · {usersTotal} usuarios
                </span>
                <button
                  className="btn btn-secondary"
                  onClick={() => fetchUsers(usersPage + 1)}
                  disabled={(usersPage + 1) * USERS_PAGE_SIZE >= usersTotal || usersLoading}
                >
                  Siguiente →
                </button>
              </div>
            )}
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
                  <div className="table-pagination">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => fetchOrders(ordersPage - 1)}
                      disabled={ordersPage === 0}
                    >
                      ← Anterior
                    </button>
                    <span className="table-pagination-info">
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
                  <input
                    id="set-name"
                    type="text"
                    value={settings.store_name ?? ''}
                    onChange={(e) => setSettings({ ...settings, store_name: e.target.value })}
                    maxLength={60}
                    aria-invalid={!!settingsErrors.store_name}
                    aria-describedby={settingsErrors.store_name ? 'set-name-err' : undefined}
                  />
                  {settingsErrors.store_name && <span className="field-error" id="set-name-err">{settingsErrors.store_name}</span>}
                </div>
                <div className="form-group">
                  <label htmlFor="set-desc">Descripción:</label>
                  <input id="set-desc" type="text" value={settings.store_description ?? ''} onChange={(e) => setSettings({ ...settings, store_description: e.target.value })} maxLength={200} />
                </div>
                <div className="form-row-2col">
                  <div className="form-group">
                    <label htmlFor="set-ship">Envío (€):</label>
                    <input
                      id="set-ship"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={moneyDraft.shipping}
                      onChange={(e) => setMoneyDraft((d) => ({ ...d, shipping: e.target.value }))}
                      aria-invalid={!!settingsErrors.shipping}
                      aria-describedby={settingsErrors.shipping ? 'set-ship-err' : undefined}
                    />
                    {settingsErrors.shipping && <span className="field-error" id="set-ship-err">{settingsErrors.shipping}</span>}
                  </div>
                  <div className="form-group">
                    <label htmlFor="set-threshold">Gratis desde (€):</label>
                    <input
                      id="set-threshold"
                      type="number"
                      inputMode="decimal"
                      step="1"
                      min="0"
                      value={moneyDraft.threshold}
                      onChange={(e) => setMoneyDraft((d) => ({ ...d, threshold: e.target.value }))}
                      aria-invalid={!!settingsErrors.threshold}
                      aria-describedby={settingsErrors.threshold ? 'set-threshold-err' : undefined}
                    />
                    {settingsErrors.threshold && <span className="field-error" id="set-threshold-err">{settingsErrors.threshold}</span>}
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="set-tax">IVA (%):</label>
                  <input
                    id="set-tax"
                    type="number"
                    inputMode="decimal"
                    step="1"
                    min="0"
                    max="100"
                    value={settings.tax_rate ?? ''}
                    onChange={(e) => setSettings({ ...settings, tax_rate: e.target.value })}
                    aria-invalid={!!settingsErrors.tax_rate}
                    aria-describedby={settingsErrors.tax_rate ? 'set-tax-err' : undefined}
                  />
                  {settingsErrors.tax_rate && <span className="field-error" id="set-tax-err">{settingsErrors.tax_rate}</span>}
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
                <div className="form-group remember-me">
                  <label className="checkbox-label" htmlFor="set-safe" style={{ minHeight: '44px' }}>
                    <input
                      id="set-safe"
                      type="checkbox"
                      checked={(settings.safety_lock ?? '1') === '1'}
                      onChange={(e) => setSettings({ ...settings, safety_lock: e.target.checked ? '1' : '0' })}
                    />
                    <span>🔒 Modo seguro (bloquea regenerar/desactivar 2FA y borrar productos)</span>
                  </label>
                </div>
                <div className="form-actions">
                  <button className="btn btn-primary" onClick={saveSettings} disabled={savingSettings}>
                    {savingSettings ? 'Guardando…' : '💾 Guardar configuración'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        </div>
      </div>

      {/* Aviso de resultado de acciones del panel. role=status para que un
          lector de pantalla lo anuncie sin robar el foco. */}
      {toast && (
        <div className={`admin-toast admin-toast-${toast.kind}`} role="status" aria-live="polite">
          <span aria-hidden="true">{toast.kind === 'ok' ? '✅' : '⚠️'}</span>
          <span>{toast.text}</span>
          <button type="button" className="admin-toast-close" onClick={() => setToast(null)} aria-label="Cerrar aviso">×</button>
        </div>
      )}
    </div>
  );
}
