import { useState, useCallback, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useCart } from './hooks/useCart';
import { useWishlist } from './hooks/useWishlist';
import { useProducts } from './hooks/useProducts';
import { useCurrency } from './hooks/useCurrency';
import { useApiUrl } from './hooks/useApiUrl';
import { getAuthHeaders } from './lib/api';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { LoginForm } from './components/LoginForm';
import { OtpForm } from './components/OtpForm';
import { PasswordResetForm } from './components/PasswordResetForm';
import { CheckoutForm } from './components/CheckoutForm';
import { UserPanel } from './components/UserPanel';
import { CartSidebar } from './components/CartSidebar';
import { AdminPage } from './pages/AdminPage';
import { HomePage } from './pages/HomePage';
import { WishlistPage } from './pages/WishlistPage';
import { ProductPage } from './pages/ProductPage';
import { CatalogPage } from './pages/CatalogPage';

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
  const { user, session, loginMode, actionError, actionLoading, setUser, setSession, setLoginMode, setActionError, setActionLoading, handleLogin, handleLogout, saveShipping, persistSession, pendingOtpEmail, otpLoading, otpResending, otpError, setPendingOtpEmail, setOtpError, handleVerifyOtp, handleResendOtp, decodeTokenRole, hasAdminAccess } = useAuth();
  const { products, status, searchTerm, filteredProducts, paginatedProducts, currentPage, totalPages, setProducts, handleSearch, goToPage } = useProducts();
  const { cart, addedToCartId, cartTotal, cartCount, removedNotice, clearRemovedNotice, handleAddToCart, handleRemoveFromCart, setCart } = useCart(products);
  const { wishlist, toggleWishlist, isWished } = useWishlist();
  const { currency, setCurrency } = useCurrency();

  const [showCart, setShowCart] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
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
    if (!user) {
      setShowLogin(true);
      return;
    }
    handleAddToCart(productId, qty);
  }, [user, handleAddToCart]);

  const handleCheckout = () => {
    if (!user) {
      setShowCart(false);
      setShowLogin(true);
      return;
    }
    setShowCart(false);
    setShowCheckout(true);
  };

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

  // Handle Google Auth redirect with token handoff
  // (el servidor redirige con ?login=success&provider=google&token=... porque
  // la cookie HttpOnly no es legible cross-subdominio; se limpia la URL enseguida)
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
      <AdminPage
        user={user}
        sessionToken={session?.token || ''}
        apiUrl={apiUrl}
        onBack={() => setShowAdminPanel(false)}
      />
    );
  }

  return (
    <div className="layout">
      <ScrollToTop />
      <Header
        user={user}
        cartCount={cartCount}
        searchTerm={searchTerm}
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
        <AdminPage
          user={user}
          sessionToken={session?.token || ''}
          apiUrl={apiUrl}
          onBack={() => setShowAdminPanel(false)}
        />
      )}

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
        <Route
          path="/producto/:slug"
          element={
            <ProductPage
              addedToCartId={addedToCartId}
              onAddToCart={(id, qty) => { handleAddToCartGated(id, qty ?? 1); setShowCart(true); }}
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {showCart && (
        <CartSidebar
          cart={cart}
          products={products}
          cartTotal={cartTotal}
          onClose={() => { setShowCart(false); clearRemovedNotice(); }}
          onRemove={handleRemoveFromCart}
          onCheckout={handleCheckout}
          currency={currency}
          notice={removedNotice > 0 ? `${removedNotice} ${removedNotice === 1 ? 'producto ya no está disponible y se quitó' : 'productos ya no están disponibles y se quitaron'} del carrito.` : null}
        />
      )}

      {showLogin && (
        <div className="modal-overlay anim-modal-overlay" onClick={() => setShowLogin(false)}>
          <div className="modal anim-modal-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Acceso a cuenta">
            <div className="modal-header">
              <h2 className="character-bounce-in">{showPasswordReset ? 'Recuperar contraseña' : pendingGoogle2FA ? 'Verificación en dos pasos' : pendingOtpEmail ? 'Verifica tu correo' : loginMode === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'}</h2>
              <button className="close-btn" onClick={() => { setShowLogin(false); setActionError(''); setPendingOtpEmail(null); setShowPasswordReset(false); }} aria-label="Cerrar diálogo">✕</button>
            </div>
            {actionError && !pendingOtpEmail && !showPasswordReset && <p className="error character-shake" style={{ padding: '0 1.5rem', marginBottom: 0 }}>{actionError}</p>}
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
        />
      )}

      {showCheckout && (
        <div className="modal-overlay" onClick={() => setShowCheckout(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Finalizar compra">
            <div className="modal-header">
              <h2>Finalizar Compra</h2>
              <button className="close-btn" onClick={() => setShowCheckout(false)} aria-label="Cerrar diálogo">✕</button>
            </div>
            <CheckoutForm
              total={cartTotal}
              itemCount={cartCount}
              loading={actionLoading}
              currency={currency}
              defaultName={user?.shipping?.full_name || ''}
              defaultEmail={user?.email || ''}
              defaultPhone={user?.shipping?.phone || ''}
              defaultAddress={user?.shipping?.address || ''}
              onSubmit={async (shippingInfo) => {
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
                  setShowCheckout(false);
                  setShowCart(false);
                  alert(`¡Gracias por tu compra! Orden: ${payload.data.id}`);
                } catch (err) {
                  alert(err instanceof Error ? err.message : 'Error al procesar la compra');
                } finally {
                  setActionLoading(false);
                }
              }}
              onCancel={() => setShowCheckout(false)}
            />
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
