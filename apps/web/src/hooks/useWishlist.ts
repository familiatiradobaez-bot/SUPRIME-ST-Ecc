import { useState, useCallback, useEffect, useRef } from 'react';

const LEGACY_KEY = 'suprime_wishlist';
const keyFor = (owner: string) => `suprime_wishlist_${owner}`;

function readKey(key: string): string[] {
  try {
    const saved = localStorage.getItem(key);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

// Favoritos ligados a la cuenta: cada usuario (y el invitado) tiene su lista.
// Al entrar/salir se guarda la actual y se carga la del nuevo titular.
export function useWishlist(owner: string) {
  const [wishlist, setWishlist] = useState<string[]>(() => {
    const own = readKey(keyFor(owner));
    if (own.length > 0) return own;
    // Migración una vez: adoptar la lista global antigua si existe
    const legacy = readKey(LEGACY_KEY);
    if (legacy.length > 0) {
      try {
        localStorage.setItem(keyFor(owner), JSON.stringify(legacy));
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        // Ignore storage errors
      }
      return legacy;
    }
    return [];
  });
  const keyRef = useRef(keyFor(owner));

  useEffect(() => {
    try {
      localStorage.setItem(keyRef.current, JSON.stringify(wishlist));
    } catch {
      // Ignore storage errors
    }
  }, [wishlist]);

  useEffect(() => {
    const next = keyFor(owner);
    if (keyRef.current === next) return;
    try {
      localStorage.setItem(keyRef.current, JSON.stringify(wishlist));
    } catch {
      // Ignore storage errors
    }
    keyRef.current = next;
    setWishlist(readKey(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  const toggleWishlist = useCallback((productId: string) => {
    setWishlist(prev => prev.includes(productId) ? prev.filter(id => id !== productId) : [...prev, productId]);
  }, []);

  const isWished = useCallback((productId: string) => wishlist.includes(productId), [wishlist]);

  return { wishlist, toggleWishlist, isWished };
}
