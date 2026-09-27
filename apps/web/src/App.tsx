import { useState, useCallback, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { useCart } from './hooks/useCart';
import { useProducts } from './hooks/useProducts';
import { useApiUrl } from './hooks/useApiUrl';
import { getAuthHeaders } from './lib/api';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { LoginForm } from './components/LoginForm';
import { CheckoutForm } from './components/CheckoutForm';
import { UserPanel } from './components/UserPanel';
import { CartSidebar } from './components/CartSidebar';
import { ProductCard } from './components/ProductCard';
import { AdminPanel } from './components/AdminPanel';

export function App() {
  const apiUrl = useApiUrl();
  const { user, session, loginMode, actionError, actionLoading, setLoginMode, setActionError, setActionLoading, handleLogin, handleLogout, saveShipping, decodeTokenRole, hasAdminAccess } = useAuth();
  const { products, status, searchTerm, filteredProducts, setProducts, handleSearch } = useProducts();
  const { cart, addedToCartId, cartTotal, cartCount, handleAddToCart, handleRemoveFromCart, setCart } = useCart(products);

  const [showCart, setShowCart] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);

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

  const handleCheckout = () => {
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

      {/* Admin Panel - solo visible para admin+ */}
      {showAdminPanel && user && ['role-admin', 'role-owner', 'role-stock-manager'].includes(user.role_id) && (
        <AdminPanel
          onClose={() => setShowAdminPanel(false)}
          authToken={session?.token || ''}
          apiUrl={apiUrl}
        />
      )}

      <div className="layout-main">
        <section className="hero">
          <h1>Bienvenido a SUPRIME</h1>
          <p>La mejor selección de productos premium. Calidad, estilo y excelencia en cada compra.</p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={scrollToProducts}>
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
                  <div className="product-grid">
                    {filteredProducts.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        onAddToCart={handleAddToCart}
                        isAdded={addedToCartId === product.id}
                      />
                    ))}
                  </div>
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
        <div className="modal-overlay" onClick={() => setShowLogin(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{loginMode === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'}</h2>
              <button className="close-btn" onClick={() => { setShowLogin(false); setActionError(''); }}>✕</button>
            </div>
            {actionError && <p className="error" style={{ color: '#a3422b', padding: '0 1.5rem', marginBottom: 0 }}>{actionError}</p>}
            <LoginForm
              onSubmit={handleLogin}
              onCancel={() => { setShowLogin(false); setActionError(''); }}
              mode={loginMode}
              onToggleMode={() => { setLoginMode(prev => prev === 'login' ? 'register' : 'login'); setActionError(''); }}
            />
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
                    headers: getAuthHeaders(session),
                    body: JSON.stringify({
                      items: cart.map(item => {
                        const product = products.find(p => p.id === item.id);
                        if (!product) return null;
                        return { product_id: item.id, quantity: item.quantity, price_cents: product.price_cents };
                      }).filter(Boolean),
                      ...shippingInfo,
                    }),
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
