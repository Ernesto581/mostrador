import type { ZodError, ZodType } from 'zod';

/** Error con codigo HTTP y codigo de negocio, para responder de forma uniforme. */
export class ErrorDeAplicacion extends Error {
  constructor(
    mensaje: string,
    readonly statusCode: number,
    readonly codigo: string,
  ) {
    super(mensaje);
    this.name = 'ErrorDeAplicacion';
  }
}

export class ErrorDeValidacion extends ErrorDeAplicacion {
  constructor(readonly detalle: ZodError) {
    super('Los datos enviados no son validos', 422, 'DATOS_INVALIDOS');
    this.name = 'ErrorDeValidacion';
  }
}

export class ErrorDeAutenticacion extends ErrorDeAplicacion {
  constructor(mensaje = 'Usuario o contrasena incorrectos') {
    super(mensaje, 401, 'SIN_ACCESO');
    this.name = 'ErrorDeAutenticacion';
  }
}

export class ErrorNoEncontrado extends ErrorDeAplicacion {
  constructor(mensaje = 'No se encontro el recurso') {
    super(mensaje, 404, 'NO_ENCONTRADO');
    this.name = 'ErrorNoEncontrado';
  }
}

export class ErrorSinPermiso extends ErrorDeAplicacion {
  constructor(mensaje = 'No tienes permiso para esta accion') {
    super(mensaje, 403, 'SIN_PERMISO');
    this.name = 'ErrorSinPermiso';
  }
}

/** Valida datos de entrada y lanza un error claro si no cumplen. */
export function validar<T>(esquema: ZodType<T>, datos: unknown): T {
  const resultado = esquema.safeParse(datos);
  if (!resultado.success) {
    throw new ErrorDeValidacion(resultado.error);
  }
  return resultado.data;
}
