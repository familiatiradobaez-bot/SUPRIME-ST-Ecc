import { useState, useCallback, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useCart } from './hooks/useCart';
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
  const { cart, addedToCartId, cartTotal, cartCount, handleAddToCart, handleRemoveFromCart, setCart } = useCart(products);
  const { currency, setCurrency } = useCurrency();

  const [showCart, setShowCart] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  // Cerrar modal de login automáticamente cuando el usuario inicia sesión
  useEffect(() => {
    if (user && showLogin) {
      setShowLogin(false);
      setPendingOtpEmail(null);
      setOtpError('');
    }
  }, [user, showLogin]);

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
          onClose={() => setShowCart(false)}
          onRemove={handleRemoveFromCart}
          onCheckout={handleCheckout}
          currency={currency}
        />
      )}

      {showLogin && (
        <div className="modal-overlay anim-modal-overlay" onClick={() => setShowLogin(false)}>
          <div className="modal anim-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="character-bounce-in">{showPasswordReset ? 'Recuperar contraseña' : pendingOtpEmail ? 'Verifica tu correo' : loginMode === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'}</h2>
              <button className="close-btn" onClick={() => { setShowLogin(false); setActionError(''); setPendingOtpEmail(null); setShowPasswordReset(false); }}>✕</button>
            </div>
            {actionError && !pendingOtpEmail && !showPasswordReset && <p className="error character-shake" style={{ color: '#a3422b', padding: '0 1.5rem', marginBottom: 0 }}>{actionError}</p>}
            {showPasswordReset ? (
              <PasswordResetForm
                apiUrl={apiUrl}
                onDone={() => { setShowPasswordReset(false); setLoginMode('login'); }}
                onBack={() => setShowPasswordReset(false)}
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
          onClose={() => setShowUserPanel(false)}
          onLogout={handleLogout}
          onSaveShipping={saveShipping}
        />
      )}

      {showCheckout && (
        <div className="modal-overlay" onClick={() => setShowCheckout(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Finalizar Compra</h2>
              <button className="close-btn" onClick={() => setShowCheckout(false)}>✕</button>
            </div>
            <CheckoutForm
              total={cartTotal}
              itemCount={cartCount}
              loading={actionLoading}
              defaultName={user?.shipping?.full_name || ''}
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
