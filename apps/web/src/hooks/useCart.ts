import { useState, useCallback, useRef, useEffect } from 'react';
import type { CartItem, Product } from '../types';

const LEGACY_CART_KEY = 'su_prime_cart';
const cartKeyFor = (owner: string) => `su_prime_cart_${owner}`;

function loadCartFromStorage(key: string): CartItem[] {
  try {
    const saved = localStorage.getItem(key);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCartToStorage(key: string, cart: CartItem[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(cart));
  } catch {
    // Ignore storage errors
  }
}

// Carrito ligado a la cuenta: cada usuario (y el invitado) tiene el suyo.
// Al iniciar sesión se fusiona el carrito de invitado en el de la cuenta.
export function useCart(products: Product[], owner: string) {
  const [cart, setCart] = useState<CartItem[]>(() => {
    const own = loadCartFromStorage(cartKeyFor(owner));
    if (own.length > 0) return own;
    // Migración una vez: adoptar el carrito global antiguo si existe
    try {
      const legacy = loadCartFromStorage(LEGACY_CART_KEY);
      if (legacy.length > 0) {
        saveCartToStorage(cartKeyFor(owner), legacy);
        localStorage.removeItem(LEGACY_CART_KEY);
        return legacy;
      }
    } catch {
      // Ignore storage errors
    }
    return [];
  });
  const keyRef = useRef(cartKeyFor(owner));
  const [addedToCartId, setAddedToCartId] = useState<string | null>(null);
  const addedToCartTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist cart to localStorage (bajo la clave del titular actual)
  useEffect(() => {
    saveCartToStorage(keyRef.current, cart);
  }, [cart]);

  // Cambio de titular (login/logout/otra cuenta): guardar actual, cargar el suyo.
  // Invitado -> cuenta: fusionar (suma cantidades, tope 99; el filtro de
  // archivados ya existente limpia lo que no exista).
  useEffect(() => {
    const next = cartKeyFor(owner);
    if (keyRef.current === next) return;
    const prevKey = keyRef.current;
    keyRef.current = next;
    setCart((current) => {
      saveCartToStorage(prevKey, current);
      const mine = loadCartFromStorage(next);
      if (prevKey === cartKeyFor('guest') && owner !== 'guest' && current.length > 0) {
        const merged = [...mine];
        for (const item of current) {
          const found = merged.find((m) => m.id === item.id);
          if (found) found.quantity = Math.min(99, found.quantity + item.quantity);
          else merged.push({ ...item, quantity: Math.min(99, item.quantity) });
        }
        saveCartToStorage(next, merged);
        saveCartToStorage(prevKey, []);
        return merged;
      }
      return mine;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

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
