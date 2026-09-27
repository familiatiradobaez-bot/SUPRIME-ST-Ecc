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
      >
        📂 Categorías
      </button>

      {isOpen && (
        <div className="category-nav-dropdown anim-dropdown-in">
          {categories.map(category => (
            <button
              key={category.id}
              className="category-nav-item"
              onClick={() => {
                onCategorySelect?.(category.slug);
                setIsOpen(false);
              }}
            >
              <span className="category-nav-icon">📁</span>
              <span className="category-nav-name">{category.name}</span>
              <span className="category-nav-dept">{category.department_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
