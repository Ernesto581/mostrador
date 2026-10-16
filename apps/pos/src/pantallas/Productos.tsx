import { useState } from 'react';
import { api } from '../api/cliente';
import type { Producto, Sesion } from '../api/tipos';
import { Aviso, Modal, mensajeDe, useCarga } from '../util/pantalla';
import { aCentavos, aTextoCaptura, dinero } from '../util/dinero';

interface Props {
  sesion: Sesion;
  sucursalId: string;
}

interface Borrador {
  id: string | null;
  sku: string;
  nombre: string;
  categoriaId: string;
  precioCosto: string;
  precioVenta: string;
  stockMinimo: string;
  codigos: string;
  stockInicial: string;
}

const BORRADOR_VACIO: Borrador = {
  id: null,
  sku: '',
  nombre: '',
  categoriaId: '',
  precioCosto: '',
  precioVenta: '',
  stockMinimo: '0',
  codigos: '',
  stockInicial: '0',
};

function borradorDe(producto: Producto): Borrador {
  return {
    id: producto.id,
    sku: producto.sku,
    nombre: producto.nombre,
    categoriaId: producto.categoriaId ?? '',
    precioCosto: aTextoCaptura(producto.precioCosto),
    precioVenta: aTextoCaptura(producto.precioVenta),
    stockMinimo: String(producto.stockMinimo),
    codigos: '',
    stockInicial: '0',
  };
}

export function Productos({ sesion, sucursalId }: Props) {
  const [buscar, setBuscar] = useState('');
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const puedeEditar = sesion.permisos.includes('catalog.manage');

  const { datos, cargando, error: errorLista, recargar } = useCarga(
    () => api.buscarProductos(buscar, sucursalId, 200),
    [buscar, sucursalId],
  );
  const { datos: datosCategorias } = useCarga(() => api.categorias(), []);

  const productos = datos?.productos ?? [];
  const categorias = datosCategorias?.categorias ?? [];

  async function guardar(): Promise<void> {
    if (!borrador) {
      return;
    }

    setGuardando(true);
    setError(null);

    const codigos = borrador.codigos
      .split(',')
      .map((codigo) => codigo.trim())
      .filter(Boolean);
    const inicial = Number(borrador.stockInicial) || 0;

    try {
      if (borrador.id) {
        await api.editarProducto(borrador.id, {
          sku: borrador.sku.trim(),
          nombre: borrador.nombre.trim(),
          ...(borrador.categoriaId ? { categoriaId: borrador.categoriaId } : {}),
          precioCosto: aCentavos(borrador.precioCosto),
          precioVenta: aCentavos(borrador.precioVenta),
          stockMinimo: Number(borrador.stockMinimo) || 0,
        });

        for (const codigo of codigos) {
          await api.agregarCodigo(borrador.id, codigo);
        }
        setOk('Producto actualizado.');
      } else {
        await api.crearProducto({
          sku: borrador.sku.trim(),
          nombre: borrador.nombre.trim(),
          ...(borrador.categoriaId ? { categoriaId: borrador.categoriaId } : {}),
          precioCosto: aCentavos(borrador.precioCosto),
          precioVenta: aCentavos(borrador.precioVenta),
          stockMinimo: Number(borrador.stockMinimo) || 0,
          codigosBarras: codigos,
          stockInicial: inicial,
          ...(inicial > 0 ? { sucursalId } : {}),
        });
        setOk('Producto creado.');
      }

      setBorrador(null);
      await recargar();
      window.setTimeout(() => setOk(null), 4000);
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  function claseStock(producto: Producto): string {
    const stock = producto.stock ?? 0;
    if (stock <= 0) {
      return 'insignia insignia--agotado';
    }
    if (stock <= producto.stockMinimo) {
      return 'insignia insignia--baja';
    }
    return 'insignia insignia--ok';
  }

  return (
    <div className="panel">
      <div className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">Productos</h1>
          <p className="panel__nota">
            {productos.length} productos · precios en pesos · el costo es lo que pagas al proveedor
          </p>
        </div>

        {puedeEditar ? (
          <button type="button" className="boton boton--acento" onClick={() => setBorrador({ ...BORRADOR_VACIO })}>
            Nuevo producto
          </button>
        ) : null}
      </div>

      <div className="barra-filtros">
        <input
          className="entrada"
          style={{ maxWidth: '22rem' }}
          placeholder="Buscar por nombre, SKU o codigo de barras"
          value={buscar}
          onChange={(evento) => setBuscar(evento.target.value)}
        />
        <span className="panel__nota">Sucursal: {sesion.sucursales.find((s) => s.id === sucursalId)?.codigo ?? '—'}</span>
      </div>

      <Aviso error={error ?? errorLista} ok={ok} />

      {cargando ? <p className="panel__nota">Cargando…</p> : null}

      {!cargando && productos.length === 0 ? (
        <div className="tarjeta">
          <p className="vacio">
            No hay productos que coincidan.
            <br />
            Usa <strong>Nuevo producto</strong> para dar de alta el primero.
          </p>
        </div>
      ) : null}

      {productos.length > 0 ? (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Producto</th>
                <th className="numero">Costo</th>
                <th className="numero">Venta</th>
                <th className="numero">Stock</th>
                <th className="numero">Minimo</th>
                <th />
                {puedeEditar ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {productos.map((producto) => (
                <tr key={producto.id}>
                  <td className="codigo">{producto.sku}</td>
                  <td>{producto.nombre}</td>
                  <td className="numero">{dinero(producto.precioCosto)}</td>
                  <td className="numero">{dinero(producto.precioVenta)}</td>
                  <td className="numero">
                    <span className={claseStock(producto)}>{producto.stock ?? 0}</span>
                  </td>
                  <td className="numero">{producto.stockMinimo}</td>
                  <td>
                    {producto.esServicio ? <span className="insignia">Servicio</span> : null}
                  </td>
                  {puedeEditar ? (
                    <td>
                      <button
                        type="button"
                        className="boton"
                        onClick={() => setBorrador(borradorDe(producto))}
                      >
                        Editar
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {borrador ? (
        <Modal
          titulo={borrador.id ? 'Editar producto' : 'Nuevo producto'}
          nota={
            borrador.id
              ? 'Los codigos y el stock inicial solo se capturan al crear. Usa Inventario para mover existencias.'
              : 'Si indicas stock inicial, queda registrado como entrada de inventario (queda en el kardex).'
          }
          onCerrar={() => setBorrador(null)}
        >
          <div className="formulario">
            <label className="campo-ancho">
              <span>SKU</span>
              <input
                className="entrada"
                value={borrador.sku}
                onChange={(evento) => setBorrador({ ...borrador, sku: evento.target.value })}
              />
            </label>

            <label className="campo-ancho campo-ancho--ancho">
              <span>Nombre</span>
              <input
                className="entrada"
                value={borrador.nombre}
                onChange={(evento) => setBorrador({ ...borrador, nombre: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Categoria</span>
              <select
                className="entrada"
                value={borrador.categoriaId}
                onChange={(evento) => setBorrador({ ...borrador, categoriaId: evento.target.value })}
              >
                <option value="">Sin categoria</option>
                {categorias.map((categoria) => (
                  <option key={categoria.id} value={categoria.id}>
                    {categoria.nombre}
                  </option>
                ))}
              </select>
            </label>

            <label className="campo-ancho">
              <span>Precio de costo</span>
              <input
                className="entrada entrada--numero"
                inputMode="decimal"
                value={borrador.precioCosto}
                onChange={(evento) => setBorrador({ ...borrador, precioCosto: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Precio de venta</span>
              <input
                className="entrada entrada--numero"
                inputMode="decimal"
                value={borrador.precioVenta}
                onChange={(evento) => setBorrador({ ...borrador, precioVenta: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Stock minimo</span>
              <input
                className="entrada entrada--numero"
                inputMode="numeric"
                value={borrador.stockMinimo}
                onChange={(evento) => setBorrador({ ...borrador, stockMinimo: evento.target.value })}
              />
            </label>

            <label className="campo-ancho campo-ancho--ancho">
              <span>{borrador.id ? 'Agregar codigos de barras' : 'Codigos de barras'}</span>
              <input
                className="entrada"
                placeholder="7501234567890, 7509876543210"
                value={borrador.codigos}
                onChange={(evento) => setBorrador({ ...borrador, codigos: evento.target.value })}
              />
            </label>

            {!borrador.id ? (
              <label className="campo-ancho">
                <span>Stock inicial</span>
                <input
                  className="entrada entrada--numero"
                  inputMode="numeric"
                  value={borrador.stockInicial}
                  onChange={(evento) => setBorrador({ ...borrador, stockInicial: evento.target.value })}
                />
              </label>
            ) : null}
          </div>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setBorrador(null)}>
              Cancelar
            </button>
            <button type="button" className="boton boton--acento" onClick={() => void guardar()} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

