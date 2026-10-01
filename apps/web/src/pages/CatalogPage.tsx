import { useEffect, useState } from 'react';
import { SITE_URL } from '../lib/site';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { Product } from '../types';
import { useApiUrl } from '../hooks/useApiUrl';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ProductCard } from '../components/ProductCard';
import { SkeletonGrid } from '../components/Skeletons';

// Genera JSON-LD ItemList para categorías/departamentos
function generateItemListJsonLd(items: Array<{ slug?: string; name: string; image_url?: string }>, baseTitle: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: baseTitle,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Product',
        name: item.name,
        url: item.slug ? `${SITE_URL}/producto/${item.slug}` : undefined,
        image: item.image_url,
      },
    })),
  };
}

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

  // Canonical de la pagina de catalogo. Sin esto, /categoria/x se declara
  // duplicado de la home y no se indexa.
  useDocumentTitle(title || undefined, undefined, `/categoria/${slug}`);

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
        // Inject JSON-LD ItemList for SEO
        if (items.length > 0) {
          const jsonLd = generateItemListJsonLd(items.slice(0, 50), `${KIND_LABEL[kind]}: ${title}`);
          const script = document.createElement('script');
          script.type = 'application/ld+json';
          script.text = JSON.stringify(jsonLd);
          script.id = 'itemlist-json-ld';
          const old = document.getElementById('itemlist-json-ld');
          if (old) old.remove();
          document.head.appendChild(script);
        }
      } catch {
        setStatus('error');
      }
    };
    load();
  }, [apiUrl, kind, slug]);

  // Cleanup JSON-LD on unmount
  useEffect(() => {
    return () => {
      const script = document.getElementById('itemlist-json-ld');
      if (script) script.remove();
    };
  }, []);

  // Update og:image and twitter:image for social sharing
  useEffect(() => {
    if (!items.length) return;
    const updateMeta = (property: string, content: string) => {
      let meta = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement;
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('property', property);
        document.head.appendChild(meta);
      }
      meta.content = content;
    };
    const updateTwitterMeta = (name: string, content: string) => {
      let meta = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement;
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', name);
        document.head.appendChild(meta);
      }
      meta.content = content;
    };
    // Sin imagen propia del producto, la de la marca. Antes ponia un .jpg que no
  // existe en public/ (alli esta og-cover.svg), o sea que nunca se veia.
  const ogImage = items[0]?.image_url || `${SITE_URL}/og-cover.svg`;
    updateMeta('og:image', ogImage);
    updateMeta('og:title', `${KIND_LABEL[kind]}: ${title}`);
    updateMeta('og:description', subtitle || '');
    updateMeta('og:url', `${window.location.origin}${window.location.pathname}`);
    updateMeta('twitter:image', ogImage);
    updateMeta('twitter:title', `${KIND_LABEL[kind]}: ${title}`);
    updateMeta('twitter:description', subtitle || '');
  }, [items, kind, title, subtitle]);

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
          {status === 'loading' && <SkeletonGrid count={8} />}
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
