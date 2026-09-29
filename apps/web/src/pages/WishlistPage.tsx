import { useNavigate } from 'react-router-dom';
import type { Product } from '../types';
import { ProductCard } from '../components/ProductCard';

type WishlistPageProps = {
  products: Product[];
  status: 'loading' | 'ready' | 'error';
  wishlist: string[];
  onToggleWishlist: (productId: string) => void;
  addedToCartId: string | null;
  onAddToCart: (productId: string) => void;
  currency: string;
};

export function WishlistPage({ products, status, wishlist, onToggleWishlist, addedToCartId, onAddToCart, currency }: WishlistPageProps) {
  const navigate = useNavigate();
  const items = products.filter(p => wishlist.includes(p.id));

  return (
    <div className="layout-main">
      <div className="container">
        <section className="products-section">
          <div className="section-header">
            <h2>❤️ Mis Favoritos ({items.length})</h2>
            <p className="section-subtitle">Tus productos guardados en este dispositivo</p>
          </div>
          {status === 'loading' && (
            <div className="loading"><div className="spinner"></div></div>
          )}
          {status === 'ready' && items.length === 0 && (
            <div className="empty-state">
              <h3>Sin favoritos</h3>
              <p>Toca el corazón en cualquier producto para guardarlo aquí.</p>
              <button className="btn btn-primary" onClick={() => navigate('/')}>Explorar tienda</button>
            </div>
          )}
          {status === 'ready' && items.length > 0 && (
            <div className="product-grid">
              {items.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onAddToCart={onAddToCart}
                  isAdded={addedToCartId === product.id}
                  currency={currency}
                  onOpen={(p) => p.slug && navigate(`/producto/${p.slug}`)}
                  wished
                  onToggleWishlist={onToggleWishlist}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
