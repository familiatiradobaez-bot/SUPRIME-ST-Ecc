import { useEffect, useState } from 'react';
import { SITE_URL } from '../lib/site';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { Product } from '../types';
import { useApiUrl } from '../hooks/useApiUrl';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatPrice, CURRENCIES, DEFAULT_CURRENCY } from '../lib/api';
import { img } from '../lib/images';
import { ProductCard } from '../components/ProductCard';
import { SmartImage } from '../components/SmartImage';
import { SkeletonPdp } from '../components/Skeletons';

function generateProductJsonLd(product: Product, gallery: string[], currency: string) {
  const base = SITE_URL;
  // El precio se guarda en céntimos de euro. Antes se metía ese número tal cual
  // con la etiqueta de la moneda visible: si el cliente veía RD$, Google
  // leía un precio en euros marcado como pesos. Ahora se convierte con la
  // MISMA tasa que usa formatPrice, para que ambos coincidan.
  const meta = CURRENCIES[currency] || CURRENCIES[DEFAULT_CURRENCY];
  const price = ((product.price_cents / 100) * meta.rate).toFixed(2);
  const currencyCode = CURRENCIES[currency] ? currency : DEFAULT_CURRENCY;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description || '',
    image: gallery.length > 0 ? gallery : (product.image_url ? [product.image_url] : []),
    sku: product.slug,
    mpn: product.id,
    brand: { '@type': 'Brand', name: 'SUPRIME' },
    offers: {
      '@type': 'Offer',
      url: `${base}/producto/${product.slug}`,
      priceCurrency: currencyCode,
      price: price,
      availability: product.stock_quantity > 0
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: 'SUPRIME' },
    },
    aggregateRating: product.avg_rating
      ? {
          '@type': 'AggregateRating',
          ratingValue: product.avg_rating.toFixed(1),
          reviewCount: product.review_count || 0,
        }
      : undefined,
  };
}

// Genera JSON-LD BreadcrumbList para SEO
function generateBreadcrumbJsonLd(product: Product) {
  const base = SITE_URL;
  const items = [
    { '@type': 'ListItem', position: 1, item: { '@id': `${base}/`, name: 'Inicio' } },
  ];
  let pos = 2;
  if (product.department_name && product.department_slug) {
    items.push({ '@type': 'ListItem', position: pos++, item: { '@id': `${base}/departamento/${product.department_slug}`, name: product.department_name } });
  }
  if (product.subdepartment_slug) {
    items.push({ '@type': 'ListItem', position: pos++, item: { '@id': `${base}/subdepartamento/${product.subdepartment_slug}`, name: 'Subdepartamento' } });
  }
  // category_slug no existe en el tipo Product, omitimos
  items.push({ '@type': 'ListItem', position: pos, item: { '@id': `${base}/producto/${product.slug}`, name: product.name } });

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items,
  };
items.push({ '@type': 'ListItem', position: pos, item: { '@id': `${base}/producto/${product.slug}`, name: product.name } });

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items,
  };
}

type ProductPageProps = {
  addedToCartId: string | null;
  onAddToCart: (productId: string, qty?: number) => void;
  currency: string;
  wishedIds?: string[];
  onToggleWishlist?: (productId: string) => void;
};

export function ProductPage({ addedToCartId, onAddToCart, currency, wishedIds, onToggleWishlist }: ProductPageProps) {
  const { slug } = useParams<{ slug: string }>();
  const apiUrl = useApiUrl();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [selectedImg, setSelectedImg] = useState(0);
  const [qty, setQty] = useState(1);
  const [lightbox, setLightbox] = useState(false);

  // La ruta y la imagen se pasan para que el canonical y la vista previa apunten a
  // ESTA ficha y no a la home. Sin esto, Google recibe "esta pagina es la home" en
  // todas las fichas y no indexa ninguna por separado.
  useDocumentTitle(
    product?.name || undefined,
    product?.description?.slice(0, 150),
    product ? `/producto/${product.slug}` : '/',
    product?.image_url || undefined,
  );
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!slug) return;
    setStatus('loading');
    setProduct(null);
    setSelectedImg(0);
    setQty(1);
    window.scrollTo(0, 0);

    const load = async () => {
      try {
        const res = await fetch(`${apiUrl}/catalog/products/${slug}`);
        if (!res.ok) throw new Error();
        const payload = await res.json();
        setProduct(payload.data);
        setStatus('ready');
        // Inject JSON-LD for SEO
        if (payload.data) {
          const jsonLd = generateProductJsonLd(payload.data, payload.data.images?.length ? payload.data.images : (payload.data.image_url ? [payload.data.image_url] : []), currency);
          const script = document.createElement('script');
          script.type = 'application/ld+json';
          script.text = JSON.stringify(jsonLd);
          script.id = 'product-json-ld';
          const old = document.getElementById('product-json-ld');
          if (old) old.remove();
          document.head.appendChild(script);

          // Breadcrumb JSON-LD
          const breadcrumbLd = generateBreadcrumbJsonLd(payload.data);
          const bcScript = document.createElement('script');
          bcScript.type = 'application/ld+json';
          bcScript.text = JSON.stringify(breadcrumbLd);
          bcScript.id = 'breadcrumb-json-ld';
          const oldBc = document.getElementById('breadcrumb-json-ld');
          if (oldBc) oldBc.remove();
          document.head.appendChild(bcScript);
        }
        fetch(`${apiUrl}/catalog/products/${slug}/related?limit=8`)
          .then(r => r.json())
          .then(rel => { if (rel.data) setRelated(rel.data); })
          .catch(() => {});
      } catch {
        setStatus('error');
      }
    };
    load();
  }, [apiUrl, slug, currency]);

  // Cleanup JSON-LD on unmount
  useEffect(() => {
    return () => {
      const script = document.getElementById('product-json-ld');
      if (script) script.remove();
      const bcScript = document.getElementById('breadcrumb-json-ld');
      if (bcScript) bcScript.remove();
    };
  }, []);

  // Update og:image and twitter:image for social sharing
  //
  // Este efecto va ANTES de los `return` de carga/error a propósito. Estar
  // debajo hacía que el primer render (skeleton) ejecutara menos hooks que el
  // render con el producto ya cargado, y React tumbaba el árbol entero con
  // "Rendered more hooks than during the previous render" (#310): la PDP se
  // quedaba en blanco en producción. Ningún hook puede ir después de un
  // `return` condicional.
  useEffect(() => {
    if (!product) return;
    const galleryNow = product.images?.length ? product.images : (product.image_url ? [product.image_url] : []);
    if (!galleryNow.length) return;
    const updateMeta = (property: string, content: string) => {
      let meta = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement;
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('property', property);
        document.head.appendChild(meta);
      }
      meta.content = content;
    };
    const ogImage = galleryNow[0];
    updateMeta('og:image', ogImage);
    updateMeta('og:title', product.name);
    updateMeta('og:description', product.description?.slice(0, 150) || '');
    updateMeta('og:url', `${window.location.origin}/producto/${product.slug}`);
    updateMeta('twitter:image', ogImage);
    updateMeta('twitter:title', product.name);
    updateMeta('twitter:description', product.description?.slice(0, 150) || '');
  }, [product]);

  if (status === 'loading') {
    return (
      <div className="layout-main">
        <div className="container">
          <section className="products-section">
            <SkeletonPdp />
          </section>
        </div>
      </div>
    );
  }

  if (status === 'error' || !product) {
    return (
      <div className="layout-main">
        <div className="container">
          <div className="empty-state">
            <h3>Producto no encontrado</h3>
            <p>El artículo que buscas no existe o ya no está disponible.</p>
            <button className="btn btn-primary" onClick={() => navigate('/')}>Volver a la tienda</button>
          </div>
        </div>
      </div>
    );
  }

  const gallery = product.images?.length ? product.images : (product.image_url ? [product.image_url] : []);
  const outOfStock = product.stock_quantity === 0;
  const maxQty = Math.max(1, Math.min(product.stock_quantity, 99));

  return (
    <div className="layout-main">
      <div className="container">
        <nav className="breadcrumbs" aria-label="Migas de pan">
          <Link to="/">Inicio</Link>
          {product.department_slug && (
            <>
              <span> / </span>
              <Link to={`/departamento/${product.department_slug}`}>{product.department_name || 'Departamento'}</Link>
            </>
          )}
          <span> / </span>
          <span>{product.name}</span>
        </nav>

        <section className="pdp">
          <div className="pdp-gallery">
            <div className="pdp-main-image">
              {gallery.length > 0 ? (
                <button
                  type="button"
                  className="pdp-zoom-btn"
                  onClick={() => setLightbox(true)}
                  aria-label="Ampliar imagen del producto"
                >
                  <SmartImage
                    src={gallery[Math.min(selectedImg, gallery.length - 1)]}
                    alt={product.name}
                    widths={[400, 800, 1200]}
                    sizes="(max-width: 900px) 92vw, 640px"
                    loading="eager"
                    fetchPriority="high"
                    width={800}
                    height={600}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"%3E%3Crect fill="%23333" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-size="20"%3ESin imagen%3C/text%3E%3C/svg%3E';
                    }}
                  />
                  <span className="pdp-zoom-hint" aria-hidden="true">🔍</span>
                </button>
              ) : (
                <div className="pdp-no-image">📦</div>
              )}
              {product.stock_quantity > 0 && product.stock_quantity <= 5 && (
                <span className="badge-warning">¡Solo {product.stock_quantity}!</span>
              )}
              {outOfStock && <span className="badge-danger">Agotado</span>}
            </div>
            {gallery.length > 1 && (
              <div className="pdp-thumbs">
                {gallery.map((url, i) => (
                  <button
                    key={`${url}-${i}`}
                    className={`pdp-thumb${i === selectedImg ? ' active' : ''}`}
                    onClick={() => setSelectedImg(i)}
                    aria-label={`Ver imagen ${i + 1}`}
                  >
                    <img
                      src={img(url, { w: 144, f: 'webp' })}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width="72"
                      height="72"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="pdp-info">
            <h1 className="pdp-title">{product.name}</h1>
            <div className="pdp-price">{formatPrice(product.price_cents, currency)}</div>
            <p className={`pdp-stock ${outOfStock ? 'out' : product.stock_quantity <= 5 ? 'low' : 'ok'}`}>
              {outOfStock ? '❌ Sin stock' : product.stock_quantity <= 5 ? `⚠️ Solo quedan ${product.stock_quantity}` : `✅ ${product.stock_quantity} disponibles`}
            </p>

            <div className="pdp-buy-row">
              <div className="pdp-qty">
                <button onClick={() => setQty(q => Math.max(1, q - 1))} disabled={outOfStock || qty <= 1} aria-label="Quitar uno">−</button>
                <span aria-live="polite" aria-label={`Cantidad: ${qty}`}>{qty}</span>
                <button onClick={() => setQty(q => Math.min(maxQty, q + 1))} disabled={outOfStock || qty >= maxQty} aria-label="Agregar uno">+</button>
              </div>
              <button
                className="btn btn-primary btn-glow"
                disabled={outOfStock || addedToCartId === product.id}
                onClick={() => onAddToCart(product.id, qty)}
              >
                {addedToCartId === product.id ? '✓ Agregado' : '🛒 Agregar al Carrito'}
              </button>
              {onToggleWishlist && (
                <button
                  type="button"
                  className={`btn btn-secondary wishlist-heart-btn${wishedIds?.includes(product.id) ? ' active' : ''}`}
                  onClick={() => onToggleWishlist(product.id)}
                  aria-label={wishedIds?.includes(product.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  aria-pressed={!!wishedIds?.includes(product.id)}
                >
                  {wishedIds?.includes(product.id) ? '❤️' : '🤍'}
                </button>
              )}
            </div>

            {product.description && (
              <div className="pdp-description">
                <h3>Descripción</h3>
                <p>{product.description}</p>
              </div>
            )}

            <ul className="pdp-trust">
              <li>🚚 Envío en 24-48h</li>
              <li>🛡️ Garantía total</li>
              <li>↩️ Devolución 30 días</li>
            </ul>

            <div className="pdp-share">
              <span>Compartir:</span>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`${product.name} - ${window.location.href}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-sm"
              >
                WhatsApp
              </a>
              {navigator.share && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={async () => {
                    try {
                      await navigator.share({
                        title: product.name,
                        text: product.description?.slice(0, 150),
                        url: window.location.href,
                      });
                    } catch (err) {
                      const e = err as Error;
                      if (e.name !== 'AbortError') console.warn('Share failed:', e);
                    }
                  }}
                  aria-label="Compartir con..."
                >
                  📤 Compartir
                </button>
              )}
            </div>
          </div>
        </section>

        {lightbox && gallery.length > 0 && (
          <div className="lightbox-overlay" onClick={() => setLightbox(false)}>
            <div className="lightbox-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Imagen ampliada de ${product.name}`}>
              <button className="close-btn lightbox-close" onClick={() => setLightbox(false)} aria-label="Cerrar imagen ampliada">✕</button>
              {/* El lightbox se limita a `min(900px, 100%)` de ancho, así que
                  1200px es de sobra y evita reescalar (upsampling) hacia arriba. */}
              <img src={img(gallery[Math.min(selectedImg, gallery.length - 1)], { w: 1200 })} alt={product.name} decoding="async" />
              {gallery.length > 1 && (
                <div className="lightbox-nav">
                  <button onClick={() => setSelectedImg(i => (i - 1 + gallery.length) % gallery.length)} aria-label="Imagen anterior">←</button>
                  <span>{Math.min(selectedImg, gallery.length - 1) + 1} / {gallery.length}</span>
                  <button onClick={() => setSelectedImg(i => (i + 1) % gallery.length)} aria-label="Imagen siguiente">→</button>
                </div>
              )}
            </div>
          </div>
        )}

        {related.length > 0 && (
          <section className="products-section">
            <div className="section-header">
              <h2>También te puede interesar</h2>
            </div>
            <div className="product-row">
              {related.map((rel) => (
                <div key={rel.id} className="product-row-item">
                  <ProductCard
                    product={rel}
                    onAddToCart={(id) => onAddToCart(id, 1)}
                    isAdded={addedToCartId === rel.id}
                    currency={currency}
                    onOpen={(p) => p.slug && navigate(`/producto/${p.slug}`)}
                    wished={wishedIds?.includes(rel.id)}
                    onToggleWishlist={onToggleWishlist}
                  />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
