import type { User } from '../types';
import { CategoryNav } from './CategoryNav';

type HeaderProps = {
  user: User | null;
  cartCount: number;
  searchTerm: string;
  onSearch: (term: string) => void;
  onCartClick: () => void;
  onMenuClick: () => void;
  onLoginClick: () => void;
  onUserPanelClick: () => void;
  onAdminClick?: () => void;
  showMenu: boolean;
  onCloseMenu: () => void;
  onNavClick: (section: string) => void;
  onCategorySelect?: (categorySlug: string) => void;
};

export function Header({ user, cartCount, searchTerm, onSearch, onCartClick, onMenuClick, onLoginClick, onUserPanelClick, onAdminClick, showMenu, onCloseMenu, onNavClick, onCategorySelect }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-content">
        <h1 className="logo">✨ SUPRIME</h1>
        <div className="search-bar">
          <input
            type="text"
            placeholder="Buscar..."
            value={searchTerm}
            onChange={(e) => onSearch(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="header-right">
          <button className="btn btn-primary btn-sm" onClick={onCartClick}>
            🛒 ({cartCount})
          </button>
          {user ? (
            <>
              <button className="btn btn-secondary btn-sm" onClick={onUserPanelClick}>
                👤 {user.display_name || user.username}
              </button>
              {['role-admin', 'role-owner', 'role-stock-manager'].includes(user.role_id) && (
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

      <nav className="nav">
        <a href="#products" onClick={(e) => { e.preventDefault(); onNavClick('products'); }}>Tienda</a>
        <CategoryNav onCategorySelect={onCategorySelect} />
        <a href="#about" onClick={(e) => { e.preventDefault(); onNavClick('about'); }}>Sobre Nosotros</a>
        <a href="#contact" onClick={(e) => { e.preventDefault(); onNavClick('contact'); }}>Contacto</a>
      </nav>
    </header>
  );
}
