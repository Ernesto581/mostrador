import { useEffect, useState } from 'react';
import { api, guardarToken, leerToken } from './api/cliente';
import type { Sesion } from './api/tipos';
import { Acceso } from './pantallas/Acceso';
import { Marco } from './pantallas/Marco';
import { ProveedorConexion } from './servicios/conexion';

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
          setSesion(datos);
        }
      })
      .catch(() => {
        guardarToken(null);
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
          guardarToken(null);
          setSesion(null);
        }}
      />
    </ProveedorConexion>
  );
}
