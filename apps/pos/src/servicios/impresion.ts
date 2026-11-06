import type { MetodoPago, Sesion, VentaRespuesta } from '../api/tipos';

/**
 * Impresion de tickets.
 *
 * Tres caminos para que funcione con cualquier impresora:
 *  - `navegador`: abre el dialogo del sistema. Sirve con USB, Bluetooth o red,
 *    siempre que la impresora este instalada en el equipo. Es el modo por defecto.
 *  - `usb`: WebUSB, para impresoras ESC/POS conectadas por cable (Chrome/Edge).
 *  - `bluetooth`: Web Bluetooth, para impresoras ESC/POS inalambricas (Chrome/Edge).
 *
 * El ticket se arma una sola vez y se usa tanto para el papel termico como para
 * la vista previa. El texto se convierte a ASCII porque las impresoras baratas no
 * entienden UTF-8: "Devolucion" sale bien, "Devolución" saldria con simbolos raros.
 */

export type ModoImpresion = 'navegador' | 'usb' | 'bluetooth';
export type AnchoPapel = 58 | 80;

export interface ConfigImpresora {
  modo: ModoImpresion;
  ancho: AnchoPapel;
}

export interface LineaTicket {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  total: number;
}

export interface PagoTicket {
  metodo: MetodoPago;
  monto: number;
}

export interface DatosTicket {
  empresa: string;
  sucursal: string;
  direccion?: string | null;
  telefono?: string | null;
  moneda: string;
  folio: string;
  fecha: string;
  vendedor?: string | null;
  lineas: LineaTicket[];
  subtotal: number;
  descuentoTotal: number;
  impuestos: number;
  total: number;
  pagado: number;
  cambio: number;
  pagos: PagoTicket[];
}

const CLAVE_CONFIG = 'mostrador.impresora';
const CONFIG_POR_DEFECTO: ConfigImpresora = { modo: 'navegador', ancho: 58 };

const ETIQUETA_PAGO: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
};

export function leerConfigImpresora(): ConfigImpresora {
  if (typeof localStorage === 'undefined') {
    return { ...CONFIG_POR_DEFECTO };
  }

  try {
    const guardada = JSON.parse(localStorage.getItem(CLAVE_CONFIG) ?? 'null') as
      | Partial<ConfigImpresora>
      | null;

    const modo =
      guardada?.modo === 'usb' || guardada?.modo === 'bluetooth' || guardada?.modo === 'navegador'
        ? guardada.modo
        : CONFIG_POR_DEFECTO.modo;
    const ancho = guardada?.ancho === 80 ? 80 : 58;

    return { modo, ancho };
  } catch {
    return { ...CONFIG_POR_DEFECTO };
  }
}

export function guardarConfigImpresora(config: ConfigImpresora): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(CLAVE_CONFIG, JSON.stringify(config));
}

export function estadoSoporte(): { navegador: boolean; usb: boolean; bluetooth: boolean } {
  return {
    navegador: true,
    usb: Boolean(interfazUsb()),
    bluetooth: Boolean(interfazBluetooth()),
  };
}

/** Convierte una venta recien cobrada en los datos que entiende el ticket. */
export function datosTicketDesdeVenta(
  venta: VentaRespuesta,
  sesion: Sesion,
  sucursalId: string,
): DatosTicket {
  const sucursal = sesion.sucursales.find((opcion) => opcion.id === sucursalId);
  return {
    empresa: sesion.empresa.nombre,
    sucursal: sucursal?.nombre ?? sucursalId,
    direccion: sucursal?.direccion ?? null,
    telefono: sucursal?.telefono ?? null,
    moneda: sesion.empresa.moneda,
    folio: venta.folio,
    fecha: venta.vendidoEn,
    vendedor: sesion.usuario.nombre,
    lineas: venta.lineas.map((linea) => ({
      nombre: linea.nombre,
      cantidad: linea.cantidad,
      precioUnitario: linea.precioUnitario,
      descuento: linea.descuento,
      total: linea.total,
    })),
    subtotal: venta.subtotal,
    descuentoTotal: venta.descuentoTotal,
    impuestos: venta.impuestos,
    total: venta.total,
    pagado: venta.pagado,
    cambio: venta.cambio,
    pagos: venta.pagos.map((pago) => ({ metodo: pago.metodo, monto: pago.monto })),
  };
}

export function lineasTicket(datos: DatosTicket, ancho: AnchoPapel): string[] {
  const columnas = ancho === 80 ? 48 : 32;
  const lineas: string[] = [];
  const separador = '-'.repeat(columnas);

  lineas.push(centrar(datos.empresa, columnas));
  if (datos.direccion) {
    lineas.push(...envolver(datos.direccion, columnas).map((linea) => centrar(linea, columnas)));
  }
  if (datos.telefono) {
    lineas.push(centrar(`Tel. ${datos.telefono}`, columnas));
  }

  lineas.push(separador);
  lineas.push(centrar('TICKET DE VENTA', columnas));
  lineas.push(`Folio: ${datos.folio}`);
  lineas.push(`Fecha: ${fechaCorta(datos.fecha)}`);
  lineas.push(`Sucursal: ${datos.sucursal}`);
  if (datos.vendedor) {
    lineas.push(`Vendedor: ${datos.vendedor}`);
  }
  lineas.push(separador);

  for (const linea of datos.lineas) {
    for (const parte of envolver(linea.nombre, columnas)) {
      lineas.push(parte);
    }
    const izquierda = `  ${linea.cantidad} x ${monto(linea.precioUnitario)}`;
    lineas.push(izquierdaDerecha(izquierda, monto(linea.total), columnas));
    if (linea.descuento > 0) {
      lineas.push(izquierdaDerecha('  Descuento', `-${monto(linea.descuento)}`, columnas));
    }
  }

  lineas.push(separador);
  lineas.push(izquierdaDerecha('Subtotal', monto(datos.subtotal), columnas));
  if (datos.descuentoTotal > 0) {
    lineas.push(izquierdaDerecha('Descuento', `-${monto(datos.descuentoTotal)}`, columnas));
  }
  if (datos.impuestos > 0) {
    lineas.push(izquierdaDerecha('Impuesto incluido', monto(datos.impuestos), columnas));
  }
  lineas.push(izquierdaDerecha('TOTAL', monto(datos.total), columnas));
  lineas.push(separador);

  for (const pago of datos.pagos) {
    lineas.push(izquierdaDerecha(ETIQUETA_PAGO[pago.metodo], monto(pago.monto), columnas));
  }
  if (datos.cambio > 0) {
    lineas.push(izquierdaDerecha('Cambio', monto(datos.cambio), columnas));
  }

  lineas.push(separador);
  lineas.push(centrar('Gracias por su compra', columnas));
  lineas.push(...envolver('Conserve su ticket para cualquier reclamo.', columnas).map((linea) => centrar(linea, columnas)));
  lineas.push('');
  lineas.push(centrar(datos.moneda, columnas));

  return lineas;
}

/** Comandos ESC/POS listos para enviar por USB o Bluetooth. */
export function construirEscPos(datos: DatosTicket, ancho: AnchoPapel): Uint8Array {
  const bytes: number[] = [];
  const escribir = (...valores: number[]): void => {
    bytes.push(...valores);
  };
  const texto = (contenido: string): void => {
    for (const caracter of limpiarTexto(contenido)) {
      escribir(caracter.charCodeAt(0));
    }
    escribir(0x0a);
  };

  escribir(0x1b, 0x40); // inicializar
  escribir(0x1b, 0x61, 0x00); // alinear a la izquierda
  for (const linea of lineasTicket(datos, ancho)) {
    texto(linea);
  }
  escribir(0x1b, 0x64, 0x03); // avanzar 3 lineas
  escribir(0x1d, 0x56, 0x42, 0x00); // corte parcial

  return new Uint8Array(bytes);
}

/** Dibuja el ticket en una ventana oculta y abre el dialogo de impresion. */
export function imprimirEnNavegador(datos: DatosTicket, ancho: AnchoPapel): Promise<void> {
  const lineas = lineasTicket(datos, ancho);
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Ticket ${escaparHtml(datos.folio)}</title>
<style>
  @page { size: ${ancho}mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { width: ${ancho}mm; }
  pre {
    margin: 0;
    padding: 2mm;
    font-family: "Courier New", "Consolas", monospace;
    font-size: ${ancho === 80 ? 11 : 9.5}px;
    line-height: 1.25;
    white-space: pre;
  }
</style>
</head>
<body><pre>${escaparHtml(lineas.join('\n'))}</pre></body>
</html>`;

  return new Promise((resolver, rechazar) => {
    const marco = document.createElement('iframe');
    marco.setAttribute('aria-hidden', 'true');
    marco.style.position = 'fixed';
    marco.style.right = '0';
    marco.style.bottom = '0';
    marco.style.width = '0';
    marco.style.height = '0';
    marco.style.border = '0';

    marco.onload = () => {
      const ventana = marco.contentWindow;
      if (!ventana) {
        marco.remove();
        rechazar(new Error('El navegador no permitio abrir la impresion'));
        return;
      }
      try {
        ventana.focus();
        ventana.print();
        resolver();
      } catch (error) {
        rechazar(error instanceof Error ? error : new Error('No se pudo imprimir'));
      } finally {
        window.setTimeout(() => marco.remove(), 1000);
      }
    };

    marco.srcdoc = html;
    document.body.appendChild(marco);
  });
}

/* ---------- WebUSB ---------- */

interface UsbEndpointLike {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: 'bulk' | 'interrupt' | 'isochronous';
}

interface UsbAlternateLike {
  alternateSetting: number;
  interfaceClass: number;
  endpoints: UsbEndpointLike[];
}

interface UsbInterfaceLike {
  alternates: UsbAlternateLike[];
  claimed: boolean;
  claim(): Promise<void>;
  release(): Promise<void>;
}

interface UsbConfigurationLike {
  interfaces: UsbInterfaceLike[];
}

interface UsbDeviceLike {
  configuration: UsbConfigurationLike | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(valor: number): Promise<void>;
  transferOut(extremo: number, datos: Uint8Array): Promise<unknown>;
}

interface UsbLike {
  requestDevice(opciones: { filters: Record<string, unknown>[] }): Promise<UsbDeviceLike>;
  getDevices(): Promise<UsbDeviceLike[]>;
}

function interfazUsb(): UsbLike | undefined {
  return (navigator as Navigator & { usb?: UsbLike }).usb;
}

let dispositivoUsb: UsbDeviceLike | null = null;
let extremoUsb: number | null = null;

export async function conectarUsb(): Promise<void> {
  const usb = interfazUsb();
  if (!usb) {
    throw new Error('Este navegador no soporta USB. Usa Chrome o Edge, o imprime desde el navegador.');
  }

  const dispositivo = await usb.requestDevice({ filters: [{ classCode: 7 }, {}] });
  await abrirUsb(dispositivo);
}

async function abrirUsb(dispositivo: UsbDeviceLike): Promise<void> {
  await dispositivo.open();
  if (!dispositivo.configuration) {
    await dispositivo.selectConfiguration(1);
  }

  const interfaces = dispositivo.configuration?.interfaces ?? [];
  for (const cara of interfaces) {
    for (const alternativa of cara.alternates) {
      const salida = alternativa.endpoints.find(
        (extremo) => extremo.direction === 'out' && extremo.type === 'bulk',
      );
      if (salida) {
        if (!cara.claimed) {
          await cara.claim();
        }
        dispositivoUsb = dispositivo;
        extremoUsb = salida.endpointNumber;
        return;
      }
    }
  }

  await dispositivo.close();
  throw new Error('La impresora no expone una salida USB compatible');
}

async function asegurarUsb(): Promise<{ dispositivo: UsbDeviceLike; extremo: number }> {
  if (dispositivoUsb && extremoUsb !== null) {
    return { dispositivo: dispositivoUsb, extremo: extremoUsb };
  }

  const usb = interfazUsb();
  const autorizados = usb ? await usb.getDevices() : [];
  for (const dispositivo of autorizados) {
    try {
      await abrirUsb(dispositivo);
      if (dispositivoUsb && extremoUsb !== null) {
        return { dispositivo: dispositivoUsb, extremo: extremoUsb };
      }
    } catch {
      // Se prueba con el siguiente dispositivo autorizado.
    }
  }

  throw new Error('Conecta la impresora USB desde Configuracion > Impresora');
}

async function enviarUsb(datos: Uint8Array): Promise<void> {
  const { dispositivo, extremo } = await asegurarUsb();
  const tamano = 64;
  for (let inicio = 0; inicio < datos.length; inicio += tamano) {
    await dispositivo.transferOut(extremo, datos.slice(inicio, inicio + tamano));
  }
}

/* ---------- Web Bluetooth ---------- */

interface BluetoothCaracteristicaLike {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValue(datos: Uint8Array): Promise<void>;
  writeValueWithoutResponse?(datos: Uint8Array): Promise<void>;
}

interface BluetoothServicioLike {
  getCharacteristics(): Promise<BluetoothCaracteristicaLike[]>;
}

interface BluetoothServidorLike {
  getPrimaryServices(): Promise<BluetoothServicioLike[]>;
}

interface BluetoothDeviceLike {
  name?: string;
  gatt?: {
    connect(): Promise<BluetoothServidorLike>;
    disconnect(): void;
  };
}

interface BluetoothLike {
  requestDevice(opciones: {
    acceptAllDevices: boolean;
    optionalServices: string[];
  }): Promise<BluetoothDeviceLike>;
}

const SERVICIOS_BLUETOOTH = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ffb0-0000-1000-8000-00805f9b34fb',
];

function interfazBluetooth(): BluetoothLike | undefined {
  return (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth;
}

let caracteristicaBluetooth: BluetoothCaracteristicaLike | null = null;

export async function conectarBluetooth(): Promise<void> {
  const bluetooth = interfazBluetooth();
  if (!bluetooth) {
    throw new Error('Este navegador no soporta Bluetooth. Usa Chrome o Edge, o imprime desde el navegador.');
  }

  const dispositivo = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: SERVICIOS_BLUETOOTH,
  });

  const servidor = await dispositivo.gatt?.connect();
  if (!servidor) {
    throw new Error('No se pudo conectar con la impresora Bluetooth');
  }

  const servicios = await servidor.getPrimaryServices();
  for (const servicio of servicios) {
    const caracteristicas = await servicio.getCharacteristics();
    for (const caracteristica of caracteristicas) {
      if (caracteristica.properties.write || caracteristica.properties.writeWithoutResponse) {
        caracteristicaBluetooth = caracteristica;
        return;
      }
    }
  }

  throw new Error('La impresora Bluetooth no tiene una caracteristica de escritura');
}

async function enviarBluetooth(datos: Uint8Array): Promise<void> {
  if (!caracteristicaBluetooth) {
    throw new Error('Conecta la impresora Bluetooth desde Configuracion > Impresora');
  }

  const tamano = 100;
  for (let inicio = 0; inicio < datos.length; inicio += tamano) {
    const trozo = datos.slice(inicio, inicio + tamano);
    if (
      caracteristicaBluetooth.properties.writeWithoutResponse &&
      caracteristicaBluetooth.writeValueWithoutResponse
    ) {
      await caracteristicaBluetooth.writeValueWithoutResponse(trozo);
    } else {
      await caracteristicaBluetooth.writeValue(trozo);
    }
  }
}

/* ---------- API publica ---------- */

export async function imprimirTicket(
  datos: DatosTicket,
  config: ConfigImpresora = leerConfigImpresora(),
): Promise<void> {
  if (config.modo === 'navegador') {
    await imprimirEnNavegador(datos, config.ancho);
    return;
  }

  const bytes = construirEscPos(datos, config.ancho);

  if (config.modo === 'usb') {
    await enviarUsb(bytes);
    return;
  }

  await enviarBluetooth(bytes);
}

/** Ticket de ejemplo para comprobar la impresora. */
export async function probarImpresion(config: ConfigImpresora = leerConfigImpresora()): Promise<void> {
  const ahora = new Date();
  await imprimirTicket(
    {
      empresa: 'Mostrador',
      sucursal: 'Prueba de impresion',
      direccion: 'Si lees esto, la impresora esta lista',
      telefono: null,
      moneda: 'CUP',
      folio: 'PRUEBA-0001',
      fecha: ahora.toISOString(),
      vendedor: 'Sistema',
      lineas: [
        { nombre: 'Producto de ejemplo', cantidad: 2, precioUnitario: 1500, descuento: 0, total: 3000 },
      ],
      subtotal: 3000,
      descuentoTotal: 0,
      impuestos: 0,
      total: 3000,
      pagado: 5000,
      cambio: 2000,
      pagos: [{ metodo: 'efectivo', monto: 5000 }],
    },
    config,
  );
}

/* ---------- Utilidades ---------- */

function monto(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

function fechaCorta(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) {
    return iso;
  }
  return fecha.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function centrar(texto: string, columnas: number): string {
  const limpio = texto.slice(0, columnas);
  const sobra = Math.max(0, columnas - limpio.length);
  const izquierda = Math.floor(sobra / 2);
  return `${' '.repeat(izquierda)}${limpio}`;
}

function izquierdaDerecha(izquierda: string, derecha: string, columnas: number): string {
  const espacio = Math.max(1, columnas - izquierda.length - derecha.length);
  return `${izquierda.slice(0, columnas)}${' '.repeat(espacio)}${derecha}`.slice(0, columnas);
}

function envolver(texto: string, columnas: number): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean);
  if (palabras.length === 0) {
    return [''];
  }

  const lineas: string[] = [];
  let actual = '';

  for (const palabra of palabras) {
    if (palabra.length > columnas) {
      if (actual) {
        lineas.push(actual);
        actual = '';
      }
      for (let inicio = 0; inicio < palabra.length; inicio += columnas) {
        lineas.push(palabra.slice(inicio, inicio + columnas));
      }
      continue;
    }

    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (candidata.length > columnas) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = candidata;
    }
  }

  if (actual) {
    lineas.push(actual);
  }
  return lineas;
}

function limpiarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/×/g, 'x')
    .replace(/[^\x20-\x7e]/g, '?');
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
