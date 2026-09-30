import { StrictMode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './styles/animations.css';
import './styles/category-nav.css';
// `admin.css` NO se importa aquí a propósito: vive en `pages/AdminPage.tsx` para
// que Vite lo meta en el chunk del panel, que se descarga al abrirlo. En el
// bundle inicial eran 16,7 KB que ningún visitante de la tienda iba a usar.

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
);