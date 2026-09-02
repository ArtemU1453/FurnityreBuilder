import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design-system/tokens.css';
import { App } from './app/App.js';

const container = document.getElementById('root');
if (container === null) throw new Error('Не найден корневой элемент приложения.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
