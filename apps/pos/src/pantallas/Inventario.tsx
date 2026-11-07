import { useEffect, useState } from 'react';
import { api } from '../api/cliente';
import type {
  Categoria,
  Movimiento,
  RepartoSucursal,
  Sesion,
  TipoMovimiento,
  Transferencia,
} from '../api/tipos';
import { AltaInventario } from '../componentes/AltaInventario';
import { MenuAcciones } from '../componentes/MenuAcciones';
import { Aviso, Modal, mensajeDe, useCarga } from '../util/pantalla';
import { aCentavos, aTextoCaptura, dinero, fechaLarga } from '../util/dinero';
import {
  ETIQUETA_MOVIMIENTO,
  MOVIMIENTOS_QUE_RESTAN,
  TIPOS_MANUALES,
} from '../util/movimientos';

/**
 * Inventario general.
 *
 * En Productos se da de alta el catalogo (foto, codigos, costos y precios) y se
 * consultan los movimientos de cada producto. En Inventario se ven las existencias.
 * En Movimientos se agrega mercancia a cada sucursal y se manejan los traslados.
 */

export type VistaMercancia = 'productos' | 'existencias' | 'movimientos';

interface Props {
  sesion: Sesion;
  sucursalId: string;
  /** Cuando viene del menu del administrador, abre solo esa parte de la mercancia. */
  vista?: VistaMercancia;
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

const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  en_transito: 'En transito',
  recibida: 'Recibida',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
};

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

interface FormularioRecepcion {
  transferencia: Transferencia;
  /** Lo que realmente llego, por id de linea. Empieza igual a lo enviado. */
  cantidades: Record<string, string>;
}

interface FormularioRechazo {
  transferencia: Transferencia;
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
  imagenUrl: string;
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
    imagenUrl: '',
  };
}

/**
 * Reduce la foto antes de subirla: las camaras del telefono sacan 3-4 MB y en el
 * almacenamiento gratuito de Supabase eso se acaba rapido. 1200 px de lado mayor
 * es mas que suficiente para una miniatura de inventario.
 */
async function prepararImagen(archivo: File): Promise<File> {
  try {
    const mapa = await createImageBitmap(archivo);
    const mayor = Math.max(mapa.width, mapa.height);
    const escala = Math.min(1, 1200 / mayor);

    if (escala === 1 && archivo.size <= 600 * 1024) {
      mapa.close();
      return archivo;
    }

    const lienzo = document.createElement('canvas');
    lienzo.width = Math.max(1, Math.round(mapa.width * escala));
    lienzo.height = Math.max(1, Math.round(mapa.height * escala));
    const contexto = lienzo.getContext('2d');
    if (!contexto) {
      mapa.close();
      return archivo;
    }

    contexto.drawImage(mapa, 0, 0, lienzo.width, lienzo.height);
    mapa.close();

    const reducida = await new Promise<Blob | null>((resolver) =>
      lienzo.toBlob(resolver, 'image/jpeg', 0.82),
    );
    if (!reducida) {
      return archivo;
    }

    return new File([reducida], archivo.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
    });
  } catch {
    return archivo;
  }
}

export function Inventario({ sesion, sucursalId: sucursalInicial, vista, busquedaExterna, alCambiarBusqueda }: Props) {
  const [sucursalId, setSucursalId] = useState(sucursalInicial);
  const [general] = useState(false);
  const [busquedaInterna, setBusquedaInterna] = useState('');
  const buscar = busquedaExterna ?? busquedaInterna;
  const setBuscar = alCambiarBusqueda ?? setBusquedaInterna;
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);
  const [soloBajoMinimo, setSoloBajoMinimo] = useState(false);
  const [soloAgotados, setSoloAgotados] = useState(false);
  const [categoriaId, setCategoriaId] = useState('');
  const [formulario, setFormulario] = useState<FormularioMovimiento | null>(null);
  const [transferencia, setTransferencia] = useState<FormularioTransferencia | null>(null);
  const [recepcion, setRecepcion] = useState<FormularioRecepcion | null>(null);
  const [rechazo, setRechazo] = useState<FormularioRechazo | null>(null);
  const [verMovimientos, setVerMovimientos] = useState(false);
  const [altaAbierta, setAltaAbierta] = useState(false);
  const enMovimientos = vista === 'movimientos' || (vista === undefined && verMovimientos);
  const enProductos = vista === 'productos';
  const enExistencias = !enProductos && !enMovimientos;
  const [kardex, setKardex] = useState<FilaVista | null>(null);
  const [producto, setProducto] = useState<BorradorProducto | null>(null);
  const [porBorrar, setPorBorrar] = useState<FilaVista | null>(null);
  // Que fila tiene abierto el menu de tres puntos (solo se abre uno a la vez).
  const [menuAbiertoId, setMenuAbiertoId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [subiendoImagen, setSubiendoImagen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const puedeMover = sesion.permisos.includes('inventory.adjust');

  const puedeCatalogo = sesion.permisos.includes('catalog.manage');

  const { datos, cargando, error: errorLista, recargar } = useCarga(async () => {
    const filtros = {
      buscar,
      ...(categoriaId ? { categoriaId } : {}),
      soloBajoMinimo,
      soloAgotados,
      limite: 500,
    };

    if (general) {
      const respuesta = await api.stockGeneral(filtros);
      return { conAlerta: respuesta.conAlerta, filas: respuesta.stock as FilaVista[] };
    }
    const respuesta = await api.stock(sucursalId, filtros);
    return { conAlerta: respuesta.conAlerta, filas: respuesta.stock as FilaVista[] };
  }, [general, buscar, categoriaId, soloBajoMinimo, soloAgotados, sucursalId]);

  const { datos: datosKardex, cargando: cargandoKardex } = useCarga(
    () =>
      kardex
        ? api.movimientos({ productoId: kardex.productoId, limite: 60 })
        : Promise.resolve({ movimientos: [] as Movimiento[] }),
    [kardex],
  );

  const { datos: datosCategorias } = useCarga(
    () => api.categorias(),
    [],
  );

  const { datos: datosUbicaciones } = useCarga(() => api.ubicaciones(), []);

  const { datos: datosTransferencias, cargando: cargandoTransferencias, recargar: recargarTransferencias } =
    useCarga(() => api.transferencias({ limite: 100 }), []);

  const {
    datos: datosMovimientos,
    cargando: cargandoMovimientos,
    recargar: recargarMovimientos,
  } = useCarga(
    () =>
      enMovimientos
        ? api.movimientos({ limite: 60 })
        : Promise.resolve({ movimientos: [] as Movimiento[] }),
    [enMovimientos],
  );

  const puedeTransferir =
    sesion.permisos.includes('inventory.transfer') && sesion.sucursales.length > 1;

  const filas = datos?.filas ?? [];
  const paginas = Math.max(1, Math.ceil(filas.length / porPagina));
  const paginaActual = Math.min(pagina, paginas);
  const inicio = filas.length === 0 ? 0 : (paginaActual - 1) * porPagina;
  const filasPagina = filas.slice(inicio, inicio + porPagina);
  const indicePrimero = filas.length === 0 ? 0 : inicio + 1;
  const indiceUltimo = Math.min(inicio + porPagina, filas.length);
  const categorias: Categoria[] = datosCategorias?.categorias ?? [];
  const nombrePorCategoria = new Map(categorias.map((categoria) => [categoria.id, categoria.nombre]));
  const movimientos = datosMovimientos?.movimientos ?? [];
  const nombrePorSucursal = new Map(sesion.sucursales.map((opcion) => [opcion.id, opcion.nombre]));

  useEffect(() => {
    setPagina(1);
  }, [buscar, general, sucursalId, categoriaId, soloBajoMinimo, soloAgotados, porPagina]);

  function cerrarConMensaje(texto: string): void {
    setOk(texto);
    setFormulario(null);
    setTransferencia(null);
    setRecepcion(null);
    setRechazo(null);
    setProducto(null);
    window.setTimeout(() => setOk(null), 4500);
  }

  async function subirImagen(archivo: File): Promise<void> {
    if (!producto) {
      return;
    }

    setSubiendoImagen(true);
    setError(null);
    try {
      const lista = await prepararImagen(archivo);
      const { url } = await api.subirImagenProducto(lista);
      setProducto((actual) => (actual ? { ...actual, imagenUrl: url } : actual));
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setSubiendoImagen(false);
    }
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
    const imagenUrl = producto.imagenUrl.trim() || null;

    try {
      if (producto.id) {
        await api.editarProducto(producto.id, {
          sku: producto.sku.trim(),
          nombre: producto.nombre.trim(),
          ...(producto.categoriaId ? { categoriaId: producto.categoriaId } : {}),
          precioCosto: aCentavos(producto.precioCosto),
          precioVenta: aCentavos(producto.precioVenta),
          stockMinimo: Number(producto.stockMinimo) || 0,
          imagenUrl,
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
          imagenUrl,
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

  async function borrarProducto(): Promise<void> {
    if (!porBorrar) {
      return;
    }

    setGuardando(true);
    setError(null);
    try {
      await api.borrarProducto(porBorrar.productoId);
      setPorBorrar(null);
      await recargar();
      setOk(`Producto ${porBorrar.sku} retirado del catalogo.`);
      window.setTimeout(() => setOk(null), 4000);
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

      await Promise.all([recargar(), recargarMovimientos()]);
      const destino = sesion.sucursales.find((opcion) => opcion.id === formulario.sucursalId);
      cerrarConMensaje(
        `${ETIQUETA_MOVIMIENTO[formulario.tipo] ?? formulario.tipo}: ${cantidad} en ${destino?.codigo ?? ''}`,
      );
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  /** Ubicacion interna que representa a la sucursal en una transferencia. */
  function ubicacionInicialDe(sucursal: string): string {
    const ubicaciones = datosUbicaciones?.ubicaciones ?? [];
    const ubicacion =
      ubicaciones.find((opcion) => opcion.sucursalId === sucursal && opcion.tipo === 'piso_venta') ??
      ubicaciones.find((opcion) => opcion.sucursalId === sucursal);
    return ubicacion?.id ?? '';
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
    if (transferencia.destinoSucursalId === transferencia.origenSucursalId) {
      setError('Elige dos sucursales distintas');
      return;
    }

    const origenUbicacionId = ubicacionInicialDe(transferencia.origenSucursalId);
    const destinoUbicacionId = ubicacionInicialDe(transferencia.destinoSucursalId);
    if (!origenUbicacionId || !destinoUbicacionId) {
      setError('Las sucursales todavia no tienen una ubicacion configurada');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      const { transferencia: creada } = await api.crearTransferencia({
        origenUbicacionId,
        destinoUbicacionId,
        ...(transferencia.motivo.trim() ? { motivo: transferencia.motivo.trim() } : {}),
        lineas: [{ productoId: transferencia.fila.productoId, cantidad }],
      });

      await Promise.all([recargar(), recargarTransferencias(), recargarMovimientos()]);
      cerrarConMensaje(
        `Transferencia ${creada.folio} creada. Despachala desde Movimientos cuando salga la mercancia.`,
      );
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  /** Ejecuta una accion sobre una transferencia y refresca stock y lista. */
  async function accionTransferencia(ejecutar: () => Promise<unknown>, texto: string): Promise<void> {
    setGuardando(true);
    setError(null);

    try {
      await ejecutar();
      await Promise.all([recargar(), recargarTransferencias(), recargarMovimientos()]);
      cerrarConMensaje(texto);
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  async function confirmarRecepcion(): Promise<void> {
    if (!recepcion) {
      return;
    }

    const lineas = recepcion.transferencia.lineas.map((linea) => ({
      lineaId: linea.id,
      cantidadRecibida: Number(recepcion.cantidades[linea.id] ?? linea.enviada),
    }));
    if (lineas.some((linea) => !Number.isInteger(linea.cantidadRecibida) || linea.cantidadRecibida < 0)) {
      setError('Escribe cantidades enteras, desde cero');
      return;
    }

    const { id, folio } = recepcion.transferencia;
    await accionTransferencia(
      () => api.recibirTransferencia(id, lineas),
      `Recepcion de ${folio} confirmada`,
    );
  }

  async function confirmarRechazo(): Promise<void> {
    if (!rechazo) {
      return;
    }
    if (rechazo.motivo.trim().length < 3) {
      setError('Escribe el motivo del rechazo');
      return;
    }

    const { id, folio } = rechazo.transferencia;
    await accionTransferencia(
      () => api.rechazarTransferencia(id, rechazo.motivo.trim()),
      `Transferencia ${folio} rechazada: la mercancia regreso al origen`,
    );
  }

  /** Se guardo una entrada desde Movimientos: refresca stock y movimientos. */
  function alGuardarMovimiento(texto: string): void {
    setAltaAbierta(false);
    setOk(texto);
    window.setTimeout(() => setOk(null), 4500);
    void recargar();
    void recargarMovimientos();
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
            {enProductos ? 'Productos' : enMovimientos ? 'Movimientos' : 'Inventario'}
          </h1>
          <p className="panel__nota">
            {enProductos
              ? `Catalogo de productos: foto, codigos de barras, costos, precios y stock. ${datos?.filas.length ?? 0} productos en el catalogo. Usa Movimientos en un producto para ver su historial.`
              : enMovimientos
                ? 'Agrega mercancia a cada sucursal y controla los traslados entre sucursales.'
                : `Existencias por sucursal, entradas, salidas, mermas y stock mínimo. ${datos?.conAlerta ?? 0} productos por debajo del minimo.`}
          </p>
        </div>

        <div className="barra-filtros inventario__controles">
          {sesion.sucursales.length > 1 ? (
            <select
              className="selector"
              value={sucursalId}
              onChange={(evento) => setSucursalId(evento.target.value)}
              aria-label="Sucursal"
            >
              {sesion.sucursales.map((opcion) => (
                <option key={opcion.id} value={opcion.id}>
                  {opcion.nombre}
                </option>
              ))}
            </select>
          ) : null}

          {vista === undefined ? (
            <div className="pestanas inventario__vistas">
              <button
                type="button"
                className={enMovimientos ? 'pestana' : 'pestana pestana--activa'}
                onClick={() => setVerMovimientos(false)}
              >
                Existencias
              </button>
              <button
                type="button"
                className={enMovimientos ? 'pestana pestana--activa' : 'pestana'}
                onClick={() => setVerMovimientos(true)}
              >
                Movimientos
              </button>
            </div>
          ) : null}

          {enMovimientos && puedeMover ? (
            <button
              type="button"
              className="boton boton--acento inventario__nuevo"
              onClick={() => {
                setError(null);
                setAltaAbierta(true);
              }}
            >
              Agregar producto
            </button>
          ) : null}

          {enProductos && puedeCatalogo ? (
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

      {enMovimientos ? null : (
        <div className="barra-filtros inventario__busqueda inventario__filtros">
          <input
            className="entrada buscador"
            placeholder={enProductos ? 'Buscar productos...' : 'Buscar existencias...'}
            value={buscar}
            onChange={(evento) => setBuscar(evento.target.value)}
            aria-label={enProductos ? 'Buscar productos' : 'Buscar existencias'}
          />

          <select
            className="selector inventario__categorias"
            value={categoriaId}
            onChange={(evento) => setCategoriaId(evento.target.value)}
            aria-label="Filtrar por categoria"
          >
            <option value="">Todas las categorias</option>
            {categorias.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {categoria.nombre}
              </option>
            ))}
          </select>

          {enExistencias ? (
            <>
              <label className="opcion-casilla inventario__filtro-minimo">
                <input
                  type="checkbox"
                  checked={soloBajoMinimo}
                  onChange={(evento) => setSoloBajoMinimo(evento.target.checked)}
                />
                Solo bajo el minimo
              </label>

              <label className="opcion-casilla">
                <input
                  type="checkbox"
                  checked={soloAgotados}
                  onChange={(evento) => setSoloAgotados(evento.target.checked)}
                />
                Solo agotados
              </label>
            </>
          ) : null}
        </div>
      )}

      <Aviso error={error ?? errorLista} ok={ok} />

      {enMovimientos ? (
        <section className="inventario__seccion">
          <div className="inventario__seccion-cabecera">
            <h2 className="inventario__seccion-titulo">Traslados entre sucursales</h2>
            <p className="panel__nota">
              Se despachan desde el origen y se reciben en el destino.
            </p>
          </div>
          <div className="tabla-envoltura inventario__tabla-envoltura">
            {cargandoTransferencias ? <p className="panel__nota">Cargando…</p> : null}
            <table className="tabla">
            <thead>
              <tr>
                <th>Folio</th>
                <th>Desde</th>
                <th>Hacia</th>
                <th>Productos</th>
                <th>Estado</th>
                <th className="col-acciones">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(datosTransferencias?.transferencias ?? []).map((fila) => {
                const puedeDespachar =
                  fila.estado === 'borrador' &&
                  sesion.sucursales.some((opcion) => opcion.id === fila.origen.sucursalId);
                const puedeRecibir =
                  fila.estado === 'en_transito' &&
                  sesion.sucursales.some((opcion) => opcion.id === fila.destino.sucursalId);
                const puedeCancelar =
                  fila.estado === 'borrador' &&
                  sesion.sucursales.some((opcion) => opcion.id === fila.origen.sucursalId);

                return (
                  <tr key={fila.id}>
                    <td className="codigo">
                      {fila.folio}
                      {fila.hayIncidencia ? (
                        <span className="insignia insignia--baja">Incidencia</span>
                      ) : null}
                    </td>
                    <td>
                      {fila.origen.sucursalCodigo} · {fila.origen.sucursalNombre}
                    </td>
                    <td>
                      {fila.destino.sucursalCodigo} · {fila.destino.sucursalNombre}
                    </td>
                    <td>
                      {fila.lineas
                        .map((linea) => `${linea.nombre} × ${linea.enviada}`)
                        .join(', ')}
                      {fila.motivo ? <span className="panel__nota"> · {fila.motivo}</span> : null}
                    </td>
                    <td>{ETIQUETA_ESTADO[fila.estado] ?? fila.estado}</td>
                    <td className="col-acciones">
                      <div className="acciones-fila">
                        {puedeDespachar ? (
                          <button
                            type="button"
                            className="boton boton--acento"
                            disabled={guardando}
                            onClick={() =>
                              void accionTransferencia(
                                () => api.despacharTransferencia(fila.id),
                                `${fila.folio} despachada: la mercancia salio del origen`,
                              )
                            }
                          >
                            Despachar
                          </button>
                        ) : null}
                        {puedeRecibir ? (
                          <button
                            type="button"
                            className="boton boton--acento"
                            onClick={() => {
                              setError(null);
                              setRecepcion({
                                transferencia: fila,
                                cantidades: Object.fromEntries(
                                  fila.lineas.map((linea) => [linea.id, String(linea.enviada)]),
                                ),
                              });
                            }}
                          >
                            Recibir
                          </button>
                        ) : null}
                        {puedeRecibir ? (
                          <button
                            type="button"
                            className="boton"
                            onClick={() => {
                              setError(null);
                              setRechazo({ transferencia: fila, motivo: '' });
                            }}
                          >
                            Rechazar
                          </button>
                        ) : null}
                        {puedeCancelar ? (
                          <button
                            type="button"
                            className="boton"
                            disabled={guardando}
                            onClick={() =>
                              void accionTransferencia(
                                () => api.cancelarTransferencia(fila.id),
                                `${fila.folio} cancelada`,
                              )
                            }
                          >
                            Cancelar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!cargandoTransferencias && (datosTransferencias?.transferencias.length ?? 0) === 0 ? (
              <p className="vacio">Todavia no hay transferencias.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {enMovimientos ? (
        <section className="inventario__seccion">
          <div className="inventario__seccion-cabecera">
            <h2 className="inventario__seccion-titulo">Ultimos movimientos</h2>
            <p className="panel__nota">
              Entradas, salidas, mermas y ajustes de todas las sucursales.
            </p>
          </div>

          {cargandoMovimientos ? <p className="panel__nota">Cargando…</p> : null}

          {!cargandoMovimientos && movimientos.length === 0 ? (
            <div className="tarjeta">
              <p className="vacio">
                Todavia no hay movimientos. Usa Agregar producto para dar la primera entrada.
              </p>
            </div>
          ) : null}

          {movimientos.length > 0 ? (
            <div className="tabla-envoltura inventario__tabla-envoltura">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Cuando</th>
                    <th>Producto</th>
                    <th>Sucursal</th>
                    <th>Movimiento</th>
                    <th className="numero">Cantidad</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map((movimiento) => (
                    <tr key={movimiento.id}>
                      <td>{fechaLarga(movimiento.ocurridoEn)}</td>
                      <td>
                        <span className="codigo">{movimiento.sku}</span> · {movimiento.producto}
                      </td>
                      <td>{nombrePorSucursal.get(movimiento.sucursalId) ?? '—'}</td>
                      <td>{ETIQUETA_MOVIMIENTO[movimiento.tipo] ?? movimiento.tipo}</td>
                      <td className="numero">
                        {MOVIMIENTOS_QUE_RESTAN.has(movimiento.tipo)
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
        </section>
      ) : null}

      {!enMovimientos && cargando ? <p className="panel__nota">Cargando…</p> : null}

      {!enMovimientos && !cargando && filas.length === 0 ? (
        <div className="tarjeta">
          <p className="vacio">
            {soloAgotados
              ? 'No hay productos agotados en esta sucursal.'
              : soloBajoMinimo
                ? 'Ningun producto esta por debajo de su minimo. Todo en orden.'
                : puedeCatalogo && enProductos && !buscar && !categoriaId
                  ? 'No hay productos todavia. Usa Nuevo producto para dar de alta el primero.'
                  : 'No hay productos que coincidan con la busqueda.'}
          </p>
        </div>
      ) : null}

      {!enMovimientos && filas.length > 0 ? (
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
                              imagenUrl: fila.imagenUrl ?? '',
                            });
                          }}
                        >
                          Editar
                        </button>
                      ) : null}

                      {enProductos ? (
                        <button
                          type="button"
                          className="boton"
                          onClick={() => setKardex(fila)}
                        >
                          Movimientos
                        </button>
                      ) : null}

                      {enProductos ? (
                        <button
                          type="button"
                          className="boton"
                          onClick={() => {
                            setError(null);
                            setPorBorrar(fila);
                          }}
                        >
                          Borrar
                        </button>
                      ) : null}

                      {puedeMover && !enProductos ? (
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

                      {puedeTransferir && !enProductos ? (
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
                      {!enProductos ? (
                      <MenuAcciones
                        abierto={menuAbiertoId === fila.productoId}
                        onAbrir={() => setMenuAbiertoId(fila.productoId)}
                        onCerrar={() => setMenuAbiertoId(null)}
                      >
                        {puedeMover && !enProductos ? (
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
                        {puedeTransferir && !enProductos ? (
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
                      ) : null}
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
              : 'Si indicas stock inicial, eliges a que sucursal entra y queda registrado en los movimientos.'
          }
          onCerrar={() => setProducto(null)}
        >
          <div className="formulario">
            <div className="campo-ancho campo-ancho--ancho producto-foto">
              <span>Foto del producto</span>
              <div className="producto-foto__cuerpo">
                <div className="producto-foto__vista">
                  {producto.imagenUrl ? (
                    <img src={producto.imagenUrl} alt="Foto del producto" />
                  ) : (
                    <span className="producto-foto__vacio">Sin foto</span>
                  )}
                </div>

                <div className="producto-foto__controles">
                  <label className="boton producto-foto__boton">
                    {subiendoImagen ? 'Subiendo…' : 'Subir foto'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={subiendoImagen || guardando}
                      onChange={(evento) => {
                        const archivo = evento.target.files?.[0];
                        if (archivo) {
                          void subirImagen(archivo);
                        }
                        evento.target.value = '';
                      }}
                    />
                  </label>

                  <input
                    className="entrada"
                    placeholder="… o pega un enlace https://"
                    value={producto.imagenUrl}
                    onChange={(evento) =>
                      setProducto({ ...producto, imagenUrl: evento.target.value })
                    }
                  />

                  {producto.imagenUrl ? (
                    <button
                      type="button"
                      className="boton boton--fantasma"
                      onClick={() => setProducto({ ...producto, imagenUrl: '' })}
                    >
                      Quitar foto
                    </button>
                  ) : null}

                  <p className="panel__nota">
                    JPG, PNG o WebP hasta 4 MB. Tambien puedes pegar una URL externa.
                  </p>
                </div>
              </div>
            </div>

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
                  {opcion.nombre}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {error ? (
            <p className="aviso" role="alert">
              {error}
            </p>
          ) : null}

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

      {porBorrar ? (
        <Modal
          titulo={`Borrar ${porBorrar.sku}`}
          nota="El producto dejara de aparecer en el catalogo y en el mostrador."
          onCerrar={() => setPorBorrar(null)}
        >
          <p className="panel__nota">
            Se conservan las ventas y los movimientos anteriores. Esta accion no
            borra la historia, solo retira el producto del catalogo.
          </p>
          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setPorBorrar(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="boton boton--acento"
              onClick={() => void borrarProducto()}
              disabled={guardando}
            >
              {guardando ? 'Borrando…' : 'Borrar producto'}
            </button>
          </div>
        </Modal>
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
                {TIPOS_MANUALES.map((tipo) => (
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
                  {opcion.nombre}
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
              <span>Motivo (queda en el historial)</span>
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
          titulo="Transferir stock"
          nota={`${transferencia.fila.sku} · ${transferencia.fila.nombre} · hay ${transferencia.fila.stock} en total. La mercancia sale de una sucursal y se recibe en otra.`}
          onCerrar={() => setTransferencia(null)}
        >
          <div className="formulario">
            <label className="campo-ancho">
              <span>Desde</span>
              <select
                className="entrada"
                value={transferencia.origenSucursalId}
                onChange={(evento) =>
                  setTransferencia({
                    ...transferencia,
                    origenSucursalId: evento.target.value,
                    destinoSucursalId: '',
                  })
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

      {/* ---------- Recepcion de una transferencia ---------- */}
      {recepcion ? (
        <Modal
          titulo="Recibir transferencia"
          nota={`${recepcion.transferencia.folio} · escribe lo que realmente llego. Si llega menos, queda marcada como incidencia.`}
          onCerrar={() => setRecepcion(null)}
        >
          <div className="formulario">
            {recepcion.transferencia.lineas.map((linea) => (
              <label className="campo-ancho" key={linea.id}>
                <span>
                  {linea.sku} · {linea.nombre} (enviadas {linea.enviada})
                </span>
                <input
                  className="entrada entrada--numero"
                  inputMode="numeric"
                  value={recepcion.cantidades[linea.id] ?? ''}
                  onChange={(evento) =>
                    setRecepcion({
                      ...recepcion,
                      cantidades: { ...recepcion.cantidades, [linea.id]: evento.target.value },
                    })
                  }
                />
              </label>
            ))}
          </div>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setRecepcion(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="boton boton--acento"
              onClick={() => void confirmarRecepcion()}
              disabled={guardando}
            >
              {guardando ? 'Guardando…' : 'Confirmar recepcion'}
            </button>
          </div>
        </Modal>
      ) : null}

      {/* ---------- Rechazo de una transferencia ---------- */}
      {rechazo ? (
        <Modal
          titulo="Rechazar transferencia"
          nota={`${rechazo.transferencia.folio} · la mercancia regresa completa a ${rechazo.transferencia.origen.sucursalCodigo} · ${rechazo.transferencia.origen.nombre}`}
          onCerrar={() => setRechazo(null)}
        >
          <div className="formulario">
            <label className="campo-ancho">
              <span>Motivo</span>
              <input
                className="entrada"
                value={rechazo.motivo}
                onChange={(evento) => setRechazo({ ...rechazo, motivo: evento.target.value })}
              />
            </label>
          </div>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setRechazo(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="boton boton--acento"
              onClick={() => void confirmarRechazo()}
              disabled={guardando}
            >
              {guardando ? 'Guardando…' : 'Rechazar'}
            </button>
          </div>
        </Modal>
      ) : null}

      {/* ---------- Movimientos del producto (solo desde Productos) ---------- */}
      {kardex ? (
        <Modal
          titulo="Movimientos del producto"
          nota={`${kardex.sku} · ${kardex.nombre} · todo lo que entro y salio`}
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
                      <td>{ETIQUETA_MOVIMIENTO[movimiento.tipo] ?? movimiento.tipo}</td>
                      <td className="numero">
                        {MOVIMIENTOS_QUE_RESTAN.has(movimiento.tipo)
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

      {/* ---------- Agregar producto al inventario desde el catalogo ---------- */}
      {altaAbierta ? (
        <AltaInventario
          sesion={sesion}
          sucursalId={sucursalId}
          onCerrar={() => setAltaAbierta(false)}
          onGuardado={alGuardarMovimiento}
        />
      ) : null}
    </div>
  );
}
