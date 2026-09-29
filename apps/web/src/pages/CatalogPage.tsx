import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { Product } from '../types';
import { useApiUrl } from '../hooks/useApiUrl';
import { ProductCard } from '../components/ProductCard';

type CatalogPageProps = {
  kind: 'categoria' | 'departamento' | 'subdepartamento';
  addedToCartId: string | null;
  onAddToCart: (productId: string) => void;
  currency: string;
  wishlist?: string[];
  onToggleWishlist?: (productId: string) => void;
};

const KIND_LABEL: Record<CatalogPageProps['kind'], string> = {
  categoria: 'Categoría',
  departamento: 'Departamento',
  subdepartamento: 'Subdepartamento',
};

export function CatalogPage({ kind, addedToCartId, onAddToCart, currency, wishlist, onToggleWishlist }: CatalogPageProps) {
  const { slug } = useParams<{ slug: string }>();
  const apiUrl = useApiUrl();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [items, setItems] = useState<Product[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;

  useEffect(() => {
    if (!slug) return;
    setStatus('loading');
    setItems([]);
    setPage(1);

    const load = async () => {
      try {
        if (kind === 'categoria') {
          const [prodRes, catRes] = await Promise.all([
            fetch(`${apiUrl}/catalog/categories/${slug}/products`),
            fetch(`${apiUrl}/catalog/categories`),
          ]);
          if (!prodRes.ok) throw new Error();
          const payload = await prodRes.json();
          let name = slug;
          try {
            const cats = await catRes.json();
            const found = (cats.data || []).find((c: any) => c.slug === slug);
            if (found) {
              name = found.name;
              setSubtitle(`${found.department_name} · ${payload.data?.length || 0} productos`);
            } else {
              setSubtitle(`${payload.data?.length || 0} productos`);
            }
          } catch {
            setSubtitle(`${payload.data?.length || 0} productos`);
          }
          setTitle(name);
          setItems(payload.data || []);
        } else if (kind === 'departamento') {
          const res = await fetch(`${apiUrl}/catalog/departments/${slug}/products`);
          if (!res.ok) throw new Error();
          const payload = await res.json();
          setTitle(payload.data?.department?.name || slug);
          setSubtitle(`${payload.data?.products?.length || 0} productos`);
          setItems(payload.data?.products || []);
        } else {
          const res = await fetch(`${apiUrl}/catalog/subdepartments/${slug}/products`);
          if (!res.ok) throw new Error();
          const payload = await res.json();
          const sub = payload.data?.subdepartment;
          setTitle(sub?.name || slug);
          setSubtitle(sub ? `${sub.department_name} · ${payload.data?.products?.length || 0} productos` : '');
          setItems(payload.data?.products || []);
        }
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    };
    load();
  }, [apiUrl, kind, slug]);

  const totalPages = Math.ceil(items.length / PAGE_SIZE);
  const visible = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="layout-main">
      <div className="container">
        <nav className="breadcrumbs" aria-label="Migas de pan">
          <Link to="/">Inicio</Link>
          <span> / </span>
          <span>{KIND_LABEL[kind]}: {title}</span>
        </nav>
        <section className="products-section">
          <div className="section-header">
            <h2 style={{ textTransform: 'capitalize' }}>{title}</h2>
            {subtitle && <p className="section-subtitle">{subtitle}</p>}
          </div>
          {status === 'loading' && (
            <div className="loading"><div className="spinner"></div></div>
          )}
          {status === 'error' && (
            <div className="error-message">❌ No encontramos esta sección.</div>
          )}
          {status === 'ready' && items.length === 0 && (
            <div className="empty-state">
              <h3>Sin productos</h3>
              <p>Aún no hay productos en esta sección.</p>
            </div>
          )}
          {status === 'ready' && items.length > 0 && (
            <>
              <div className="product-grid">
                {visible.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onAddToCart={onAddToCart}
                    isAdded={addedToCartId === product.id}
                    currency={currency}
                    onOpen={(p) => p.slug && navigate(`/producto/${p.slug}`)}
                    wished={wishlist?.includes(product.id)}
                    onToggleWishlist={onToggleWishlist}
                  />
                ))}
              </div>
              {totalPages > 1 && (
                <div className="pagination">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    ← Anterior
                  </button>
                  <span className="pagination-info">
                    Página {page} de {totalPages}
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Siguiente →
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
