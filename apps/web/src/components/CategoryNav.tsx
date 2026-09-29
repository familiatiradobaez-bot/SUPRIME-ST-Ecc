import { useState, useEffect } from 'react';
import { useApiUrl } from '../hooks/useApiUrl';

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

export function CategoryNav({ onCategorySelect }: CategoryNavProps) {
  const apiUrl = useApiUrl();
  const [categories, setCategories] = useState<Category[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    fetch(`${apiUrl}/catalog/categories`)
      .then(r => r.json())
      .then(data => {
        if (data.data) setCategories(data.data);
      })
      .catch(() => {});
  }, [apiUrl]);

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
              aria-label={`${category.name} - ${category.department_name}`}
            >
              <span className="category-nav-icon" aria-hidden="true">📁</span>
              <span className="category-nav-name">{category.name}</span>
              <span className="category-nav-dept">{category.department_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
