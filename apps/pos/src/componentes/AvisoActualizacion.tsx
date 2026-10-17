import { abrirDescarga, type VersionNueva } from '../servicios/actualizacion';

interface Props {
  version: VersionNueva;
  onDescartar: () => void;
}

/**
 * Aviso de version nueva.
 *
 * Sin esto habria que volver a instalar la app a mano. Se instala encima de la
 * anterior y conserva los datos; Android solo pide confirmar.
 */
export function AvisoActualizacion({ version, onDescartar }: Props) {
  return (
    <div className="actualizacion" role="status">
      <span>
        Hay una version nueva ({version.versionName}). Se instala encima y conserva tus datos.
      </span>
      <div className="acciones-fila">
        <button
          type="button"
          className="boton boton--acento"
          onClick={() => void abrirDescarga(version.url)}
        >
          Actualizar
        </button>
        <button type="button" className="boton boton--fantasma" onClick={onDescartar}>
          Ahora no
        </button>
      </div>
    </div>
  );
}
