import { useEffect, useState } from 'react';
import { api, ErrorApi, guardarToken, leerToken } from './api/cliente';
import type { Sesion } from './api/tipos';
import { Acceso } from './pantallas/Acceso';
import { Marco } from './pantallas/Marco';
import { ProveedorConexion } from './servicios/conexion';
import { borrarSesion, guardarSesion, leerSesion } from './servicios/sesionLocal';

export function App() {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let activo = true;

    if (!leerToken()) {
      setCargando(false);
      return;
    }

    api
      .sesion()
      .then((datos) => {
        if (activo) {
          guardarSesion(datos);
          setSesion(datos);
        }
      })
      .catch((fallo) => {
        // Sin internet se entra con la sesion guardada: el mostrador sigue funcionando.
        if (fallo instanceof ErrorApi && fallo.codigo === 'SIN_CONEXION') {
          const guardada = leerSesion();
          if (guardada && activo) {
            setSesion(guardada);
            return;
          }
        }

        // El servidor rechazo la sesion (vencida o revocada): hay que entrar de nuevo.
        guardarToken(null);
        borrarSesion();
      })
      .finally(() => {
        if (activo) {
          setCargando(false);
        }
      });

    return () => {
      activo = false;
    };
  }, []);

  if (cargando) {
    return (
      <div className="cargando">
        <div className="cargando__rueda" />
        <p className="cargando__texto">Preparando el mostrador</p>
      </div>
    );
  }

  if (!sesion) {
    return <Acceso onEntrar={setSesion} />;
  }

  return (
    <ProveedorConexion>
      <Marco
        sesion={sesion}
        onSalir={() => {
          // Cerrar el mostrador NO borra la sesion del telefono: si no hay internet
          // despues, hay que poder volver a entrar. La sesion se limpia sola cuando
          // el servidor la rechaza (por ejemplo, al vencer).
          setSesion(null);
        }}
      />
    </ProveedorConexion>
  );
}
