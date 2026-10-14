import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './estilos/global.css';

const contenedor = document.getElementById('root');
if (!contenedor) {
  throw new Error('Falta el contenedor #root');
}

createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
