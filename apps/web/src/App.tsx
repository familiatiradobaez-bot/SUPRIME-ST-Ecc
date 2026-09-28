import { useState, useCallback, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { useCart } from './hooks/useCart';
import { useProducts } from './hooks/useProducts';
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
import { ProductCard } from './components/ProductCard';
import { AdminPage } from './pages/AdminPage';

export function App() {
  const apiUrl = useApiUrl();
  const { user, session, loginMode, actionError, actionLoading, setUser, setSession, setLoginMode, setActionError, setActionLoading, handleLogin, handleLogout, saveShipping, persistSession, pendingOtpEmail, otpLoading, otpResending, otpError, setPendingOtpEmail, setOtpError, handleVerifyOtp, handleResendOtp, decodeTokenRole, hasAdminAccess } = useAuth();
  const { products, status, searchTerm, filteredProducts, paginatedProducts, currentPage, totalPages, setProducts, handleSearch, goToPage } = useProducts();
  const { cart, addedToCartId, cartTotal, cartCount, handleAddToCart, handleRemoveFromCart, setCart } = useCart(products);

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

  const scrollToProducts = () => {
    closeMenu();
    const element = document.getElementById('products');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    } else {
      console.warn('Elemento #products no encontrado');
    }
  };

  const handleNavClick = (section: string) => {
    if (section === 'products') {
      scrollToProducts();
    } else if (section === 'about') {
      document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' });
    } else if (section === 'contact') {
      document.querySelector('.footer')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Carrito exige login: sin sesión se abre el login y no se pierde nada
  // (el carrito ya persiste en localStorage entre recargas)
  const handleAddToCartGated = useCallback((productId: string) => {
    if (!user) {
      setShowLogin(true);
      return;
    }
    handleAddToCart(productId);
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
    const loginSuccess = params.get('login') === 'success';
    const provider = params.get('provider');
    const token = params.get('token');

    if (loginSuccess && provider === 'google' && token) {
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
      <Header
        user={user}
        cartCount={cartCount}
        searchTerm={searchTerm}
        onSearch={handleSearch}
        onCartClick={() => setShowCart(!showCart)}
        onMenuClick={() => setShowMenu(!showMenu)}
        onLoginClick={() => setShowLogin(true)}
        onUserPanelClick={() => setShowUserPanel(true)}
        onAdminClick={() => setShowAdminPanel(true)}
        isAdmin={hasAdminAccess(decodeTokenRole(session?.token || ''))}
        showMenu={showMenu}
        onCloseMenu={closeMenu}
        onNavClick={handleNavClick}
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

      <div className="layout-main">
        <section className="hero">
          <h1>Bienvenido a SUPRIME</h1>
          <p>La mejor selección de productos premium. Calidad, estilo y excelencia en cada compra.</p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-truck-drive" onClick={scrollToProducts}>
              🛍️ Explorar Tienda
            </button>
            <button className="btn btn-secondary" onClick={scrollToProducts}>📚 Ver Catálogo</button>
          </div>
        </section>

        <section className="features">
          <div className="feature-card">
            <div className="feature-icon">🚚</div>
            <h3>Envío Rápido</h3>
            <p>Entrega en 24-48 horas a toda España</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🛡️</div>
            <h3>Garantía Total</h3>
            <p>100% seguro y protegido</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">💳</div>
            <h3>Pago Fácil</h3>
            <p>Múltiples opciones de pago</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">❤️</div>
            <h3>Satisfacción Garantizada</h3>
            <p>Devolución en 30 días sin preguntas</p>
          </div>
        </section>

        <div className="container">
          <section className="products-section" id="products">
            <div className="section-header">
              <h2>Catálogo de Productos</h2>
              <p className="section-subtitle">
                {searchTerm ? `${filteredProducts.length} resultados para "${searchTerm}"` : `${products.length} productos disponibles`}
              </p>
            </div>

            {status === 'loading' && (
              <div className="loading">
                <div className="spinner"></div>
                <span style={{ marginLeft: '1rem' }}>Cargando catálogo...</span>
              </div>
            )}

            {status === 'error' && (
              <div className="error-message">
                ❌ No pudimos cargar el catálogo. Por favor, intenta más tarde.
              </div>
            )}

            {status === 'ready' && (
              <>
                {filteredProducts.length === 0 ? (
                  <div className="empty-state">
                    <h3>No hay productos</h3>
                    <p>{searchTerm ? 'No encontramos productos que coincidan con tu búsqueda.' : 'Aún no hay productos disponibles.'}</p>
                  </div>
                ) : (
                  <>
                    <div className="product-grid">
                      {paginatedProducts.map((product) => (
                        <ProductCard
                          key={product.id}
                          product={product}
                          onAddToCart={handleAddToCartGated}
                          isAdded={addedToCartId === product.id}
                        />
                      ))}
                    </div>
                    {totalPages > 1 && (
                      <div className="pagination" style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1.5rem' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => goToPage(currentPage - 1)}
                          disabled={currentPage === 1}
                        >
                          ← Anterior
                        </button>
                        <span style={{ display: 'flex', alignItems: 'center', padding: '0 1rem', color: 'var(--text-secondary)' }}>
                          Página {currentPage} de {totalPages}
                        </span>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => goToPage(currentPage + 1)}
                          disabled={currentPage === totalPages}
                        >
                          Siguiente →
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </div>

        <section className="about-section" id="about">
          <div className="about-content">
            <h2>Sobre SUPRIME</h2>
            <p>
              SUPRIME es tu tienda de confianza para productos de calidad premium. Nos dedicamos a ofrecer la mejor experiencia de compra con productos cuidadosamente seleccionados, atención al cliente excepcional y entrega rápida.
            </p>
            <p>
              Con más de 10 años en el mercado, hemos ganado la confianza de miles de clientes. Nuestra misión es hacer que cada compra sea memorable.
            </p>
          </div>
        </section>
      </div>

      {showCart && (
        <CartSidebar
          cart={cart}
          products={products}
          cartTotal={cartTotal}
          onClose={() => setShowCart(false)}
          onRemove={handleRemoveFromCart}
          onCheckout={handleCheckout}
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
