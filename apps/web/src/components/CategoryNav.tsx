import { useState, useEffect } from 'react';

type Category = {
  id: string;
  name: string;
  slug: string;
  description: string;
  image_url: string;
  department_name: string;
  department_slug: string;
};

type CategoryNavProps = {
  onCategorySelect?: (categorySlug: string) => void;
};

// Sanitize HTML to prevent XSS
function sanitizeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function CategoryNav({ onCategorySelect }: CategoryNavProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const config = (window as any).__APP_CONFIG__;
    const apiUrl = config?.API_URL || `${window.location.protocol}//${window.location.hostname}:8789/api/v1`;

    fetch(`${apiUrl}/catalog/categories`)
      .then(r => r.json())
      .then(data => {
        if (data.data) setCategories(data.data);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="category-nav">
      <button
        className="category-nav-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="Abrir menú de categorías"
      >
        📂 Categorías
      </button>

      {isOpen && (
        <div className="category-nav-dropdown anim-dropdown-in" role="menu" aria-label="Lista de categorías">
          {categories.map(category => (
            <button
              key={category.id}
              className="category-nav-item"
              onClick={() => {
                onCategorySelect?.(category.slug);
                setIsOpen(false);
              }}
              role="menuitem"
              aria-label={`${sanitizeHtml(category.name)} - ${sanitizeHtml(category.department_name)}`}
            >
              <span className="category-nav-icon" aria-hidden="true">📁</span>
              <span className="category-nav-name">{sanitizeHtml(category.name)}</span>
              <span className="category-nav-dept">{sanitizeHtml(category.department_name)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
