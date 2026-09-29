import { useState, useCallback, useRef, useEffect } from 'react';
import type { CartItem, Product } from '../types';

const CART_STORAGE_KEY = 'su_prime_cart';

function loadCartFromStorage(): CartItem[] {
  try {
    const saved = localStorage.getItem(CART_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export function useCart(products: Product[]) {
  const [cart, setCart] = useState<CartItem[]>(loadCartFromStorage);
  const [addedToCartId, setAddedToCartId] = useState<string | null>(null);
  const addedToCartTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist cart to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // Ignore storage errors
    }
  }, [cart]);

  // Depurar archivados: si el catálogo ya cargó, quitar del carrito lo que
  // ya no existe (evita total incoherente y error tardío en checkout)
  const [removedNotice, setRemovedNotice] = useState(0);
  useEffect(() => {
    if (products.length === 0) return;
    setCart(prevCart => {
      const valid = prevCart.filter(item => products.some(p => p.id === item.id));
      if (valid.length !== prevCart.length) {
        setRemovedNotice(prevCart.length - valid.length);
        return valid;
      }
      return prevCart;
    });
  }, [products]);

  const handleAddToCart = useCallback((productId: string, qty: number = 1) => {
    const product = products.find(p => p.id === productId);
    if (!product || product.stock_quantity === 0) return;
    const quantity = Math.max(1, Math.min(99, Math.floor(qty)));

    const cartItem = cart.find(item => item.id === productId);
    const currentQuantity = cartItem?.quantity ?? 0;
    if (currentQuantity >= product.stock_quantity) {
      alert(`Solo hay ${product.stock_quantity} unidades disponibles`);
      return;
    }
    const allowed = Math.min(quantity, product.stock_quantity - currentQuantity);
    if (allowed <= 0) {
      alert(`Solo hay ${product.stock_quantity} unidades disponibles`);
      return;
    }

    setCart(prevCart => {
      const existing = prevCart.find(item => item.id === productId);
      if (existing) {
        return prevCart.map(item =>
          item.id === productId ? { ...item, quantity: item.quantity + allowed } : item
        );
      }
      return [...prevCart, { id: productId, quantity: allowed }];
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
    removedNotice,
    clearRemovedNotice: () => setRemovedNotice(0),
    handleAddToCart,
    handleRemoveFromCart,
    setCart,
  };
}
