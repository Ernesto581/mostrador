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

/**
 * Busca el codigo de error de PostgreSQL dentro de la cadena de causas.
 *
 * Drizzle envuelve los errores del driver, asi que el codigo (`23505` duplicado,
 * `23503` referencia invalida) no siempre esta en el error de arriba.
 */
export function codigoDePostgres(error: unknown): string | undefined {
  let actual: unknown = error;
  for (let nivel = 0; nivel < 6 && actual instanceof Error; nivel += 1) {
    const codigo = (actual as { code?: unknown }).code;
    if (typeof codigo === 'string') {
      return codigo;
    }
    actual = (actual as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Envuelve una regla de negocio del dominio.
 *
 * Las reglas lanzan errores simples ("Pago insuficiente", "El descuento no puede
 * superar..."). Aqui se convierten en un error con codigo HTTP 422, para que el
 * cliente reciba una explicacion clara en vez de un "error interno".
 */
export function envolverRegla<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ErrorDeAplicacion) {
      throw error;
    }
    if (error instanceof Error) {
      throw new ErrorDeAplicacion(error.message, 422, 'DATOS_INVALIDOS');
    }
    throw error;
  }
}
