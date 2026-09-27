import { useState, useCallback, useRef } from 'react';
import type { CartItem, Product } from '../types';

export function useCart(products: Product[]) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [addedToCartId, setAddedToCartId] = useState<string | null>(null);
  const addedToCartTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAddToCart = useCallback((productId: string) => {
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
  }, [products, cart]);

  const handleRemoveFromCart = useCallback((productId: string) => {
    setCart(prevCart => prevCart.filter(item => item.id !== productId));
  }, []);

  const cartTotal = cart.reduce((sum, item) => {
    const product = products.find(p => p.id === item.id);
    return sum + (product && product.price_cents != null ? product.price_cents * item.quantity : 0);
  }, 0);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return {
    cart,
    addedToCartId,
    cartTotal,
    cartCount,
    handleAddToCart,
    handleRemoveFromCart,
    setCart,
  };
}
