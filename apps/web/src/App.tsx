import { useEffect, useState, useCallback, useRef } from 'react';

type Product = {
  id: string;
  name: string;
  description: string;
  image_url: string;
  price_cents: number;
  stock_quantity: number;
};

type CartItem = {
  id: string;
  quantity: number;
};

type User = {
  id: string;
  username: string;
  email: string;
  display_name: string;
  role_id: string;
};

type Session = {
  id: string;
  token: string;
  expires_at: string;
};

// Componente de formulario de login/registro
function LoginForm({ onSubmit, onCancel, mode, onToggleMode }: { 
  onSubmit: (email: string, password: string, extra?: { username: string; display_name: string }) => void; 
  onCancel: () => void;
  mode: 'login' | 'register';
  onToggleMode: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'register') {
      if (password.length < 6) {
        setError('La contraseña debe tener al menos 6 caracteres');
        return;
      }
      if (username.length < 3) {
        setError('El username debe tener al menos 3 caracteres');
        return;
      }
      onSubmit(email, password, { username, display_name: displayName || username });
    } else {
      onSubmit(email, password);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="form">
      {error && <p className="error" style={{ color: '#a3422b', marginBottom: '1rem' }}>{error}</p>}
      {mode === 'register' && (
        <>
          <div className="form-group">
            <label>Nombre para mostrar:</label>
            <input 
              type="text" 
              value={displayName} 
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Juan Pérez"
            />
          </div>
          <div className="form-group">
            <label>Nombre de usuario:</label>
            <input 
              type="text" 
              value={username} 
              onChange={(e) => setUsername(e.target.value)}
              placeholder="juanperez"
              required
              minLength={3}
            />
          </div>
        </>
      )}
      <div className="form-group">
        <label>Correo Electrónico:</label>
        <input 
          type="email" 
          value={email} 
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@correo.com"
          required
          autoFocus
        />
      </div>
      <div className="form-group">
        <label>Contraseña:</label>
        <input 
          type="password" 
          value={password} 
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
          minLength={mode === 'register' ? 6 : 1}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        />
        {mode === 'register' && <small style={{ color: '#68736b' }}>Mínimo 6 caracteres</small>}
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          {mode === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
      </div>
      <p className="form-text">
        {mode === 'login' ? (
          <>¿No tienes cuenta? <a href="#signup" onClick={(e) => { e.preventDefault(); onToggleMode(); setError(''); }} style={{ color: '#c65d35', cursor: 'pointer' }}>Regístrate aquí</a></>
        ) : (
          <>¿Ya tienes cuenta? <a href="#login" onClick={(e) => { e.preventDefault(); onToggleMode(); setError(''); }} style={{ color: '#c65d35', cursor: 'pointer' }}>Inicia sesión</a></>
        )}
      </p>
    </form>
  );
}

// Componente de formulario de checkout
function CheckoutForm({ total, itemCount, onSubmit, onCancel, loading }: { total: number; itemCount: number; onSubmit: (shippingInfo: { shipping_name: string; shipping_email: string; shipping_phone: string; shipping_address: string; payment_method: string; card_number?: string; card_expiry?: string; card_cvv?: string }) => void; onCancel: () => void; loading?: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ shipping_name: name, shipping_email: email, shipping_phone: phone, shipping_address: address, payment_method: paymentMethod, card_number: cardNumber, card_expiry: cardExpiry, card_cvv: cardCvv }); }} className="form">
      <div className="checkout-summary">
        <p><strong>Artículos:</strong> {itemCount}</p>
        <p><strong>Total:</strong> {(total / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</p>
      </div>

      <h3>Información de Envío</h3>
      <div className="form-group">
        <label>Nombre Completo:</label>
        <input 
          type="text" 
          value={name} 
          onChange={(e) => setName(e.target.value)}
          placeholder="Juan Pérez"
          required
        />
      </div>
      <div className="form-group">
        <label>Correo Electrónico:</label>
        <input 
          type="email" 
          value={email} 
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@correo.com"
          required
        />
      </div>
      <div className="form-group">
        <label>Teléfono:</label>
        <input 
          type="tel" 
          value={phone} 
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+34 123 456 789"
          required
          pattern="[+]?[0-9\s]{9,15}"
          title="Introduce un número de teléfono válido (9-15 dígitos)"
        />
      </div>
      <div className="form-group">
        <label>Dirección de Envío:</label>
        <input 
          type="text" 
          value={address} 
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Calle Principal 123, Madrid"
          required
        />
      </div>

      <h3>Método de Pago</h3>
      <div className="form-group">
        <label>
          <input 
            type="radio" 
            value="card" 
            checked={paymentMethod === 'card'} 
            onChange={(e) => setPaymentMethod(e.target.value)}
          />
          Tarjeta de Crédito
        </label>
      </div>
      <div className="form-group">
        <label>
          <input 
            type="radio" 
            value="paypal" 
            checked={paymentMethod === 'paypal'} 
            onChange={(e) => setPaymentMethod(e.target.value)}
          />
          PayPal
        </label>
      </div>
      <div className="form-group">
        <label>
          <input 
            type="radio" 
            value="bank" 
            checked={paymentMethod === 'bank'} 
            onChange={(e) => setPaymentMethod(e.target.value)}
          />
          Transferencia Bancaria
        </label>
      </div>

      {paymentMethod === 'card' && (
        <>
          <div className="form-group">
            <label>Número de Tarjeta:</label>
            <input 
              type="text" 
              value={cardNumber} 
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder="1234 5678 9012 3456"
              required
              maxLength={19}
              pattern="[0-9\s]{13,19}"
              title="Introduce un número de tarjeta válido (13-19 dígitos)"
            />
          </div>
          <div className="form-group">
            <label>Fecha de Expiración:</label>
            <input 
              type="text" 
              value={cardExpiry} 
              onChange={(e) => setCardExpiry(e.target.value)}
              placeholder="MM/AA"
              required
              maxLength={5}
              pattern="(0[1-9]|1[0-2])/[0-9]{2}"
              title="Formato MM/AA"
            />
          </div>
          <div className="form-group">
            <label>CVV:</label>
            <input 
              type="text" 
              value={cardCvv} 
              onChange={(e) => setCardCvv(e.target.value)}
              placeholder="123"
              required
              maxLength={4}
              pattern="[0-9]{3,4}"
              title="3 o 4 dígitos"
            />
          </div>
        </>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Procesando...' : 'Confirmar Compra'}</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

// Detectar automáticamente la URL del API
const getApiUrl = () => {
  // 1. Configuración dinámica desde public/config.js (actualizada por el script de inicio)
  const dynamicConfig = (window as any).__APP_CONFIG__;
  if (dynamicConfig?.API_URL) {
    return dynamicConfig.API_URL;
  }

  // 2. Variable de entorno de Vite (para producción con build)
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  
  const host = window.location.hostname;
  const protocol = window.location.protocol;
  
  // 3. Si se accede desde ngrok, usar IP local para la API (funciona solo en PC)
  if (host.includes('ngrok')) {
    return `http://192.168.0.105:8789/api/v1`;
  }
  
  // 4. Si se accede desde el túnel de Cloudflare, usar el túnel HTTPS de la API
  if (host.includes('trycloudflare.com')) {
    const tunnelName = host.split('.')[0];
    return `https://${tunnelName}-api.trycloudflare.com/api/v1`;
  }
  
  // 5. Si se accede desde la red local o localhost
  const apiHost = (host.startsWith('192.168') || host.startsWith('localhost') || host.startsWith('127.0.0.1')) ? 'localhost' : host;
  const port = 8789;
  return `${protocol}//${apiHost}:${port}/api/v1`;
};



export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loginMode, setLoginMode] = useState<'login' | 'register'>('login');
  const [actionError, setActionError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const maxRetries = 3;
    let retryCount = 0;

    const fetchProducts = async () => {
      try {
        const response = await fetch(`${getApiUrl()}/catalog/products`);
        if (!response.ok) throw new Error('Catalog request failed');
        const payload = await response.json() as { data: Product[] };
        if (!cancelled) {
          setProducts(payload.data);
          setFilteredProducts(payload.data);
          setStatus('ready');
        }
      } catch (err) {
        if (!cancelled) {
          retryCount++;
          if (retryCount < maxRetries) {
            setTimeout(fetchProducts, 1000 * retryCount);
          } else {
            setStatus('error');
          }
        }
      }
    };

    fetchProducts();
    return () => { cancelled = true; };
  }, []);

  const handleSearch = (term: string) => {
    setSearchTerm(term);
    const filtered = products.filter(p => 
      p.name.toLowerCase().includes(term.toLowerCase()) ||
      p.description.toLowerCase().includes(term.toLowerCase())
    );
    setFilteredProducts(filtered);
  };

  const [addedToCartId, setAddedToCartId] = useState<string | null>(null);
  const addedToCartTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAddToCart = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product || product.stock_quantity === 0) return;

    const cartItem = cart.find(item => item.id === productId);
    const currentQuantity = cartItem?.quantity ?? 0;
    if (currentQuantity >= product.stock_quantity) {
      alert(`Solo hay ${product.stock_quantity} unidades disponibles`);
      return;
    }

    setCart(prevCart => {
      const existing = prevCart.find(item => item.id === productId);
      if (existing) {
        return prevCart.map(item => 
          item.id === productId ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prevCart, { id: productId, quantity: 1 }];
    });
    setAddedToCartId(productId);
    if (addedToCartTimeout.current) clearTimeout(addedToCartTimeout.current);
    addedToCartTimeout.current = setTimeout(() => setAddedToCartId(null), 1500);
  };

  const handleRemoveFromCart = (productId: string) => {
    setCart(prevCart => prevCart.filter(item => item.id !== productId));
  };

  const cartTotal = cart.reduce((sum, item) => {
    const product = products.find(p => p.id === item.id);
    return sum + (product && product.price_cents != null ? product.price_cents * item.quantity : 0);
  }, 0);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

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

  const handleCheckout = () => {
    setShowCart(false);
    setShowCheckout(true);
  };

  // Restore session from localStorage on mount
  useEffect(() => {
    const savedSession = localStorage.getItem('su_prime_session');
    const savedUser = localStorage.getItem('su_prime_user');
    if (savedSession && savedUser) {
      try {
        const sessionData = JSON.parse(savedSession);
        const userData = JSON.parse(savedUser);
        // Verificar que la sesión no haya expirado
        if (sessionData.expires_at && new Date(sessionData.expires_at) > new Date()) {
          setSession(sessionData);
          setUser(userData);
        } else {
          localStorage.removeItem('su_prime_session');
          localStorage.removeItem('su_prime_user');
        }
      } catch {
        localStorage.removeItem('su_prime_session');
        localStorage.removeItem('su_prime_user');
      }
    }
  }, []);

  // Cerrar modales con tecla Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowLogin(false);
      setShowCheckout(false);
      setShowCart(false);
      setShowMenu(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleLogin = async (email: string, password: string, extra?: { username: string; display_name: string }) => {
    setActionLoading(true);
    setActionError('');
    try {
      const url = loginMode === 'register' ? `${getApiUrl()}/auth/register` : `${getApiUrl()}/auth/login`;
      const body = loginMode === 'register'
        ? { email, password, username: extra?.username, display_name: extra?.display_name }
        : { email, password };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = await response.json();

      if (!response.ok) {
        const errorMsg = payload.error === 'INVALID_CREDENTIALS'
          ? 'Credenciales incorrectas'
          : payload.error === 'USER_ALREADY_EXISTS'
            ? 'El usuario ya existe'
            : payload.error === 'INVALID_INPUT'
              ? 'Datos inválidos'
              : 'Error del servidor';
        throw new Error(errorMsg);
      }

      const { user: userData, session: sessionData } = payload.data;
      setUser(userData);
      setSession(sessionData);
      localStorage.setItem('su_prime_session', JSON.stringify(sessionData));
      localStorage.setItem('su_prime_user', JSON.stringify(userData));
      setShowLogin(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setActionLoading(false);
    }
  };

  // Helper para obtener headers con token de sesión
  const getAuthHeaders = (): HeadersInit => {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (session?.token) {
      headers['Authorization'] = `Bearer ${session.token}`;
    }
    return headers;
  };

  const handleLogout = async () => {
    if (session) {
      try {
        await fetch(`${getApiUrl()}/auth/logout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.token}` },
        });
      } catch {
        // Ignore logout errors
      }
    }
    setUser(null);
    setSession(null);
    localStorage.removeItem('su_prime_session');
    localStorage.removeItem('su_prime_user');
    setShowMenu(false);
  };

  return (
    <div className="layout">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <h1 className="logo">✨ SUPRIME</h1>
          <div className="search-bar">
            <input 
              type="text" 
              placeholder="Buscar..."
              value={searchTerm}
              onChange={(e) => handleSearch(e.target.value)}
              className="search-input"
            />
          </div>
          <div className="header-right">
            <button 
              className="btn btn-primary btn-sm"
              onClick={() => setShowCart(!showCart)}
            >
              🛒 ({cartCount})
            </button>
            {user ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>👤 {user.display_name || user.username}</span>
                <button 
                  className="btn btn-secondary btn-sm"
                  onClick={handleLogout}
                >
                  Cerrar Sesión
                </button>
              </div>
            ) : (
              <button 
                className="btn btn-secondary btn-sm"
                onClick={() => setShowLogin(true)}
              >
                👤 Cuenta
              </button>
            )}
            <button 
              className="menu-toggle"
              onClick={() => setShowMenu(!showMenu)}
              aria-label="Menu"
            >
              ☰
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {showMenu && (
          <nav className="mobile-menu">
            <a href="#products" onClick={scrollToProducts}>Tienda</a>
            <a href="#about" onClick={closeMenu}>Sobre Nosotros</a>
            <a href="#contact" onClick={closeMenu}>Contacto</a>
            {user ? (
              <>
                <p style={{ padding: '0.5rem 1rem', fontWeight: 600 }}>👤 {user.display_name || user.username}</p>
                <button className="btn btn-secondary" style={{ width: '100%' }} onClick={handleLogout}>
                  Cerrar Sesión
                </button>
              </>
            ) : (
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => { setShowMenu(false); setShowLogin(true); }}>
                👤 Cuenta
              </button>
            )}
          </nav>
        )}

        {/* Desktop Nav */}
        <nav className="nav">
          <a href="#products" onClick={(e) => { e.preventDefault(); scrollToProducts(); }}>Tienda</a>
          <a href="#about" onClick={(e) => { e.preventDefault(); document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' }); }}>Sobre Nosotros</a>
          <a href="#contact" onClick={(e) => { e.preventDefault(); document.querySelector('.footer')?.scrollIntoView({ behavior: 'smooth' }); }}>Contacto</a>
        </nav>
      </header>

      {/* Main Content */}
      <div className="layout-main">
        {/* Hero Section */}
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

        {/* Features Section */}
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

        {/* Products Section */}
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
                      <div className="product-card" key={product.id}>
                        <div className="product-image-wrapper">
                          <img 
                            src={product.image_url} 
                            alt={product.name}
                            className="product-image"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"%3E%3Crect fill="%23e5e7eb" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%239ca3af" font-size="20"%3E📦%3C/text%3E%3C/svg%3E';
                            }}
                          />
                          {product.stock_quantity > 0 && product.stock_quantity <= 5 && (
                            <span className="badge-warning">¡Pocas unidades!</span>
                          )}
                          {product.stock_quantity === 0 && (
                            <span className="badge-danger">Agotado</span>
                          )}
                        </div>
                        <div className="product-body">
                          <h3 className="product-name">{product.name}</h3>
                          <p className="product-desc">{product.description}</p>
                          <div className="product-footer">
                            <span className="product-price">
                              {(product.price_cents / 100).toLocaleString('es-ES', { 
                                style: 'currency', 
                                currency: 'EUR' 
                              })}
                            </span>
                            <span className="product-stock">
                              {product.stock_quantity > 0 
                                ? `${product.stock_quantity} disponibles` 
                                : 'Sin stock'}
                            </span>
                          </div>
                        </div>
                        <button 
                          className="btn btn-primary" 
                          style={{ 
                            margin: '1rem', 
                            width: 'calc(100% - 2rem)', 
                            borderRadius: '8px',
                            backgroundColor: addedToCartId === product.id ? '#2d8a4e' : undefined,
                            color: addedToCartId === product.id ? '#fff' : undefined,
                            transition: 'background-color 0.3s ease',
                          }}
                          onClick={() => handleAddToCart(product.id)}
                          disabled={product.stock_quantity === 0}
                        >
                          {addedToCartId === product.id ? '✓ Agregado' : product.stock_quantity > 0 ? '🛒 Agregar al Carrito' : 'Sin Stock'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        {/* About Section */}
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

      {/* Cart Sidebar */}
      {showCart && (
        <>
          <div className="cart-overlay" onClick={() => setShowCart(false)} />
          <div className="cart-sidebar">
            <div className="cart-header">
              <h3>Tu Carrito</h3>
              <button 
                className="close-btn"
                onClick={() => setShowCart(false)}
              >
                ✕
              </button>
            </div>
          <div className="cart-items">
            {cart.length === 0 ? (
              <p className="empty-cart">Tu carrito está vacío</p>
            ) : (
              <>
                {cart.map(item => {
                  const product = products.find(p => p.id === item.id);
                  return product ? (
                    <div key={item.id} className="cart-item">
                      <div className="cart-item-info">
                        <p className="cart-item-name">{product.name}</p>
                        <p className="cart-item-price">
                          {(product.price_cents / 100).toLocaleString('es-ES', { 
                            style: 'currency', 
                            currency: 'EUR' 
                          })} x {item.quantity}
                        </p>
                      </div>
                      <button 
                        className="btn-remove"
                        onClick={() => handleRemoveFromCart(item.id)}
                      >
                        🗑️
                      </button>
                    </div>
                  ) : null;
                })}
              </>
            )}
          </div>
          {cart.length > 0 && (
            <div className="cart-footer">
              <div className="cart-total">
                <strong>Total:</strong>
                <strong>
                  {(cartTotal / 100).toLocaleString('es-ES', { 
                    style: 'currency', 
                    currency: 'EUR' 
                  })}
                </strong>
              </div>
              <button className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} onClick={handleCheckout}>
                💳 Proceder al Pago
              </button>
            </div>
          )}
          </div>
        </>
      )}

      {/* Login Modal */}
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

      {/* Checkout Modal */}
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
              onSubmit={async (shippingInfo) => {
                setActionLoading(true);
                try {
                  const response = await fetch(`${getApiUrl()}/orders`, {
                    method: 'POST',
                    headers: getAuthHeaders(),
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

                  // Actualizar stock local después de compra exitosa
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

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div className="footer-section">
            <h4>Sobre SUPRIME</h4>
            <ul>
              <li><a href="#about">Acerca de nosotros</a></li>
              <li><a href="#blog">Blog</a></li>
              <li><a href="#careers">Trabaja con nosotros</a></li>
            </ul>
          </div>
          <div className="footer-section">
            <h4>Ayuda</h4>
            <ul>
              <li><a href="#faq">Preguntas frecuentes</a></li>
              <li><a href="#contact">Contacto</a></li>
              <li><a href="#support">Soporte</a></li>
            </ul>
          </div>
          <div className="footer-section">
            <h4>Legal</h4>
            <ul>
              <li><a href="#privacy">Política de Privacidad</a></li>
              <li><a href="#terms">Términos y Condiciones</a></li>
              <li><a href="#shipping">Envíos y Devoluciones</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; 2024 SUPRIME. Todos los derechos reservados.</p>
          <div className="social-links">
            <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" aria-label="Facebook">f</a>
            <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" aria-label="Twitter">𝕏</a>
            <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" aria-label="Instagram">📷</a>
          </div>
        </div>
      </footer>
    </div>
  );
}