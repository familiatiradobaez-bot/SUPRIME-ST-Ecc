import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Product } from '../types';
import { useApiUrl } from '../hooks/useApiUrl';
import { CURRENCIES } from '../lib/api';
import { ProductCard } from '../components/ProductCard';
import { SkeletonGrid } from '../components/Skeletons';

type Department = {
  id: string;
  name: string;
  slug: string;
  subdepartments: Array<{ id: string; name: string; slug: string }>;
};

type Category = {
  id: string;
  name: string;
  slug: string;
  description: string;
  image_url: string;
  department_name: string;
};

type HomePageProps = {
  products: Product[];
  status: 'loading' | 'ready' | 'error';
  searchTerm: string;
  filteredProducts: Product[];
  paginatedProducts: Product[];
  currentPage: number;
  totalPages: number;
  goToPage: (page: number) => void;
  addedToCartId: string | null;
  onAddToCart: (productId: string) => void;
  currency: string;
  setCurrency: (code: string) => void;
  wishlist: string[];
  onToggleWishlist: (productId: string) => void;
  isWished: (productId: string) => boolean;
  onShopNow: () => void;
};

export function HomePage({
  products, status, searchTerm, filteredProducts, paginatedProducts,
  currentPage, totalPages, goToPage, addedToCartId, onAddToCart, currency, setCurrency,
  wishlist, onToggleWishlist, isWished, onShopNow,
}: HomePageProps) {
  const apiUrl = useApiUrl();
  const navigate = useNavigate();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    fetch(`${apiUrl}/catalog/departments`)
      .then(r => r.json())
      .then(payload => { if (payload.data) setDepartments(payload.data); })
      .catch(() => {});
    fetch(`${apiUrl}/catalog/categories`)
      .then(r => r.json())
      .then(payload => { if (payload.data) setCategories(payload.data); })
      .catch(() => {});
  }, [apiUrl]);

  const openProduct = (p: Product) => {
    if (p.slug) navigate(`/producto/${p.slug}`);
  };

  const byDepartment = departments
    .map(d => ({ ...d, items: products.filter(p => p.department_slug === d.slug).slice(0, 10) }))
    .filter(d => d.items.length > 0);

  return (
    <div className="layout-main">
      <section className="hero">
        <h1>Bienvenido a SUPRIME</h1>
        <p>La mejor selección de productos premium. Calidad, estilo y excelencia en cada compra.</p>
        <div className="hero-actions">
          <button className="btn btn-primary btn-truck-drive" onClick={onShopNow}>
            🛍️ Explorar Tienda
          </button>
          <button className="btn btn-secondary" onClick={onShopNow}>📚 Ver Catálogo</button>
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

      {/* Categorías destacadas */}
      {categories.length > 0 && !searchTerm && (
        <div className="container">
          <section className="products-section">
            <div className="section-header">
              <h2>Comprar por Categoría</h2>
            </div>
            <div className="category-cards">
              {categories.map(c => (
                <button key={c.id} className="category-card" onClick={() => navigate(`/categoria/${c.slug}`)}>
                  {c.image_url && <img src={c.image_url} alt={c.name} loading="lazy" className="category-card-img" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                  <div className="category-card-body">
                    <strong>{c.name}</strong>
                    <small>{c.department_name}</small>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      <div className="container">
        {/* Resultados de búsqueda o catálogo general */}
        <section className="products-section" id="products">
          <div className="section-header">
            <h2>{searchTerm ? `Resultados para "${searchTerm}"` : 'Catálogo de Productos'}</h2>
            <p className="section-subtitle">
              {searchTerm ? `${filteredProducts.length} resultados` : `${products.length} productos disponibles`}
            </p>
            <div style={{ marginTop: '0.5rem' }}>
              <label htmlFor="currency-select" style={{ marginRight: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Moneda:</label>
              <select
                id="currency-select"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="currency-select"
                aria-label="Seleccionar moneda"
              >
                {Object.entries(CURRENCIES).map(([code, meta]) => (
                  <option key={code} value={code}>{meta.label}</option>
                ))}
              </select>
            </div>
          </div>

          {status === 'loading' && <SkeletonGrid count={8} />}

          {status === 'error' && (
            <div className="error-message">
              ❌ No pudimos cargar el catálogo. Por favor, intenta más tarde.
            </div>
          )}

          {status === 'ready' && (
            <>
              {paginatedProducts.length === 0 ? (
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
                        onAddToCart={onAddToCart}
                        isAdded={addedToCartId === product.id}
                        currency={currency}
                        onOpen={openProduct}
                        wished={isWished(product.id)}
                        onToggleWishlist={onToggleWishlist}
                      />
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <div className="pagination">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => { goToPage(currentPage - 1); document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' }); }}
                        disabled={currentPage === 1}
                      >
                        ← Anterior
                      </button>
                      <span className="pagination-info">
                        Página {currentPage} de {totalPages}
                      </span>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => { goToPage(currentPage + 1); document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' }); }}
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

        {/* Secciones por departamento */}
        {!searchTerm && status === 'ready' && byDepartment.map(dept => (
          <section key={dept.id} className="products-section dept-section">
            <div className="section-header dept-section-header">
              <div>
                <h2>{dept.name}</h2>
                {dept.subdepartments.length > 0 && (
                  <div className="subdept-links">
                    {dept.subdepartments.map(sub => (
                      <button key={sub.id} className="subdept-link" onClick={() => navigate(`/subdepartamento/${sub.slug}`)}>
                        {sub.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/departamento/${dept.slug}`)}>
                Ver todo →
              </button>
            </div>
            <div className="product-row">
              {dept.items.map((product) => (
                <div key={product.id} className="product-row-item">
                  <ProductCard
                    product={product}
                    onAddToCart={onAddToCart}
                    isAdded={addedToCartId === product.id}
                    currency={currency}
                    onOpen={openProduct}
                    wished={isWished(product.id)}
                    onToggleWishlist={onToggleWishlist}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
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
  );
}
