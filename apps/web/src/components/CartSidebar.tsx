import type { CartItem, Product } from '../types';
import { formatPrice } from '../lib/api';

type CartSidebarProps = {
  cart: CartItem[];
  products: Product[];
  cartTotal: number;
  onClose: () => void;
  onRemove: (productId: string) => void;
  onCheckout: () => void;
  currency?: string;
  notice?: string | null;
};

export function CartSidebar({ cart, products, cartTotal, onClose, onRemove, onCheckout, currency = 'EUR', notice }: CartSidebarProps) {
  return (
    <>
      <div className="cart-overlay" onClick={onClose} />
      <div className="cart-sidebar anim-cart-sidebar">
        <div className="cart-header">
          <h3>Tu Carrito</h3>
          <button className="close-btn" onClick={onClose} aria-label="Cerrar carrito">✕</button>
        </div>
        <div className="cart-items">
          {notice && (
            <p className="cart-notice" role="status">{notice}</p>
          )}
          {cart.length === 0 ? (
            <>
              <p className="empty-cart">Tu carrito está vacío</p>
              <button className="btn btn-secondary" style={{ width: '100%', marginTop: '0.75rem' }} onClick={onClose}>
                Seguir comprando
              </button>
            </>
          ) : (
            <>
              {cart.map(item => {
                const product = products.find(p => p.id === item.id);
                return product ? (
                  <div key={item.id} className="cart-item">
                    <div className="cart-item-info">
                      <p className="cart-item-name">{product.name}</p>
                      <p className="cart-item-price">
                        {formatPrice(product.price_cents, currency)} x {item.quantity}
                      </p>
                    </div>
                    <button className="btn-remove" onClick={() => onRemove(item.id)} aria-label={`Eliminar ${product.name} del carrito`}>
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
              <strong>{formatPrice(cartTotal, currency)}</strong>
            </div>
            <button className="btn btn-primary btn-glow" style={{ width: '100%', marginTop: '1rem' }} onClick={onCheckout}>
              💳 Proceder al Pago
            </button>
            <p className="cart-shipping-note">🚚 Envío 24-48h · ↩️ Devolución 30 días</p>
          </div>
        )}
      </div>
    </>
  );
}
