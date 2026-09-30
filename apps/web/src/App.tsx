import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import type { Product } from './types';
import { useAuth } from './hooks/useAuth';
import { useCart } from './hooks/useCart';
import { useWishlist } from './hooks/useWishlist';
import { useProducts } from './hooks/useProducts';
import { useCurrency } from './hooks/useCurrency';
import { useApiUrl } from './hooks/useApiUrl';
import { getAuthHeaders, loadStoreSettings } from './lib/api';
import { Header } from './components/Header';
import { CookieBanner } from './components/CookieBanner';
import { Footer } from './components/Footer';
import { HomePage } from './pages/HomePage';

// Code-splitting (tarea #14/#29): la home no carga el panel de admin ni los
// modales de cuenta y checkout. Antes todoopaedia viajaba en el bundle inicial,
// que es lo que Lighthouse marcaba como "JS sin usar" (25 KiB) y que paga
// cualquier visitante con su red móvil, no solo quien usa esas pantallas.
// `Header`, `Footer` y el carrito sí van en el bundle inicial: son el primer
// painted y separarlos solo añadiría un salto de contenido.
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const ProductPage = lazy(() => import('./pages/ProductPage').then((m) => ({ default: m.ProductPage })));
const CatalogPage = lazy(() => import('./pages/CatalogPage').then((m) => ({ default: m.CatalogPage })));
const WishlistPage = lazy(() => import('./pages/WishlistPage').then((m) => ({ default: m.WishlistPage })));
const LegalPage = lazy(() => import('./pages/LegalPage').then((m) => ({ default: m.LegalPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));
const CartSidebar = lazy(() => import('./components/CartSidebar').then((m) => ({ default: m.CartSidebar })));
const LoginForm = lazy(() => import('./components/LoginForm').then((m) => ({ default: m.LoginForm })));
const OtpForm = lazy(() => import('./components/OtpForm').then((m) => ({ default: m.OtpForm })));
const PasswordResetForm = lazy(() => import('./components/PasswordResetForm').then((m) => ({ default: m.PasswordResetForm })));
const CheckoutForm = lazy(() => import('./components/CheckoutForm').then((m) => ({ default: m.CheckoutForm })));
const UserPanel = lazy(() => import('./components/UserPanel').then((m) => ({ default: m.UserPanel })));

function LazyFallback() {
  return <div className="loading"><div className="spinner"></div></div>;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function App() {
  const apiUrl = useApiUrl();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, session, loginMode, actionError, actionLoading, setUser, setSession, setLoginMode, setActionError, setActionLoading, handleLogin, handleLogout, saveShipping, saveProfile, persistSession, pendingOtpEmail, otpLoading, otpResending, otpError, setPendingOtpEmail, setOtpError, handleVerifyOtp, handleResendOtp, decodeTokenRole, hasAdminAccess, lastAccount, rememberLastAccount } = useAuth();
  const { products, status, searchTerm, filteredProducts, paginatedProducts, currentPage, totalPages, setProducts, handleSearch, goToPage } = useProducts();
  // Carrito y favoritos ligados a la cuenta ('guest' sin sesión)
  const accountKey = user?.id ?? 'guest';
  const { cart, addedToCartId, cartTotal, cartCount, removedNotice, clearRemovedNotice, handleAddToCart, handleRemoveFromCart, setCart } = useCart(products, accountKey);
  const { wishlist, toggleWishlist, isWished } = useWishlist(accountKey);
  const { currency, setCurrency } = useCurrency();

  const [showCart, setShowCart] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [loginNotice, setLoginNotice] = useState('');
  const [showCheckout, setShowCheckout] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);
  const [cartNotice, setCartNotice] = useState('');
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const placingRef = useRef(false);

  // Ajustes públicos (portes + mantenimiento). Sin esto rigen los valores por defecto.
  useEffect(() => {
    loadStoreSettings(apiUrl).then((s) => {
      setMaintenanceMode(s.maintenance_mode);
      // Re-render para aplicar portes frescos en los cálculos mostrados
      setProducts((prev) => [...prev]);
    }).catch(() => {});
  }, [apiUrl]);
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [pendingGoogle2FA, setPendingGoogle2FA] = useState<string | null>(null);
  const [google2faLoading, setGoogle2faLoading] = useState(false);
  const [google2faError, setGoogle2faError] = useState('');

  // Cerrar modal de login automáticamente cuando el usuario inicia sesión
  useEffect(() => {
    if (user && showLogin) {
      setShowLogin(false);
      setPendingOtpEmail(null);
      setOtpError('');
      setPendingGoogle2FA(null);
      setGoogle2faError('');
      setLoginNotice('');
    }
  }, [user, showLogin]);

  const handleGoogle2FA = useCallback(async (code: string) => {
    if (!pendingGoogle2FA) return;
    setGoogle2faLoading(true);
    setGoogle2faError('');
    try {
      const response = await fetch(`${apiUrl}/auth/google-2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingGoogle2FA, code }),
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error === 'GOOGLE_2FA_EXPIRED'
          ? 'La sesión de Google caducó. Inicia con Google de nuevo.'
          : payload.message || 'Error al verificar');
      }
      const { user: userData, session: sessionData } = payload.data;
      setUser(userData);
      setSession(sessionData);
      persistSession(sessionData.token, sessionData.expires_at, true);
      setPendingGoogle2FA(null);
    } catch (err) {
      setGoogle2faError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setGoogle2faLoading(false);
    }
  }, [apiUrl, pendingGoogle2FA, persistSession, setSession, setUser]);

  const closeMenu = () => setShowMenu(false);

  const scrollToId = (id: string) => {
    const go = () => {
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    };
    if (location.pathname !== '/') {
      navigate('/');
      setTimeout(go, 150);
    } else {
      go();
    }
  };

  const handleNavClick = (section: string) => {
    if (section === 'products') {
      scrollToId('products');
    } else if (section === 'about') {
      scrollToId('about');
    } else if (section === 'contact') {
      document.querySelector('.footer')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleSearchNav = useCallback((term: string) => {
    if (location.pathname !== '/') {
      navigate('/');
    }
    handleSearch(term);
  }, [handleSearch, location.pathname, navigate]);

  // Carrito exige login: sin sesión se abre el login y no se pierde nada
  // (el carrito ya persiste en localStorage entre recargas)
  const handleAddToCartGated = useCallback((productId: string, qty: number = 1) => {
    if (maintenanceMode) {
      alert('Tienda en mantenimiento. Volvemos enseguida.');
      return;
    }
    if (!user) {
      setLoginNotice('Inicia sesión para agregar productos a tu carrito. Tu carrito se guarda automáticamente.');
      setShowLogin(true);
      return;
    }
    handleAddToCart(productId, qty);
  }, [user, handleAddToCart, maintenanceMode]);

  const handleCheckout = async () => {
    if (maintenanceMode) {
      setCartNotice('Tienda en mantenimiento. Volvemos enseguida.');
      return;
    }
    if (!user) {
      setShowCart(false);
      setLoginNotice('Inicia sesión para continuar con tu compra. Tu carrito seguirá aquí.');
      setShowLogin(true);
      return;
    }
    // Revalidar precio/stock contra el servidor antes de pagar
    try {
      const res = await fetch(`${apiUrl}/catalog/products`);
      if (res.ok) {
        const payload = await res.json();
        const fresh: Product[] = payload.data || [];
        const changes: string[] = [];
        for (const item of cart) {
          const f = fresh.find(p => p.id === item.id);
          const local = products.find(p => p.id === item.id);
          if (!f) {
            changes.push('un producto ya no está disponible');
          } else {
            if (local && f.price_cents !== local.price_cents) changes.push(`nuevo precio en "${f.name}"`);
            if (f.stock_quantity < item.quantity) changes.push(`stock insuficiente en "${f.name}" (quedan ${f.stock_quantity})`);
          }
        }
        if (changes.length > 0) {
          setProducts(fresh);
          alert('El catálogo cambió antes de pagar:\n- ' + [...new Set(changes)].join('\n- '));
          return;
        }
        setProducts(fresh);
      }
    } catch {
      // Sin red no se puede garantizar precio/stock: bloquear, no abrir el checkout
      setCartNotice('Sin conexión: no se pudo verificar precio y stock. Reintenta con red.');
      return;
    }
    setShowCart(false);
    setLastOrderId(null);
    setCartNotice('');
    setShowCheckout(true);
  };

  // Scroll-lock: con cualquier modal/sidebar abierto el fondo no hace scroll (iOS)
  const anyOverlayOpen = showLogin || showCheckout || showCart || showUserPanel || showMenu;
  useEffect(() => {
    if (!anyOverlayOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [anyOverlayOpen]);

  // Cerrar modales con tecla Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowLogin(false);
      setShowCheckout(false);
      setShowCart(false);
      setShowMenu(false);
      setShowUserPanel(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Handle Google Auth redirect con código de un solo uso
  // (el servidor redirige con ?login=success&provider=google&code=...;
  // el front lo canjea por POST /auth/google/exchange y limpia la URL.
  // Se mantiene compatibilidad con ?token=... para despliegues antiguos.)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loginResult = params.get('login');
    const provider = params.get('provider');

    if (loginResult === 'error' && provider === 'google') {
      const reason = params.get('reason');
      setActionError(reason === 'invalid_state'
        ? 'Google rechazó el inicio de sesión (sesión caducada). Inténtalo de nuevo.'
        : 'Error al iniciar sesión con Google. Inténtalo de nuevo.');
      setShowLogin(true);
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    // Google con 2FA: OAuth OK pero falta el código (ventana 10 min)
    if (loginResult === '2fa-required' && provider === 'google') {
      const emailParam = params.get('email') || '';
      setPendingGoogle2FA(emailParam);
      setGoogle2faError('');
      setShowLogin(true);
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    const token = params.get('token');
    const code = params.get('code');

    if (loginResult === 'success' && provider === 'google' && code) {
      // Se canjea PRIMERO y la URL se limpia solo en éxito: si la red móvil
      // falla, el code (un solo uso) sigue en la URL y recargar reintenta.
      setActionLoading(true);
      fetch(`${apiUrl}/auth/google/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
        signal: AbortSignal.timeout(15000),
      })
        .then(r => r.json().then(payload => ({ ok: r.ok, payload })))
        .then(({ ok, payload }) => {
          setActionLoading(false);
          const sessionToken = payload?.data?.session?.token;
          if (!ok || !sessionToken) {
            setActionError('Sesión de Google caducada. Recarga e inténtalo de nuevo.');
            setShowLogin(true);
            return;
          }
          window.history.replaceState({}, document.title, window.location.pathname);
          const expiresAt = String(payload.data.session.expires_at
            ?? (Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60));
          persistSession(sessionToken, expiresAt, true);
          setSession({ id: sessionToken, token: sessionToken, expires_at: expiresAt });
          if (payload.data.user) {
            setUser(payload.data.user);
            rememberLastAccount(payload.data.user.email, payload.data.user.display_name || payload.data.user.username);
          }
          else {
            fetch(`${apiUrl}/auth/me`, {
              headers: { 'Authorization': `Bearer ${sessionToken}` },
              credentials: 'include',
            })
              .then(r => r.json())
              .then(me => { if (me.data) setUser(me.data); })
              .catch(() => {});
          }
        })
        .catch(() => {
          setActionLoading(false);
          setActionError('Sin conexión al completar Google. Recarga para reintentar.');
          setShowLogin(true);
        });
      return;
    }

    if (loginResult === 'success' && provider === 'google' && token) {
      persistSession(token, String(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60), true);
      setSession({ id: token, token, expires_at: String(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60) });
      fetch(`${apiUrl}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include',
      })
        .then(r => r.json())
        .then(payload => {
          if (payload.data) {
            setUser(payload.data);
          }
        })
        .catch(() => {});

      // Clean URL (quita el token del historial visible)
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [apiUrl]);

  // Vista admin completamente separada - oculta toda la tienda
  if (showAdminPanel && user && hasAdminAccess(decodeTokenRole(session?.token || ''))) {
    return (
      <Suspense fallback={<div className="layout-main"><LazyFallback /></div>}>
        <AdminPage
          user={user}
          sessionToken={session?.token || ''}
          apiUrl={apiUrl}
          onBack={() => setShowAdminPanel(false)}
        />
      </Suspense>
    );
  }

  return (
    <div className="layout">
      <ScrollToTop />
      {maintenanceMode && (
        <p role="status" style={{ background: 'var(--warning)', color: '#1a1a00', textAlign: 'center', padding: '0.5rem 1rem', margin: 0, fontWeight: 600 }}>
          🔧 Tienda en mantenimiento: puedes mirar, pero no comprar. Volvemos enseguida.
        </p>
      )}
      <Header
        user={user}
        cartCount={cartCount}
        searchTerm={searchTerm}
        suggestions={products}
        currency={currency}
        onSelectProduct={(p) => { if (p.slug) navigate(`/producto/${p.slug}`); }}
        onSearch={handleSearchNav}
        onCartClick={() => setShowCart(!showCart)}
        onMenuClick={() => setShowMenu(!showMenu)}
        onLoginClick={() => setShowLogin(true)}
        onUserPanelClick={() => setShowUserPanel(true)}
        onAdminClick={() => setShowAdminPanel(true)}
        isAdmin={hasAdminAccess(decodeTokenRole(session?.token || ''))}
        showMenu={showMenu}
        onCloseMenu={closeMenu}
        onNavClick={handleNavClick}
        onCategorySelect={(slug) => { closeMenu(); navigate(`/categoria/${slug}`); }}
        onLogoClick={() => navigate('/')}
        onWishlistClick={() => navigate('/favoritos')}
        wishlistCount={wishlist.length}
      />

      {/* Admin Page - página separada para admin+ */}
      {showAdminPanel && user && hasAdminAccess(decodeTokenRole(session?.token || '')) && (
        <Suspense fallback={<LazyFallback />}>
          <AdminPage
            user={user}
            sessionToken={session?.token || ''}
            apiUrl={apiUrl}
            onBack={() => setShowAdminPanel(false)}
          />
        </Suspense>
      )}

      <Suspense fallback={<LazyFallback />}>
      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              products={products}
              status={status}
              searchTerm={searchTerm}
              filteredProducts={filteredProducts}
              paginatedProducts={paginatedProducts}
              currentPage={currentPage}
              totalPages={totalPages}
              goToPage={goToPage}
              addedToCartId={addedToCartId}
              onAddToCart={handleAddToCartGated}
              currency={currency}
              setCurrency={setCurrency}
              onShopNow={() => scrollToId('products')}
              wishlist={wishlist}
              onToggleWishlist={toggleWishlist}
              isWished={isWished}
            />
          }
        />
        <Route
          path="/favoritos"
          element={
            <WishlistPage
              products={products}
              status={status}
              wishlist={wishlist}
              onToggleWishlist={toggleWishlist}
              addedToCartId={addedToCartId}
              onAddToCart={handleAddToCartGated}
              currency={currency}
            />
          }
        />
        <Route path="/privacidad" element={<LegalPage slug="privacidad" />} />
        <Route path="/terminos" element={<LegalPage slug="terminos" />} />
        <Route path="/envios" element={<LegalPage slug="envios" />} />
        <Route path="/contacto" element={<LegalPage slug="contacto" />} />
        <Route path="/faq" element={<LegalPage slug="faq" />} />
        <Route
          path="/producto/:slug"
          element={
            <ProductPage
              addedToCartId={addedToCartId}
              onAddToCart={handleAddToCartGated}
              currency={currency}
              wishedIds={wishlist}
              onToggleWishlist={toggleWishlist}
            />
          }
        />
        <Route
          path="/categoria/:slug"
          element={
            <CatalogPage
              kind="categoria"
              addedToCartId={addedToCartId}
              onAddToCart={handleAddToCartGated}
              currency={currency}
              wishlist={wishlist}
              onToggleWishlist={toggleWishlist}
            />
          }
        />
        <Route
          path="/departamento/:slug"
          element={
            <CatalogPage
              kind="departamento"
              addedToCartId={addedToCartId}
              onAddToCart={handleAddToCartGated}
              currency={currency}
              wishlist={wishlist}
              onToggleWishlist={toggleWishlist}
            />
          }
        />
        <Route
          path="/subdepartamento/:slug"
          element={
            <CatalogPage
              kind="subdepartamento"
              addedToCartId={addedToCartId}
              onAddToCart={handleAddToCartGated}
              currency={currency}
              wishlist={wishlist}
              onToggleWishlist={toggleWishlist}
            />
          }
        />
        {/* Antes redirigía a la home en silencio: una URL mala o un producto
            borrado landingaban sin explicación. Ahora hay un 404 con salida
            (buscar, tienda, contacto) y marcado como noindex. */}
        <Route path="*" element={<NotFoundPage onSearch={handleSearchNav} />} />
      </Routes>
      </Suspense>

      {/* Modales y panel lateral: sus formularios van en chunks aparte, así que
          necesitan su propio límite. Con `fallback={null}` se ve el fondo del
          modal y el contenido aparece al llegar el chunk, en vez de un spinner
          dentro de un diálogo a medio pintar. */}
      <Suspense fallback={null}>
      {showCart && (
        <CartSidebar
          cart={cart}
          products={products}
          cartTotal={cartTotal}
          onClose={() => { setShowCart(false); clearRemovedNotice(); }}
          onRemove={handleRemoveFromCart}
          onCheckout={handleCheckout}
          currency={currency}
          notice={cartNotice || (removedNotice > 0 ? `${removedNotice} ${removedNotice === 1 ? 'producto ya no está disponible y se quitó' : 'productos ya no están disponibles y se quitaron'} del carrito.` : null)}
        />
      )}

      {showLogin && (
        <div className="modal-overlay anim-modal-overlay" onClick={() => setShowLogin(false)}>
          <div className="modal anim-modal-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Acceso a cuenta">
            <div className="modal-header">
              <h2 className="character-bounce-in">{showPasswordReset ? 'Recuperar contraseña' : pendingGoogle2FA ? 'Verificación en dos pasos' : pendingOtpEmail ? 'Verifica tu correo' : loginMode === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'}</h2>
              <button className="close-btn" onClick={() => { setShowLogin(false); setActionError(''); setPendingOtpEmail(null); setShowPasswordReset(false); setLoginNotice(''); }} aria-label="Cerrar diálogo">✕</button>
            </div>
            {actionError && !pendingOtpEmail && !showPasswordReset && <p className="error character-shake" style={{ padding: '0 1.5rem', marginBottom: 0 }}>{actionError}</p>}
            {loginNotice && !pendingOtpEmail && !showPasswordReset && !pendingGoogle2FA && (
              <p className="login-notice" role="status">{loginNotice}</p>
            )}
            {showPasswordReset ? (
              <PasswordResetForm
                apiUrl={apiUrl}
                onDone={() => { setShowPasswordReset(false); setLoginMode('login'); }}
                onBack={() => setShowPasswordReset(false)}
              />
            ) : pendingGoogle2FA ? (
              <OtpForm
                email={pendingGoogle2FA}
                onVerify={handleGoogle2FA}
                onBack={() => { setPendingGoogle2FA(null); setGoogle2faError(''); }}
                loading={google2faLoading}
                error={google2faError}
                subtitle={<>Tu cuenta Google tiene 2FA activado. Introduce el código de tu app para <strong>{pendingGoogle2FA}</strong> (10 min).</>}
              />
            ) : pendingOtpEmail ? (
              <OtpForm
                email={pendingOtpEmail}
                onVerify={handleVerifyOtp}
                onResend={handleResendOtp}
                onBack={() => { setPendingOtpEmail(null); setOtpError(''); }}
                loading={otpLoading}
                resending={otpResending}
                error={otpError}
              />
            ) : (
            <LoginForm
              onSubmit={handleLogin}
              onCancel={() => { setShowLogin(false); setActionError(''); }}
              mode={loginMode}
              onToggleMode={() => { setLoginMode(prev => prev === 'login' ? 'register' : 'login'); setActionError(''); }}
              loading={actionLoading}
              apiUrl={apiUrl}
              onForgotPassword={() => setShowPasswordReset(true)}
              lastAccount={lastAccount}
            />
            )}
          </div>
        </div>
      )}

      {showUserPanel && user && (
        <UserPanel
          user={user}
          apiUrl={apiUrl}
          sessionToken={session?.token || ''}
          onClose={() => setShowUserPanel(false)}
          onLogout={handleLogout}
          onSaveShipping={saveShipping}
          onSaveProfile={saveProfile}
        />
      )}

      {showCheckout && (
        <div className="modal-overlay" onClick={() => setShowCheckout(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Finalizar compra">
            <div className="modal-header">
              <h2>Finalizar Compra</h2>
              <button className="close-btn" onClick={() => setShowCheckout(false)} aria-label="Cerrar diálogo">✕</button>
            </div>
            {lastOrderId ? (
              <div style={{ padding: '1.5rem', textAlign: 'center' }}>
                <p style={{ fontSize: '2.5rem' }}>🎉</p>
                <h3>¡Gracias por tu compra!</h3>
                <p>Tu pedido <strong>{lastOrderId.slice(0, 8)}</strong> está en preparación.</p>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Te avisaremos por email de cada cambio de estado.</p>
                <button className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} onClick={() => { setLastOrderId(null); setShowCheckout(false); }}>
                  Seguir comprando
                </button>
              </div>
            ) : (
            <CheckoutForm
              total={cartTotal}
              itemCount={cartCount}
              loading={actionLoading}
              currency={currency}
              defaultName={user?.shipping?.full_name || ''}
              defaultEmail={user?.email || ''}
              defaultPhone={user?.shipping?.phone || ''}
              defaultAddress={user?.shipping?.address || ''}
              defaultCity={user?.shipping?.city || ''}
              defaultPostalCode={user?.shipping?.postal_code || ''}
              onSubmit={async (shippingInfo) => {
                // Guard anti-doble-tap: en 4G lento el segundo tap llegaría
                // antes de pintar el spinner y duplicaría el pedido.
                if (placingRef.current) return;
                placingRef.current = true;
                setActionLoading(true);
                try {
                  const response = await fetch(`${apiUrl}/orders`, {
                    method: 'POST',
                    headers: {
                      ...getAuthHeaders(session),
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      items: cart.map(item => {
                        const product = products.find(p => p.id === item.id);
                        if (!product) return null;
                        return { product_id: item.id, quantity: item.quantity, price_cents: product.price_cents };
                      }).filter(Boolean),
                      ...shippingInfo,
                    }),
                    credentials: 'include',
                  });

                  const payload = await response.json();
                  if (!response.ok) {
                    const errorMsg = payload.error === 'PRODUCT_NOT_FOUND'
                      ? 'Producto no encontrado'
                      : payload.error === 'INSUFFICIENT_STOCK'
                        ? 'Stock insuficiente'
                        : payload.error === 'INVALID_INPUT'
                          ? 'Datos inválidos'
                          : 'Error al procesar la orden';
                    throw new Error(errorMsg);
                  }

                  setProducts(prev => prev.map(p => {
                    const item = cart.find(ci => ci.id === p.id);
                    if (item) {
                      return { ...p, stock_quantity: Math.max(0, p.stock_quantity - item.quantity) };
                    }
                    return p;
                  }));

                  setCart([]);
                  setLastOrderId(payload.data.id);
                } catch (err) {
                  alert(err instanceof Error ? err.message : 'Error al procesar la compra');
                } finally {
                  placingRef.current = false;
                  setActionLoading(false);
                }
              }}
              onCancel={() => setShowCheckout(false)}
            />
            )}
          </div>
        </div>
      )}
      </Suspense>

      <Footer />
      <CookieBanner />
    </div>
  );
}
