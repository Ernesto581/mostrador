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

/**
 * Punto de entrada del API en Vercel.
 *
 * El nombre con corchetes hace que Vercel entregue cualquier ruta bajo `/api`:
 * `/api/v1/products` llega como `ruta = ['v1', 'products']`.
 *
 * Toda la logica vive en @mostrador/api (apps/api/src/vercel.ts), para que se pueda
 * probar en local con las mismas pruebas que el resto del sistema.
 */
import { manejadorVercel } from '../apps/api/src/vercel.js';

export default function manejador(
  peticion: PeticionEntrante,
  respuesta: RespuestaSaliente,
): Promise<void> {
  return manejadorVercel(peticion, respuesta);
}
