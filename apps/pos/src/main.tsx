import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/* Tipografias servidas desde el propio sistema: sin internet se ven igual. */
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';
import '@fontsource/archivo/800.css';
import '@fontsource/azeret-mono/400.css';
import '@fontsource/azeret-mono/600.css';
import '@fontsource/azeret-mono/700.css';

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
