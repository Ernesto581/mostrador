import { useEffect, useRef } from 'react';
import type { MetodoPago } from '../api/tipos';
import type { PagoLocal } from '../tipos';
import { aCentavos, cifra, dinero } from '../util/dinero';

const ETIQUETAS: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
};

const METODOS: MetodoPago[] = ['efectivo', 'tarjeta', 'transferencia'];
const DENOMINACIONES = [50_00, 100_00, 200_00, 500_00];

interface Props {
  total: number;
  pagos: PagoLocal[];
  procesando: boolean;
  puedeCobrar: boolean;
  onAgregarPago: (metodo: MetodoPago) => void;
  onCambiarMonto: (indice: number, monto: string) => void;
  onQuitarPago: (indice: number) => void;
  onFijarEfectivo: (centavos: number) => void;
  onCobrar: () => void;
}

/** Cobro: simple o mixto, con el cambio calculado al instante. */
export function PanelCobro({
  total,
  pagos,
  procesando,
  puedeCobrar,
  onAgregarPago,
  onCambiarMonto,
  onQuitarPago,
  onFijarEfectivo,
  onCobrar,
}: Props) {
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const alPresionar = (evento: KeyboardEvent): void => {
      if (evento.key === 'F4') {
        evento.preventDefault();
        entrada.current?.focus();
        entrada.current?.select();
      }
    };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, []);

  const pagado = pagos.reduce((suma, pago) => suma + aCentavos(pago.monto), 0);
  const falta = Math.max(0, total - pagado);
  const cambio = Math.max(0, pagado - total);

  const noEfectivo = pagos
    .filter((pago) => pago.metodo !== 'efectivo')
    .reduce((suma, pago) => suma + aCentavos(pago.monto), 0);
  const cambioPosible = noEfectivo <= total;

  const puedeCobrarAhora = puedeCobrar && total > 0 && pagado >= total && cambioPosible && !procesando;

  return (
    <div className="cobro">
      <p className="cobro__titulo">Forma de cobro</p>

      <div className="metodos">
        {METODOS.map((metodo) => (
          <button
            key={metodo}
            type="button"
            className="metodo"
            onClick={() => onAgregarPago(metodo)}
            disabled={total <= 0}
          >
            {ETIQUETAS[metodo]}
          </button>
        ))}
      </div>

      {pagos.map((pago, indice) => (
        <div className="pago" key={`${pago.metodo}-${indice}`}>
          <span className="pago__etiqueta">{ETIQUETAS[pago.metodo]}</span>
          <input
            ref={indice === 0 ? entrada : undefined}
            className="pago__entrada"
            inputMode="decimal"
            value={pago.monto}
            onChange={(evento) => onCambiarMonto(indice, evento.target.value)}
            placeholder="0.00"
            aria-label={`Monto en ${ETIQUETAS[pago.metodo]}`}
          />
          <button
            type="button"
            className="quitar"
            onClick={() => onQuitarPago(indice)}
            aria-label={`Quitar pago en ${ETIQUETAS[pago.metodo]}`}
          >
            ×
          </button>
        </div>
      ))}

      {pagos.length > 0 ? (
        <div className="rapidos">
          <button type="button" className="rapido" onClick={() => onFijarEfectivo(total)}>
            Exacto
          </button>
          <button
            type="button"
            className="rapido"
            onClick={() => onFijarEfectivo(pagado + falta)}
            disabled={falta <= 0}
          >
            Cubrir faltante
          </button>
          {DENOMINACIONES.map((denominacion) => (
            <button
              key={denominacion}
              type="button"
              className="rapido"
              onClick={() => onFijarEfectivo(denominacion)}
            >
              ${denominacion / 100}
            </button>
          ))}
        </div>
      ) : null}

      <div className="resumen-cobro">
        <div className="resumen-cobro__fila">
          <span>Total</span>
          <span>{dinero(total)}</span>
        </div>
        <div className="resumen-cobro__fila">
          <span>Recibido</span>
          <span>{dinero(pagado)}</span>
        </div>
      </div>

      {!cambioPosible ? (
        <p className="cobro__ayuda" style={{ color: '#7d2019' }}>
          El cambio solo se entrega en efectivo: baja el pago con tarjeta o transferencia.
        </p>
      ) : null}

      <div className={falta > 0 ? 'cambio cambio--falta' : 'cambio'}>
        <span className="cambio__etiqueta">{falta > 0 ? 'Falta' : 'Cambio'}</span>
        <span className="cambio__valor">{cifra(falta > 0 ? falta : cambio)}</span>
      </div>

      <button type="button" className="cobrar" onClick={onCobrar} disabled={!puedeCobrarAhora}>
        {procesando ? 'Cobrando...' : 'Cobrar'}
      </button>

      <p className="cobro__ayuda">F4 cobra rapido · Enter confirma · Esc limpia</p>
    </div>
  );
}
