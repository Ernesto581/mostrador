import { useEffect, useState } from 'react';
import { api } from '../api/cliente';
import type { Categoria, Movimiento, RepartoSucursal, Sesion, TipoMovimiento } from '../api/tipos';
import { MenuAcciones } from '../componentes/MenuAcciones';
import { Aviso, Modal, mensajeDe, useCarga } from '../util/pantalla';
import { aCentavos, aTextoCaptura, dinero, fechaLarga } from '../util/dinero';

/**
 * Inventario general.
 *
 * Es la unica pantalla de mercancia: aqui se dan de alta los productos (con sus
 * categorias y codigos de barras) y aqui se ven las existencias, se registran entradas,
 * mermas y ajustes, se transfiere entre sucursales y se consulta el kardex.
 */

interface Props {
  sesion: Sesion;
  sucursalId: string;
  busquedaExterna?: string;
  alCambiarBusqueda?: (texto: string) => void;
}

/** Fila tal como se pinta: sirve tanto para la vista general como para una sucursal. */
interface FilaVista {
  productoId: string;
  sku: string;
  nombre: string;
  imagenUrl: string | null;
  precioCosto: number;
  precioVenta: number;
  stock: number;
  stockMinimo: number;
  bajoMinimo: boolean;
  categoriaId: string | null;
  reparto?: RepartoSucursal[];
}

const TIPOS: { valor: TipoMovimiento; etiqueta: string }[] = [
  { valor: 'entrada_compra', etiqueta: 'Entrada por compra' },
  { valor: 'merma', etiqueta: 'Merma (se perdio o se rompio)' },
  { valor: 'ajuste_positivo', etiqueta: 'Ajuste que suma' },
  { valor: 'ajuste_negativo', etiqueta: 'Ajuste que resta' },
  { valor: 'devolucion_proveedor', etiqueta: 'Devolucion a proveedor' },
  { valor: 'inventario_inicial', etiqueta: 'Inventario inicial' },
];

const ETIQUETA_TIPO: Record<string, string> = {
  inventario_inicial: 'Inventario inicial',
  entrada_compra: 'Entrada por compra',
  salida_venta: 'Venta',
  devolucion_cliente: 'Devolucion de cliente',
  devolucion_proveedor: 'Devolucion a proveedor',
  ajuste_positivo: 'Ajuste que suma',
  ajuste_negativo: 'Ajuste que resta',
  merma: 'Merma',
  transferencia_entrada: 'Entrada por transferencia',
  transferencia_salida: 'Salida por transferencia',
};

const RESTAN = new Set([
  'salida_venta',
  'devolucion_proveedor',
  'ajuste_negativo',
  'merma',
  'transferencia_salida',
]);

interface FormularioMovimiento {
  fila: FilaVista;
  sucursalId: string;
  tipo: TipoMovimiento;
  cantidad: string;
  costo: string;
  motivo: string;
}

interface FormularioTransferencia {
  fila: FilaVista;
  origenSucursalId: string;
  destinoSucursalId: string;
  cantidad: string;
  motivo: string;
}

/** Alta y edicion de un producto. */
interface BorradorProducto {
  id: string | null;
  sku: string;
  nombre: string;
  categoriaId: string;
  precioCosto: string;
  precioVenta: string;
  stockMinimo: string;
  codigos: string;
  stockInicial: string;
  sucursalId: string;
}

function borradorVacioDeProducto(sucursalId: string): BorradorProducto {
  return {
    id: null,
    sku: '',
    nombre: '',
    categoriaId: '',
    precioCosto: '',
    precioVenta: '',
    stockMinimo: '0',
    codigos: '',
    stockInicial: '0',
    // Viene elegida la sucursal que se esta viendo arriba: se puede cambiar o dejar
    // el stock inicial en cero para no surtir nada todavia.
    sucursalId,
  };
}

export function Inventario({ sesion, sucursalId, busquedaExterna, alCambiarBusqueda }: Props) {
  const [general, setGeneral] = useState(true);
  const [busquedaInterna, setBusquedaInterna] = useState('');
  const buscar = busquedaExterna ?? busquedaInterna;
  const setBuscar = alCambiarBusqueda ?? setBusquedaInterna;
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);
  const [soloBajoMinimo, setSoloBajoMinimo] = useState(false);
  const [formulario, setFormulario] = useState<FormularioMovimiento | null>(null);
  const [transferencia, setTransferencia] = useState<FormularioTransferencia | null>(null);
  const [kardex, setKardex] = useState<FilaVista | null>(null);
  const [producto, setProducto] = useState<BorradorProducto | null>(null);
  const [categoriasAbiertas, setCategoriasAbiertas] = useState(false);
  // Que fila tiene abierto el menu de tres puntos (solo se abre uno a la vez).
  const [menuAbiertoId, setMenuAbiertoId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const puedeMover = sesion.permisos.includes('inventory.adjust');
  const puedeTransferir =
    sesion.permisos.includes('inventory.transfer') && sesion.sucursales.length > 1;
  const puedeCatalogo = sesion.permisos.includes('catalog.manage');

  const { datos, cargando, error: errorLista, recargar } = useCarga(async () => {
    if (general) {
      const respuesta = await api.stockGeneral(buscar, soloBajoMinimo, 500);
      return { conAlerta: respuesta.conAlerta, filas: respuesta.stock as FilaVista[] };
    }
    const respuesta = await api.stock(sucursalId, buscar, soloBajoMinimo, 500);
    return { conAlerta: respuesta.conAlerta, filas: respuesta.stock as FilaVista[] };
  }, [general, buscar, soloBajoMinimo, sucursalId]);

  const { datos: datosKardex, cargando: cargandoKardex } = useCarga(
    () =>
      kardex
        ? api.movimientos({ productoId: kardex.productoId, limite: 60 })
        : Promise.resolve({ movimientos: [] as Movimiento[] }),
    [kardex],
  );

  const { datos: datosCategorias, recargar: recargarCategorias } = useCarga(
    () => api.categorias(),
    [],
  );

  const filas = datos?.filas ?? [];
  const paginas = Math.max(1, Math.ceil(filas.length / porPagina));
  const paginaActual = Math.min(pagina, paginas);
  const inicio = filas.length === 0 ? 0 : (paginaActual - 1) * porPagina;
  const filasPagina = filas.slice(inicio, inicio + porPagina);
  const indicePrimero = filas.length === 0 ? 0 : inicio + 1;
  const indiceUltimo = Math.min(inicio + porPagina, filas.length);
  const categorias: Categoria[] = datosCategorias?.categorias ?? [];
  const nombrePorCategoria = new Map(categorias.map((categoria) => [categoria.id, categoria.nombre]));
  const sucursal = sesion.sucursales.find((opcion) => opcion.id === sucursalId);

  useEffect(() => {
    setPagina(1);
  }, [buscar, general, sucursalId, soloBajoMinimo, porPagina]);

  function cerrarConMensaje(texto: string): void {
    setOk(texto);
    setFormulario(null);
    setTransferencia(null);
    setProducto(null);
    window.setTimeout(() => setOk(null), 4500);
  }

  async function guardarProducto(): Promise<void> {
    if (!producto) {
      return;
    }

    if (producto.sku.trim().length === 0 || producto.nombre.trim().length === 0) {
      setError('Escribe el SKU y el nombre del producto');
      return;
    }

    const inicial = Number(producto.stockInicial) || 0;
    if (!producto.id && inicial > 0 && !producto.sucursalId) {
      setError('Elige la sucursal donde entra el stock inicial, o deja el stock en cero');
      return;
    }

    setGuardando(true);
    setError(null);

    const codigos = producto.codigos
      .split(',')
      .map((codigo) => codigo.trim())
      .filter(Boolean);

    try {
      if (producto.id) {
        await api.editarProducto(producto.id, {
          sku: producto.sku.trim(),
          nombre: producto.nombre.trim(),
          ...(producto.categoriaId ? { categoriaId: producto.categoriaId } : {}),
          precioCosto: aCentavos(producto.precioCosto),
          precioVenta: aCentavos(producto.precioVenta),
          stockMinimo: Number(producto.stockMinimo) || 0,
        });

        for (const codigo of codigos) {
          await api.agregarCodigo(producto.id, codigo);
        }

        await recargar();
        cerrarConMensaje('Producto actualizado.');
      } else {
        await api.crearProducto({
          sku: producto.sku.trim(),
          nombre: producto.nombre.trim(),
          ...(producto.categoriaId ? { categoriaId: producto.categoriaId } : {}),
          precioCosto: aCentavos(producto.precioCosto),
          precioVenta: aCentavos(producto.precioVenta),
          stockMinimo: Number(producto.stockMinimo) || 0,
          codigosBarras: codigos,
          stockInicial: inicial,
          ...(inicial > 0 ? { sucursalId: producto.sucursalId } : {}),
        });

        await recargar();
        cerrarConMensaje(
          inicial > 0
            ? `Producto creado con ${inicial} piezas de existencia.`
            : 'Producto creado. Todavia sin existencia: registra una entrada cuando llegue.',
        );
      }
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  async function registrarMovimiento(): Promise<void> {
    if (!formulario) {
      return;
    }

    const cantidad = Number(formulario.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      setError('La cantidad debe ser un numero entero mayor a cero');
      return;
    }
    if (!formulario.sucursalId) {
      setError('Elige la sucursal donde entra o sale el producto');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      await api.registrarMovimiento({
        sucursalId: formulario.sucursalId,
        productoId: formulario.fila.productoId,
        tipo: formulario.tipo,
        cantidad,
        ...(formulario.costo.trim() ? { costoUnitario: aCentavos(formulario.costo) } : {}),
        ...(formulario.motivo.trim() ? { motivo: formulario.motivo.trim() } : {}),
      });

      await recargar();
      const destino = sesion.sucursales.find((opcion) => opcion.id === formulario.sucursalId);
      cerrarConMensaje(
        `${ETIQUETA_TIPO[formulario.tipo] ?? formulario.tipo}: ${cantidad} en ${destino?.codigo ?? ''}`,
      );
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  async function transferir(): Promise<void> {
    if (!transferencia) {
      return;
    }

    const cantidad = Number(transferencia.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      setError('La cantidad debe ser un numero entero mayor a cero');
      return;
    }
    if (!transferencia.destinoSucursalId) {
      setError('Elige la sucursal de destino');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      await api.transferir({
        origenSucursalId: transferencia.origenSucursalId,
        destinoSucursalId: transferencia.destinoSucursalId,
        ...(transferencia.motivo.trim() ? { motivo: transferencia.motivo.trim() } : {}),
        lineas: [{ productoId: transferencia.fila.productoId, cantidad }],
      });

      await recargar();
      cerrarConMensaje('Transferencia registrada');
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  function claseStock(fila: FilaVista): string {
    if (fila.stock <= 0) {
      return 'insignia insignia--agotado';
    }
    return fila.bajoMinimo ? 'insignia insignia--baja' : 'insignia insignia--ok';
  }

  /** El mismo estado, en palabras: el color solo no avisa a todo el mundo. */
  function estadoStock(fila: FilaVista): string {
    if (fila.stock <= 0) {
      return 'Agotado';
    }
    return fila.bajoMinimo ? 'Bajo el minimo' : 'Con existencia';
  }

  function repartoDe(fila: FilaVista): string {
    if (!fila.reparto || fila.reparto.length === 0) {
      return '—';
    }
    return fila.reparto.map((parte) => `${parte.codigo} ${parte.cantidad}`).join(' · ');
  }

  return (
    <div className="panel">
      <div className="panel__cabecera inventario__cabecera">
        <div className="inventario__titulo">
          <h1 className="panel__titulo inventario__titulo-principal">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m12 3 9 5-9 5-9-5 9-5Z" />
              <path d="M3 8v9l9 5 9-5V8M12 13v9" />
            </svg>
            Inventario
          </h1>
          <p className="panel__nota">
            {general ? 'Todas las sucursales' : `Sucursal ${sucursal?.codigo ?? '—'}`} ·{' '}
            {datos?.conAlerta ?? 0} productos por debajo del minimo
          </p>
        </div>

        <div className="barra-filtros inventario__controles">
          <div className="pestanas inventario__vistas">
            <button
              type="button"
              className={general ? 'pestana pestana--activa' : 'pestana'}
              onClick={() => setGeneral(true)}
            >
              General
            </button>
            <button
              type="button"
              className={general ? 'pestana' : 'pestana pestana--activa'}
              onClick={() => setGeneral(false)}
            >
              {sucursal?.codigo ?? 'Sucursal'}
            </button>
          </div>

          <label className="opcion-casilla inventario__filtro-minimo">
            <input
              type="checkbox"
              checked={soloBajoMinimo}
              onChange={(evento) => setSoloBajoMinimo(evento.target.checked)}
            />
            Solo bajo el minimo
          </label>

          {puedeCatalogo ? (
            <button
              type="button"
              className="boton inventario__categorias"
              onClick={() => {
                setError(null);
                setCategoriasAbiertas(true);
              }}
            >
              Categorias
            </button>
          ) : null}

          {puedeCatalogo ? (
            <button
              type="button"
              className="boton boton--acento inventario__nuevo"
              onClick={() => {
                setError(null);
                setProducto(borradorVacioDeProducto(sucursalId));
              }}
            >
              Nuevo producto
            </button>
          ) : null}
        </div>
      </div>

      <div className="barra-filtros inventario__busqueda">
        <input
          className="entrada buscador"
          placeholder="Buscar producto"
          value={buscar}
          onChange={(evento) => setBuscar(evento.target.value)}
        />
      </div>

      <Aviso error={error ?? errorLista} ok={ok} />

      {cargando ? <p className="panel__nota">Cargando…</p> : null}

      {!cargando && filas.length === 0 ? (
        <div className="tarjeta">
          <p className="vacio">
            {soloBajoMinimo
              ? 'Ningun producto esta por debajo de su minimo. Todo en orden.'
              : puedeCatalogo
                ? 'No hay productos todavia. Usa Nuevo producto para dar de alta el primero.'
                : 'No hay productos que coincidan.'}
          </p>
        </div>
      ) : null}

      {filas.length > 0 ? (
        <>
          <div className="tabla-envoltura inventario__tabla-envoltura">
            <table className="tabla tabla--inventario">
              <thead>
                <tr>
                  <th className="col-imagen" aria-label="Imagen" />
                  <th className="col-sku">SKU</th>
                  <th className="col-producto">Producto</th>
                  <th className="numero col-total">Stock</th>
                  {general ? <th className="col-reparto">Reparto por sucursal</th> : null}
                  <th className="numero col-minimo">Minimo</th>
                  <th className="numero col-costo">Costo</th>
                  <th className="numero col-venta">Venta</th>
                  <th className="col-categoria">Categoria</th>
                  <th className="col-acciones">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filasPagina.map((fila) => (
                  <tr key={fila.productoId}>
                    <td className="col-imagen">
                      {fila.imagenUrl ? (
                        <img className="inventario__miniatura" src={fila.imagenUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="inventario__miniatura inventario__miniatura--vacia" aria-hidden="true">
                          <svg viewBox="0 0 24 24">
                            <path d="m12 3 9 5-9 5-9-5 9-5Z" />
                            <path d="M3 8v9l9 5 9-5V8M12 13v9" />
                          </svg>
                        </span>
                      )}
                    </td>
                    <td className="codigo col-sku">
                      <span className="solo-angosto">SKU </span>
                      {fila.sku}
                    </td>
                    <td className="col-producto">{fila.nombre}</td>
                    <td className="numero col-total">
                      <span className="solo-angosto inventario__etiqueta-total">Total</span>
                      <span className={claseStock(fila)} title={estadoStock(fila)}>
                        {fila.stock}
                      </span>
                      <span className="solo-angosto inventario__estado-stock">{estadoStock(fila)}</span>
                    </td>
                    {general ? (
                      <td className="reparto col-reparto">
                        <span className="solo-angosto">Por sucursal: </span>
                        {repartoDe(fila)}
                      </td>
                    ) : null}
                    <td className="numero col-minimo">
                      <span className="solo-angosto">Minimo </span>
                      {fila.stockMinimo}
                    </td>
                    <td className="numero col-costo">
                      <span className="solo-angosto">Costo </span>
                      {dinero(fila.precioCosto)}
                    </td>
                    <td className="numero col-venta">{dinero(fila.precioVenta)}</td>
                    <td className="col-categoria">
                      {fila.categoriaId ? nombrePorCategoria.get(fila.categoriaId) ?? '—' : '—'}
                    </td>
                    <td className="col-acciones">
                      <div className="acciones-fila">
                      {puedeCatalogo ? (
                        <button
                          type="button"
                          className="boton accion-editar"
                          onClick={() => {
                            setError(null);
                            setProducto({
                              id: fila.productoId,
                              sku: fila.sku,
                              nombre: fila.nombre,
                              categoriaId: fila.categoriaId ?? '',
                              precioCosto: aTextoCaptura(fila.precioCosto),
                              precioVenta: aTextoCaptura(fila.precioVenta),
                              stockMinimo: String(fila.stockMinimo),
                              codigos: '',
                              stockInicial: '0',
                              sucursalId,
                            });
                          }}
                        >
                          Editar
                        </button>
                      ) : null}

                      {/* En escritorio el kardex va a la vista; en telefono tambien,
                          porque es la consulta mas comun. En tablet se guarda en el menu. */}
                      <button
                        type="button"
                        className="boton accion-kardex"
                        onClick={() => setKardex(fila)}
                      >
                        Kardex
                      </button>

                      {puedeMover ? (
                        <button
                          type="button"
                          className="boton accion-movimiento"
                          onClick={() => {
                            setError(null);
                            setFormulario({
                              fila,
                              sucursalId,
                              tipo: 'entrada_compra',
                              cantidad: '',
                              costo: '',
                              motivo: '',
                            });
                          }}
                        >
                          Movimiento
                        </button>
                      ) : null}

                      {puedeTransferir ? (
                        <button
                          type="button"
                          className="boton accion-transferir"
                          onClick={() => {
                            setError(null);
                            setTransferencia({
                              fila,
                              origenSucursalId: sucursalId,
                              destinoSucursalId: '',
                              cantidad: '',
                              motivo: '',
                            });
                          }}
                        >
                          Transferir
                        </button>
                      ) : null}

                      {/* Donde no caben todos los botones, aqui siguen estando. */}
                      <MenuAcciones
                        abierto={menuAbiertoId === fila.productoId}
                        onAbrir={() => setMenuAbiertoId(fila.productoId)}
                        onCerrar={() => setMenuAbiertoId(null)}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="menu-acciones__item menu-acciones__item--kardex"
                          onClick={() => {
                            setMenuAbiertoId(null);
                            setKardex(fila);
                          }}
                        >
                          Kardex
                        </button>
                        {puedeMover ? (
                          <button
                            type="button"
                            role="menuitem"
                            className="menu-acciones__item"
                            onClick={() => {
                              setMenuAbiertoId(null);
                              setError(null);
                              setFormulario({
                                fila,
                                sucursalId,
                                tipo: 'entrada_compra',
                                cantidad: '',
                                costo: '',
                                motivo: '',
                              });
                            }}
                          >
                            Movimiento
                          </button>
                        ) : null}
                        {puedeTransferir ? (
                          <button
                            type="button"
                            role="menuitem"
                            className="menu-acciones__item"
                            onClick={() => {
                              setMenuAbiertoId(null);
                              setError(null);
                              setTransferencia({
                                fila,
                                origenSucursalId: sucursalId,
                                destinoSucursalId: '',
                                cantidad: '',
                                motivo: '',
                              });
                            }}
                          >
                            Transferir
                          </button>
                        ) : null}
                      </MenuAcciones>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="inventario__paginacion">
            <span className="inventario__conteo">
              Mostrando {indicePrimero}–{indiceUltimo} de {filas.length} productos
            </span>
            <div className="inventario__pagina-controles">
              <button
                type="button"
                className="boton inventario__flecha"
                onClick={() => setPagina((actual) => Math.max(1, actual - 1))}
                disabled={paginaActual <= 1}
                aria-label="Pagina anterior"
              >
                ‹
              </button>
              <span className="inventario__pagina-actual">{paginaActual}</span>
              <button
                type="button"
                className="boton inventario__flecha"
                onClick={() => setPagina((actual) => Math.min(paginas, actual + 1))}
                disabled={paginaActual >= paginas}
                aria-label="Pagina siguiente"
              >
                ›
              </button>
              <label className="inventario__por-pagina">
                <span>Por pagina</span>
                <select
                  className="selector"
                  value={porPagina}
                  onChange={(evento) => setPorPagina(Number(evento.target.value))}
                  aria-label="Productos por pagina"
                >
                  {[25, 50, 100].map((cantidad) => (
                    <option key={cantidad} value={cantidad}>{cantidad}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </>
      ) : null}

      {/* ---------- Alta y edicion del producto ---------- */}
      {producto ? (
        <Modal
          titulo={producto.id ? `Editar ${producto.sku}` : 'Nuevo producto'}
          nota={
            producto.id
              ? 'Los codigos y el stock inicial solo se capturan al crear. Para mover existencias usa Movimiento.'
              : 'Si indicas stock inicial, eliges a que sucursal entra y queda registrado en el kardex.'
          }
          onCerrar={() => setProducto(null)}
        >
          <div className="formulario">
            <label className="campo-ancho">
              <span>SKU</span>
              <input
                className="entrada"
                value={producto.sku}
                onChange={(evento) => setProducto({ ...producto, sku: evento.target.value })}
              />
            </label>

            <label className="campo-ancho campo-ancho--ancho">
              <span>Nombre</span>
              <input
                className="entrada"
                value={producto.nombre}
                onChange={(evento) => setProducto({ ...producto, nombre: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Categoria</span>
              <select
                className="entrada"
                value={producto.categoriaId}
                onChange={(evento) => setProducto({ ...producto, categoriaId: evento.target.value })}
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
                value={producto.precioCosto}
                onChange={(evento) => setProducto({ ...producto, precioCosto: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Precio de venta</span>
              <input
                className="entrada entrada--numero"
                inputMode="decimal"
                value={producto.precioVenta}
                onChange={(evento) => setProducto({ ...producto, precioVenta: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Stock minimo</span>
              <input
                className="entrada entrada--numero"
                inputMode="numeric"
                value={producto.stockMinimo}
                onChange={(evento) => setProducto({ ...producto, stockMinimo: evento.target.value })}
              />
            </label>

            <label className="campo-ancho campo-ancho--ancho">
              <span>{producto.id ? 'Agregar codigos de barras' : 'Codigos de barras'}</span>
              <input
                className="entrada"
                placeholder="7501234567890, 7509876543210"
                value={producto.codigos}
                onChange={(evento) => setProducto({ ...producto, codigos: evento.target.value })}
              />
            </label>

            {!producto.id ? (
              <label className="campo-ancho">
                <span>Stock inicial</span>
                <input
                  className="entrada entrada--numero"
                  inputMode="numeric"
                  value={producto.stockInicial}
                  onChange={(evento) =>
                    setProducto({ ...producto, stockInicial: evento.target.value })
                  }
                />
              </label>
            ) : null}

            {!producto.id && (Number(producto.stockInicial) || 0) > 0 ? (
              <label className="campo-ancho">
                <span>Sucursal donde entra</span>
                <select
                  className="entrada"
                  value={producto.sucursalId}
                  onChange={(evento) =>
                    setProducto({ ...producto, sucursalId: evento.target.value })
                  }
                >
                  <option value="">Elegir sucursal…</option>
                  {sesion.sucursales.map((opcion) => (
                    <option key={opcion.id} value={opcion.id}>
                      {opcion.codigo} · {opcion.nombre}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setProducto(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="boton boton--acento"
              onClick={() => void guardarProducto()}
              disabled={guardando}
            >
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </Modal>
      ) : null}

      {/* ---------- Categorias ---------- */}
      {categoriasAbiertas ? (
        <Categorias
          categorias={categorias}
          onCerrar={() => setCategoriasAbiertas(false)}
          onCambio={async () => {
            await recargarCategorias();
            await recargar();
          }}
        />
      ) : null}

      {/* ---------- Movimiento de existencias ---------- */}
      {formulario ? (
        <Modal
          titulo="Registrar movimiento"
          nota={`${formulario.fila.sku} · ${formulario.fila.nombre} · hay ${formulario.fila.stock} en total`}
          onCerrar={() => setFormulario(null)}
        >
          <div className="formulario">
            <label className="campo-ancho campo-ancho--ancho">
              <span>Tipo de movimiento</span>
              <select
                className="entrada"
                value={formulario.tipo}
                onChange={(evento) =>
                  setFormulario({ ...formulario, tipo: evento.target.value as TipoMovimiento })
                }
              >
                {TIPOS.map((tipo) => (
                  <option key={tipo.valor} value={tipo.valor}>
                    {tipo.etiqueta}
                  </option>
                ))}
              </select>
            </label>

            <label className="campo-ancho">
              <span>Sucursal</span>
              <select
                className="entrada"
                value={formulario.sucursalId}
                onChange={(evento) =>
                  setFormulario({ ...formulario, sucursalId: evento.target.value })
                }
              >
                {sesion.sucursales.map((opcion) => (
                  <option key={opcion.id} value={opcion.id}>
                    {opcion.codigo} · {opcion.nombre}
                  </option>
                ))}
              </select>
            </label>

            <label className="campo-ancho">
              <span>Cantidad</span>
              <input
                className="entrada entrada--numero"
                inputMode="numeric"
                value={formulario.cantidad}
                onChange={(evento) => setFormulario({ ...formulario, cantidad: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Costo unitario (opcional)</span>
              <input
                className="entrada entrada--numero"
                inputMode="decimal"
                placeholder="Como en la factura"
                value={formulario.costo}
                onChange={(evento) => setFormulario({ ...formulario, costo: evento.target.value })}
              />
            </label>

            <label className="campo-ancho campo-ancho--ancho">
              <span>Motivo (queda en el kardex)</span>
              <input
                className="entrada"
                placeholder="Ej. Compra a proveedor, producto vencido, conteo fisico"
                value={formulario.motivo}
                onChange={(evento) => setFormulario({ ...formulario, motivo: evento.target.value })}
              />
            </label>
          </div>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setFormulario(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="boton boton--acento"
              onClick={() => void registrarMovimiento()}
              disabled={guardando}
            >
              {guardando ? 'Guardando…' : 'Registrar'}
            </button>
          </div>
        </Modal>
      ) : null}

      {/* ---------- Transferencia entre sucursales ---------- */}
      {transferencia ? (
        <Modal
          titulo="Transferir a otra sucursal"
          nota={`${transferencia.fila.sku} · ${transferencia.fila.nombre} · hay ${transferencia.fila.stock} en total`}
          onCerrar={() => setTransferencia(null)}
        >
          <div className="formulario">
            <label className="campo-ancho">
              <span>Desde</span>
              <select
                className="entrada"
                value={transferencia.origenSucursalId}
                onChange={(evento) =>
                  setTransferencia({ ...transferencia, origenSucursalId: evento.target.value })
                }
              >
                {sesion.sucursales.map((opcion) => (
                  <option key={opcion.id} value={opcion.id}>
                    {opcion.codigo} · {opcion.nombre}
                  </option>
                ))}
              </select>
            </label>

            <label className="campo-ancho">
              <span>Hacia</span>
              <select
                className="entrada"
                value={transferencia.destinoSucursalId}
                onChange={(evento) =>
                  setTransferencia({ ...transferencia, destinoSucursalId: evento.target.value })
                }
              >
                <option value="">Elige…</option>
                {sesion.sucursales
                  .filter((opcion) => opcion.id !== transferencia.origenSucursalId)
                  .map((opcion) => (
                    <option key={opcion.id} value={opcion.id}>
                      {opcion.codigo} · {opcion.nombre}
                    </option>
                  ))}
              </select>
            </label>

            <label className="campo-ancho">
              <span>Cantidad</span>
              <input
                className="entrada entrada--numero"
                inputMode="numeric"
                value={transferencia.cantidad}
                onChange={(evento) =>
                  setTransferencia({ ...transferencia, cantidad: evento.target.value })
                }
              />
            </label>

            <label className="campo-ancho">
              <span>Motivo</span>
              <input
                className="entrada"
                value={transferencia.motivo}
                onChange={(evento) =>
                  setTransferencia({ ...transferencia, motivo: evento.target.value })
                }
              />
            </label>
          </div>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setTransferencia(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="boton boton--acento"
              onClick={() => void transferir()}
              disabled={guardando}
            >
              {guardando ? 'Transfiriendo…' : 'Transferir'}
            </button>
          </div>
        </Modal>
      ) : null}

      {/* ---------- Kardex ---------- */}
      {kardex ? (
        <Modal
          titulo="Kardex"
          nota={`${kardex.sku} · ${kardex.nombre} · la historia no se borra nunca`}
          onCerrar={() => setKardex(null)}
        >
          {cargandoKardex ? <p className="panel__nota">Cargando…</p> : null}

          {(datosKardex?.movimientos ?? []).length === 0 && !cargandoKardex ? (
            <p className="vacio">Este producto todavia no tiene movimientos.</p>
          ) : null}

          {(datosKardex?.movimientos ?? []).length > 0 ? (
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Cuando</th>
                    <th>Movimiento</th>
                    <th className="numero">Cantidad</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {(datosKardex?.movimientos ?? []).map((movimiento) => (
                    <tr key={movimiento.id}>
                      <td>{fechaLarga(movimiento.ocurridoEn)}</td>
                      <td>{ETIQUETA_TIPO[movimiento.tipo] ?? movimiento.tipo}</td>
                      <td className="numero">
                        {RESTAN.has(movimiento.tipo)
                          ? `−${movimiento.cantidad}`
                          : `+${movimiento.cantidad}`}
                      </td>
                      <td>{movimiento.motivo ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}

/* ---------- Categorias ---------- */

interface PropsCategorias {
  categorias: Categoria[];
  onCerrar: () => void;
  onCambio: () => Promise<void>;
}

/**
 * Categorias: agregar, renombrar y borrar.
 *
 * Borrar no siempre se puede: si hay productos usando la categoria, el servidor lo
 * impide y aqui se muestra el motivo. Es mejor eso que dejar productos sin clasificar
 * sin que nadie se entere.
 */
function Categorias({ categorias, onCerrar, onCambio }: PropsCategorias) {
  const [nueva, setNueva] = useState('');
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function ejecutar(accion: () => Promise<unknown>, mensaje: string): Promise<void> {
    setGuardando(true);
    setError(null);

    try {
      await accion();
      await onCambio();
      setOk(mensaje);
      window.setTimeout(() => setOk(null), 3500);
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo="Categorias"
      nota="Sirven para agrupar los productos. Cada producto puede tener una."
      onCerrar={onCerrar}
    >
      <div className="barra-filtros" style={{ marginBottom: '0.8rem' }}>
        <input
          className="entrada"
          style={{ maxWidth: '16rem' }}
          placeholder="Nombre de la nueva categoria"
          value={nueva}
          onChange={(evento) => setNueva(evento.target.value)}
        />
        <button
          type="button"
          className="boton boton--acento"
          disabled={guardando || nueva.trim().length === 0}
          onClick={() =>
            void ejecutar(async () => {
              await api.crearCategoria(nueva.trim());
              setNueva('');
            }, 'Categoria agregada.')
          }
        >
          Agregar
        </button>
      </div>

      <Aviso error={error} ok={ok} />

      {categorias.length === 0 ? (
        <p className="vacio">Todavia no hay categorias.</p>
      ) : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Categoria</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {categorias.map((categoria) => (
                <tr key={categoria.id}>
                  <td>
                    {editando?.id === categoria.id ? (
                      <input
                        className="entrada"
                        value={editando.nombre}
                        onChange={(evento) =>
                          setEditando({ id: categoria.id, nombre: evento.target.value })
                        }
                      />
                    ) : (
                      categoria.nombre
                    )}
                  </td>
                  <td>
                    <div className="acciones-fila">
                      {editando?.id === categoria.id ? (
                        <>
                          <button
                            type="button"
                            className="boton boton--acento"
                            disabled={guardando}
                            onClick={() =>
                              void ejecutar(async () => {
                                await api.editarCategoria(categoria.id, editando.nombre.trim());
                                setEditando(null);
                              }, 'Categoria renombrada.')
                            }
                          >
                            Guardar
                          </button>
                          <button type="button" className="boton" onClick={() => setEditando(null)}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="boton"
                            onClick={() => setEditando({ id: categoria.id, nombre: categoria.nombre })}
                          >
                            Renombrar
                          </button>
                          <button
                            type="button"
                            className="boton"
                            disabled={guardando}
                            onClick={() =>
                              void ejecutar(
                                () => api.borrarCategoria(categoria.id),
                                'Categoria borrada.',
                              )
                            }
                          >
                            Borrar
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
