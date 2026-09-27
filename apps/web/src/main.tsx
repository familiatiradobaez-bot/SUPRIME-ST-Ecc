import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './styles/animations.css';
import './styles/category-nav.css';
import './styles/admin.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);