/**
 * Punto de entrada del API en Vercel.
 *
 * Se usa un nombre simple (`api/index.ts`) porque es el que Vercel reconoce sin
 * ambiguedad. Como una sola funcion recibe todas las rutas, `vercel.json` reescribe
 * `/api/(.*)` a `/api/index?ruta=$1`, de modo que aqui se reconstruye la direccion
 * original (`/api/v1/health`).
 *
 * Toda la logica vive en `src/vercel.ts`, para poder probarla en local con las mismas
 * pruebas que el resto del sistema.
 */
import { manejadorVercel } from '../src/vercel.js';

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

export default function manejador(
  peticion: PeticionEntrante,
  respuesta: RespuestaSaliente,
): Promise<void> {
  return manejadorVercel(peticion, respuesta);
}
