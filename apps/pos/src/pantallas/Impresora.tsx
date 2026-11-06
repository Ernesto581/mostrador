import { useState } from 'react';
import { Aviso } from '../util/pantalla';
import {
  conectarBluetooth,
  conectarUsb,
  estadoSoporte,
  guardarConfigImpresora,
  leerConfigImpresora,
  probarImpresion,
  type AnchoPapel,
  type ConfigImpresora,
  type ModoImpresion,
} from '../servicios/impresion';

/**
 * Configuracion local de la impresora.
 *
 * Es por equipo, no por usuario: la laptop del local se configura una vez y
 * todos los que cobran alli imprimen igual. No se guarda nada en el servidor.
 */
export function Impresora() {
  const [config, setConfig] = useState<ConfigImpresora>(() => leerConfigImpresora());
  const [conectando, setConectando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const soporte = estadoSoporte();

  function cambiar(parcial: Partial<ConfigImpresora>): void {
    const siguiente = { ...config, ...parcial };
    setConfig(siguiente);
    guardarConfigImpresora(siguiente);
    setError(null);
    setOk(null);
  }

  async function conectar(modo: 'usb' | 'bluetooth'): Promise<void> {
    setConectando(true);
    setError(null);
    setOk(null);
    try {
      if (modo === 'usb') {
        await conectarUsb();
        cambiar({ modo: 'usb' });
        setOk('Impresora USB conectada. Haz una prueba para confirmar.');
      } else {
        await conectarBluetooth();
        cambiar({ modo: 'bluetooth' });
        setOk('Impresora Bluetooth conectada. Haz una prueba para confirmar.');
      }
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo conectar la impresora');
    } finally {
      setConectando(false);
    }
  }

  async function probar(): Promise<void> {
    setConectando(true);
    setError(null);
    setOk(null);
    try {
      await probarImpresion(config);
      setOk('Ticket de prueba enviado.');
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo imprimir la prueba');
    } finally {
      setConectando(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">Impresora</h1>
          <p className="panel__nota">
            Configura como se imprimen los tickets en este equipo. Se guarda solo en este
            navegador.
          </p>
        </div>
      </div>

      <Aviso error={error} ok={ok} />

      <div className="rejilla-tarjetas">
        <article className="tarjeta">
          <p className="tarjeta__titulo">1. Como imprimir</p>
          <div className="campo-ancho" style={{ marginTop: '0.7rem' }}>
            <span>Modo</span>
            <select
              className="entrada"
              value={config.modo}
              onChange={(evento) => cambiar({ modo: evento.target.value as ModoImpresion })}
            >
              <option value="navegador">Navegador (cualquier impresora instalada)</option>
              <option value="usb">USB directo (ESC/POS)</option>
              <option value="bluetooth">Bluetooth (ESC/POS)</option>
            </select>
          </div>

          <div className="campo-ancho" style={{ marginTop: '0.7rem' }}>
            <span>Ancho del papel</span>
            <select
              className="entrada"
              value={String(config.ancho)}
              onChange={(evento) => cambiar({ ancho: Number(evento.target.value) as AnchoPapel })}
            >
              <option value="58">58 mm</option>
              <option value="80">80 mm</option>
            </select>
          </div>

          <div className="campo-ancho" style={{ marginTop: '0.7rem' }}>
            <span>Impresora de este equipo</span>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
              <button
                type="button"
                className="boton"
                onClick={() => void conectar('usb')}
                disabled={!soporte.usb || conectando}
              >
                Conectar USB
              </button>
              <button
                type="button"
                className="boton"
                onClick={() => void conectar('bluetooth')}
                disabled={!soporte.bluetooth || conectando}
              >
                Conectar Bluetooth
              </button>
              <button
                type="button"
                className="boton boton--acento"
                onClick={() => void probar()}
                disabled={conectando}
              >
                {conectando ? 'Enviando…' : 'Imprimir prueba'}
              </button>
            </div>
          </div>
        </article>

        <article className="tarjeta">
          <p className="tarjeta__titulo">Ayuda</p>
          <p className="panel__nota">
            <strong>Navegador:</strong> sirve con cualquier impresora instalada en Windows,
            Mac o Linux, sea USB, Bluetooth o de red. Al imprimir, elige la impresora
            termica en el dialogo del sistema.
          </p>
          <p className="panel__nota">
            <strong>USB y Bluetooth directos:</strong> usan ESC/POS y necesitan Chrome o
            Edge en el equipo. En una pagina HTTPS (como la de Vercel) el navegador pedira
            permiso para usar el dispositivo.
          </p>
          <p className="panel__nota">
            {soporte.usb ? 'USB disponible en este navegador.' : 'USB no disponible.'}{' '}
            {soporte.bluetooth
              ? 'Bluetooth disponible en este navegador.'
              : 'Bluetooth no disponible.'}
          </p>
          <p className="panel__nota">
            Si la impresora no aparece, revisa que este encendida, emparejada en el sistema
            (Bluetooth) o conectada por cable (USB).
          </p>
        </article>
      </div>
    </div>
  );
}
