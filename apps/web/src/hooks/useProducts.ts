import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Product } from '../types';
import { useApiUrl } from './useApiUrl';

const PRODUCTS_PER_PAGE = 12;

export function useProducts() {
  const apiUrl = useApiUrl();
  const [products, setProducts] = useState<Product[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const maxRetries = 3;
    let retryCount = 0;

    const fetchProducts = async () => {
      try {
        const response = await fetch(`${apiUrl}/catalog/products`);
        if (!response.ok) throw new Error('Catalog request failed');
        const payload = await response.json() as { data: Product[] };
        if (!cancelled) {
          setProducts(payload.data);
          setFilteredProducts(payload.data);
          setStatus('ready');
        }
      } catch (err) {
        if (!cancelled) {
          retryCount++;
          if (retryCount < maxRetries) {
            setTimeout(fetchProducts, 1000 * retryCount);
          } else {
            setStatus('error');
          }
        }
      }
    };

    fetchProducts();
    return () => { cancelled = true; };
  }, [apiUrl]);

  const handleSearch = useCallback((term: string) => {
    setSearchTerm(term);
    setCurrentPage(1);
    const filtered = products.filter(p =>
      p.name.toLowerCase().includes(term.toLowerCase()) ||
      p.description.toLowerCase().includes(term.toLowerCase())
    );
    setFilteredProducts(filtered);
  }, [products]);

  // Pagination
  const totalPages = Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE);
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * PRODUCTS_PER_PAGE;
    return filteredProducts.slice(start, start + PRODUCTS_PER_PAGE);
  }, [filteredProducts, currentPage]);

  const goToPage = useCallback((page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  }, [totalPages]);

  return {
    products,
    status,
    searchTerm,
    filteredProducts,
    paginatedProducts,
    currentPage,
    totalPages,
    setProducts,
    handleSearch,
    goToPage,
  };
}
