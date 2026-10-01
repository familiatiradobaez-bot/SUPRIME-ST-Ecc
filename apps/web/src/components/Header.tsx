import { useState } from 'react';
import type { User, Product } from '../types';
import { formatPrice } from '../lib/api';
import { img } from '../lib/images';
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
        {/* h2, no h1: este Header se repite en TODAS las paginas, asi que si fuera
            h1 cada pagina tendria dos. El h1 de verdad lo pone la pagina
            (HomePage, ProductPage, LegalPage), y "SUPRIME" es la marca, no el
            titulo del contenido. */}
        <h2
          className="logo"
          onClick={onLogoClick}
          style={onLogoClick ? { cursor: 'pointer' } : undefined}
          role={onLogoClick ? 'link' : undefined}
          tabIndex={onLogoClick ? 0 : undefined}
          aria-label="Ir a la portada de SUPRIME"
          onKeyDown={onLogoClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLogoClick(); } } : undefined}
        ><img className="logo-mark" src="/rayo-128.png" alt="" width={32} height={41} />
          <span className="logo-word">SUPRIME</span></h2>
        <div className="search-bar">
          <input
            type="search"
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
            enterKeyHint="search"
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
                  <img src={img(p.image_url, { w: 100 })} alt="" loading="lazy" decoding="async" width="100" height="100" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  <span className="search-suggest-name">{p.name}</span>
                  <span className="search-suggest-price">{formatPrice(p.price_cents, currency)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="header-right">
          <button className="btn btn-primary btn-sm btn-glow" onClick={onCartClick} data-testid="open-cart" aria-label="Abrir carrito">
            🛒 (<span data-testid="cart-count">{cartCount}</span>)
          </button>
          <button className="btn btn-secondary btn-sm header-wishlist-btn" onClick={onWishlistClick} aria-label="Ver favoritos">
            ❤️ ({wishlistCount ?? 0})
          </button>
          {user ? (
            <>
              <button className="btn btn-secondary btn-sm" onClick={onUserPanelClick} aria-label="Mi cuenta">
                👤 <span className="header-username">{user.display_name || user.username}</span>
              </button>
              {isAdmin && (
                <button className="admin-btn header-admin-btn" onClick={onAdminClick}>
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
        <nav className="mobile-menu" aria-label="Menú móvil">
          <a href="#products" onClick={() => { onNavClick('products'); onCloseMenu(); }}>Tienda</a>
          <div className="mobile-menu-cats">
            <CategoryNav onCategorySelect={(slug) => { onCloseMenu(); onCategorySelect?.(slug); }} />
          </div>
          <a href="#about" onClick={() => { onNavClick('about'); onCloseMenu(); }}>Sobre Nosotros</a>
          <a href="#contact" onClick={() => { onNavClick('contact'); onCloseMenu(); }}>Contacto</a>
          <button className="mobile-menu-link" onClick={() => { onCloseMenu(); onWishlistClick?.(); }}>
            ❤️ Favoritos ({wishlistCount ?? 0})
          </button>
          {isAdmin && (
            <button className="mobile-menu-link" onClick={() => { onCloseMenu(); onAdminClick?.(); }}>
              ⚙️ Panel Admin
            </button>
          )}
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
