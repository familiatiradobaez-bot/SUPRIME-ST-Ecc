import { useState, useCallback } from 'react';
import { CURRENCIES } from '../lib/api';

const CURRENCY_STORAGE_KEY = 'suprime_currency';

function loadCurrency(): string {
  try {
    const saved = localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (saved && CURRENCIES[saved]) return saved;
  } catch {
    // Ignore storage errors
  }
  return 'EUR';
}

export function useCurrency() {
  const [currency, setCurrencyState] = useState<string>(loadCurrency);

  const setCurrency = useCallback((code: string) => {
    if (!CURRENCIES[code]) return;
    setCurrencyState(code);
    try {
      localStorage.setItem(CURRENCY_STORAGE_KEY, code);
    } catch {
      // Ignore storage errors
    }
  }, []);

  return { currency, setCurrency };
}
