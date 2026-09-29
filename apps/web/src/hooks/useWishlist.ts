import { useState, useCallback, useEffect } from 'react';

const WISHLIST_STORAGE_KEY = 'suprime_wishlist';

function loadWishlist(): string[] {
  try {
    const saved = localStorage.getItem(WISHLIST_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function useWishlist() {
  const [wishlist, setWishlist] = useState<string[]>(loadWishlist);

  useEffect(() => {
    try {
      localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(wishlist));
    } catch {
      // Ignore storage errors
    }
  }, [wishlist]);

  const toggleWishlist = useCallback((productId: string) => {
    setWishlist(prev => prev.includes(productId) ? prev.filter(id => id !== productId) : [...prev, productId]);
  }, []);

  const isWished = useCallback((productId: string) => wishlist.includes(productId), [wishlist]);

  return { wishlist, toggleWishlist, isWished };
}
