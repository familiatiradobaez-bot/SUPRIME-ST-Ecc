import type { Product } from '../types';
import { formatPrice } from '../lib/api';
import { SmartImage } from './SmartImage';

type ProductCardProps = {
  product: Product;
  onAddToCart: (productId: string) => void;
  isAdded: boolean;
  currency?: string;
  onOpen?: (product: Product) => void;
  wished?: boolean;
  onToggleWishlist?: (productId: string) => void;
};

export function ProductCard({ product, onAddToCart, isAdded, currency = 'EUR', onOpen, wished, onToggleWishlist }: ProductCardProps) {
  return (
    <div
      className="product-card anim-product-card"
      onClick={() => onOpen?.(product)}
      role={onOpen ? 'link' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter') onOpen(product); } : undefined}
      style={onOpen ? { cursor: 'pointer' } : undefined}
    >
      <div className="product-image-wrapper">
        {/* La rejilla es `auto-fill minmax(160px, 1fr)` sobre un contenedor de
            1400px: en escritorio la tarjeta ronda los 160-200px, no los 400
            que se pedían antes. Por eso el `srcset` empieza en 200. */}
        <SmartImage
          src={product.image_url}
          alt={product.name}
          widths={[200, 400, 600]}
          sizes="(max-width: 640px) 46vw, (max-width: 1024px) 24vw, 200px"
          className="product-image"
          width={400}
          height={300}
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"%3E%3Crect fill="%23e5e7eb" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%239ca3af" font-size="20"%3E📦%3C/text%3E%3C/svg%3E';
          }}
        />
        {product.stock_quantity > 0 && product.stock_quantity <= 5 && (
          <span className="badge-warning">¡Solo {product.stock_quantity}!</span>
        )}
        {product.stock_quantity === 0 && (
          <span className="badge-danger">Agotado</span>
        )}
        {onToggleWishlist && (
          <button
            type="button"
            className={`wishlist-heart${wished ? ' active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleWishlist(product.id); }}
            aria-label={wished ? `Quitar ${product.name} de favoritos` : `Agregar ${product.name} a favoritos`}
            aria-pressed={!!wished}
          >
            {wished ? '❤️' : '🤍'}
          </button>
        )}
      </div>
      <div className="product-body">
        <h3 className="product-name">{product.name}</h3>
        <p className="product-desc">{product.description}</p>
        <div className="product-footer">
          <span className="product-price">{formatPrice(product.price_cents, currency)}</span>
          <span className="product-stock">
            {product.stock_quantity > 0 ? `${product.stock_quantity} disponibles` : 'Sin stock'}
          </span>
        </div>
      </div>
      <button
        className={`btn btn-primary product-card-btn ${isAdded ? 'btn-success' : ''}`}
        onClick={(e) => { e.stopPropagation(); onAddToCart(product.id); }}
        disabled={product.stock_quantity === 0}
        data-testid="add-to-cart"
        data-slug={product.slug}
        aria-label={`Agregar ${product.name} al carrito`}
      >
        {isAdded ? '✓ Agregado' : product.stock_quantity > 0 ? '🛒 Agregar al Carrito' : 'Sin Stock'}
      </button>
    </div>
  );
}
