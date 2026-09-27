import type { Product } from '../types';
import { formatPrice } from '../lib/api';

type ProductCardProps = {
  product: Product;
  onAddToCart: (productId: string) => void;
  isAdded: boolean;
};

export function ProductCard({ product, onAddToCart, isAdded }: ProductCardProps) {
  return (
    <div className="product-card">
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
          <span className="product-price">{formatPrice(product.price_cents)}</span>
          <span className="product-stock">
            {product.stock_quantity > 0 ? `${product.stock_quantity} disponibles` : 'Sin stock'}
          </span>
        </div>
      </div>
      <button
        className="btn btn-primary"
        style={{
          margin: '1rem',
          width: 'calc(100% - 2rem)',
          borderRadius: '8px',
          backgroundColor: isAdded ? '#2d8a4e' : undefined,
          color: isAdded ? '#fff' : undefined,
          transition: 'background-color 0.3s ease',
        }}
        onClick={() => onAddToCart(product.id)}
        disabled={product.stock_quantity === 0}
      >
        {isAdded ? '✓ Agregado' : product.stock_quantity > 0 ? '🛒 Agregar al Carrito' : 'Sin Stock'}
      </button>
    </div>
  );
}
