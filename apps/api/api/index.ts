/**
 * Punto de entrada del API en Vercel.
 *
 * Este archivo a proposito NO importa casi nada: todo lo demas se carga de forma
 * diferida dentro de un `try`. Asi, si algo falla al cargar o al arrancar (un paquete
 * que no viaja en el empaquetado, una variable mal puesta, la base de datos
 * inalcanzable), en vez de la pagina generica "A server error has occurred" se
 * responde **el motivo real** en JSON.
 *
 * El nombre `index.ts` es el que Vercel reconoce sin ambiguedad. Como una sola funcion
 * recibe todas las rutas, `vercel.json` reescribe `/api/(.*)` hacia aqui pasando la
 * ruta original en el parametro `ruta`.
 */

/** Mensaje legible recorriendo la cadena de causas. */
function detalleDe(error: unknown): string {
  const mensajes: string[] = [];
  let actual: unknown = error;

  for (let nivel = 0; nivel < 6 && actual instanceof Error; nivel += 1) {
    mensajes.push(`${actual.name}: ${actual.message}`);
    actual = (actual as { cause?: unknown }).cause;
  }

  return mensajes.length > 0 ? [...new Set(mensajes)].join(' | ') : String(error);
}

interface PeticionEntrante {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

interface RespuestaSaliente {
  status(codigo: number): RespuestaSaliente;
  setHeader(nombre: string, valor: number | string | readonly string[]): unknown;
  send(cuerpo?: unknown): unknown;
}

export default async function manejador(
  peticion: PeticionEntrante,
  respuesta: RespuestaSaliente,
): Promise<void> {
  try {
    const { manejadorVercel } = await import('../src/vercel.js');
    await manejadorVercel(peticion, respuesta);
  } catch (error) {
    const detalle = detalleDe(error);
    console.error('Fallo al atender la peticion:', detalle);

    try {
      respuesta.status(500).send({
        error: {
          codigo: 'ARRANQUE_FALLIDO',
          mensaje: 'El API no pudo atender la peticion.',
          detalle,
        },
      });
    } catch {
      // Si la respuesta ya se habia enviado no hay nada mas que hacer.
    }
  }
}
