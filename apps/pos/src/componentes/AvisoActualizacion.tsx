import { useEffect, useState } from 'react';
import { abrirDescarga, buscarActualizacion, type VersionNueva } from '../servicios/actualizacion';

/**
 * Aviso de version nueva.
 *
 * Sin esto habria que volver a instalar la app a mano. Se instala encima y conserva
 * los datos; Android solo pide confirmar.
 */
export function AvisoActualizacion() {
  const [nueva, setNueva] = useState<VersionNueva | null>(null);
  const [oculto, setOculto] = useState(false);

  useEffect(() => {
    let activo = true;

    void (async () => {
      const encontrada = await buscarActualizacion();
      if (activo) {
        setNueva(encontrada);
      }
    })();

    return () => {
      activo = false;
    };
  }, []);

  if (!nueva || oculto) {
    return null;
  }

  return (
    <div className="actualizacion" role="status">
      <span>
        Hay una version nueva ({nueva.versionName}). Se instala encima y conserva tus datos.
      </span>
      <div className="acciones-fila">
        <button type="button" className="boton boton--acento" onClick={() => void abrirDescarga(nueva.url)}>
          Actualizar
        </button>
        <button type="button" className="boton boton--fantasma" onClick={() => setOculto(true)}>
          Ahora no
        </button>
      </div>
    </div>
  );
}
