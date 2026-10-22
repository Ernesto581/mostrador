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
import { abrirAlmacen } from './servicios/almacenLocal';
import './estilos/global.css';

const contenedor = document.getElementById('root');
if (!contenedor) {
  throw new Error('Falta el contenedor #root');
}

/* La copia local (catalogo, cola de ventas, folios) se carga antes de pintar la app.
   Si tarda demasiado, la app abre igual: sin modo sin conexion hasta que termine. */
const esperaMaxima = new Promise<void>((resolver) => window.setTimeout(resolver, 3000));

void Promise.race([abrirAlmacen(), esperaMaxima]).finally(() => {
  createRoot(contenedor).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
