import { useEffect } from 'react';

const BASE_TITLE = 'SUPRIME - Tienda Premium';
const BASE_DESC = 'SUPRIME: productos premium con envío en 24-48h. Calidad, estilo y excelencia en cada compra.';

function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  let el = document.head.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

export function useDocumentTitle(title?: string, description?: string) {
  useEffect(() => {
    document.title = title ? `${title} | SUPRIME` : BASE_TITLE;
    setMeta('description', description || BASE_DESC);
    setMeta('og:title', title ? `${title} | SUPRIME` : BASE_TITLE, 'property');
    setMeta('og:description', description || BASE_DESC, 'property');
    return () => {
      document.title = BASE_TITLE;
      setMeta('description', BASE_DESC);
    };
  }, [title, description]);
}
