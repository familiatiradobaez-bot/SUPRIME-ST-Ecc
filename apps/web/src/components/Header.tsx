import { useState } from 'react';
import type { User, Product } from '../types';
import { formatPrice, thumb } from '../lib/api';
import { CategoryNav } from './CategoryNav';

type HeaderProps = {
  user: User | null;
  cartCount: number;
  searchTerm: string;
  suggestions: Product[];
  currency: string;
  onSelectProduct: (product: Product) => void;
  onSearch: (term: string) => void;
  onCartClick: () => void;
  onMenuClick: () => void;
  onLoginClick: () => void;
  onUserPanelClick: () => void;
  onAdminClick?: () => void;
  isAdmin?: boolean;
  showMenu: boolean;
  onCloseMenu: () => void;
  onNavClick: (section: string) => void;
  onCategorySelect?: (categorySlug: string) => void;
  onLogoClick?: () => void;
  onWishlistClick?: () => void;
  wishlistCount?: number;
};

export function Header({ user, cartCount, searchTerm, suggestions, currency, onSelectProduct, onSearch, onCartClick, onMenuClick, onLoginClick, onUserPanelClick, onAdminClick, isAdmin, showMenu, onCloseMenu, onNavClick, onCategorySelect, onLogoClick, onWishlistClick, wishlistCount }: HeaderProps) {
  const [suggestOpen, setSuggestOpen] = useState(false);
  const trimmed = searchTerm.trim().toLowerCase();
  const matches = trimmed.length >= 2
    ? suggestions.filter(p =>
        p.name.toLowerCase().includes(trimmed) ||
        p.description.toLowerCase().includes(trimmed)
      ).slice(0, 6)
    : [];

  return (
    <header className="header">
      <div className="header-content">
        <h1
          className="logo"
          onClick={onLogoClick}
          style={onLogoClick ? { cursor: 'pointer' } : undefined}
          role={onLogoClick ? 'link' : undefined}
          tabIndex={onLogoClick ? 0 : undefined}
          aria-label="Ir a la portada de SUPRIME"
          onKeyDown={onLogoClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLogoClick(); } } : undefined}
        >✨ SUPRIME</h1>
        <div className="search-bar">
          <input
            type="text"
            placeholder="Buscar..."
            value={searchTerm}
            onChange={(e) => { onSearch(e.target.value); setSuggestOpen(true); }}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
            onKeyDown={(e) => { if (e.key === 'Escape') setSuggestOpen(false); }}
            className="search-input"
            role="combobox"
            aria-expanded={suggestOpen && matches.length > 0}
            aria-label="Buscar productos"
            autoComplete="off"
          />
          {suggestOpen && matches.length > 0 && (
            <div className="search-suggest" role="listbox" aria-label="Sugerencias">
              {matches.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className="search-suggest-item"
                  onMouseDown={(e) => { e.preventDefault(); setSuggestOpen(false); onSelectProduct(p); }}
                >
                  <img src={thumb(p.image_url, 100)} alt="" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  <span className="search-suggest-name">{p.name}</span>
                  <span className="search-suggest-price">{formatPrice(p.price_cents, currency)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="header-right">
          <button className="btn btn-primary btn-sm btn-glow" onClick={onCartClick}>
            🛒 ({cartCount})
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onWishlistClick} aria-label="Ver favoritos">
            ❤️ ({wishlistCount ?? 0})
          </button>
          {user ? (
            <>
              <button className="btn btn-secondary btn-sm" onClick={onUserPanelClick}>
                👤 {user.display_name || user.username}
              </button>
              {isAdmin && (
                <button className="admin-btn" onClick={onAdminClick}>
                  ⚙️ Admin
                </button>
              )}
            </>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={onLoginClick}>
              👤 Cuenta
            </button>
          )}
          <button className="menu-toggle" onClick={onMenuClick} aria-label="Menu">
            ☰
          </button>
        </div>
      </div>

      {showMenu && (
        <nav className="mobile-menu">
          <a href="#products" onClick={() => { onNavClick('products'); onCloseMenu(); }}>Tienda</a>
          <a href="#about" onClick={() => { onNavClick('about'); onCloseMenu(); }}>Sobre Nosotros</a>
          <a href="#contact" onClick={() => { onNavClick('contact'); onCloseMenu(); }}>Contacto</a>
          {!user && (
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => { onCloseMenu(); onLoginClick(); }}>
              👤 Cuenta
            </button>
          )}
        </nav>
      )}

      <nav className="pill-nav" aria-label="Navegación principal">
        <a href="#products" className="pill-nav-item active" onClick={(e) => { e.preventDefault(); onNavClick('products'); }} aria-current="page">
          <span className="pill-icon" aria-hidden="true">🛍️</span>
          <span>Tienda</span>
        </a>
        <CategoryNav onCategorySelect={onCategorySelect} />
        <a href="#about" className="pill-nav-item" onClick={(e) => { e.preventDefault(); onNavClick('about'); }}>
          <span className="pill-icon" aria-hidden="true">ℹ️</span>
          <span>Nosotros</span>
        </a>
        <a href="#contact" className="pill-nav-item" onClick={(e) => { e.preventDefault(); onNavClick('contact'); }}>
          <span className="pill-icon" aria-hidden="true">📞</span>
          <span>Contacto</span>
        </a>
      </nav>
    </header>
  );
}
