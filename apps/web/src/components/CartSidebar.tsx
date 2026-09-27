import type { CartItem, Product } from '../types';
import { formatPrice } from '../lib/api';

type CartSidebarProps = {
  cart: CartItem[];
  products: Product[];
  cartTotal: number;
  onClose: () => void;
  onRemove: (productId: string) => void;
  onCheckout: () => void;
};

export function CartSidebar({ cart, products, cartTotal, onClose, onRemove, onCheckout }: CartSidebarProps) {
  return (
    <>
      <div className="cart-overlay" onClick={onClose} />
      <div className="cart-sidebar">
        <div className="cart-header">
          <h3>Tu Carrito</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
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
                        {formatPrice(product.price_cents)} x {item.quantity}
                      </p>
                    </div>
                    <button className="btn-remove" onClick={() => onRemove(item.id)}>
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
              <strong>{formatPrice(cartTotal)}</strong>
            </div>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} onClick={onCheckout}>
              💳 Proceder al Pago
            </button>
          </div>
        )}
      </div>
    </>
  );
}
