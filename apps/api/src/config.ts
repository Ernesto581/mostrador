import { z } from 'zod';

const NIVELES_LOG = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const ENTORNOS = ['development', 'test', 'production'] as const;

const EsquemaConfig = z.object({
  NODE_ENV: z.enum(ENTORNOS).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(NIVELES_LOG).default('info'),
  /** Si esta presente, se usa PostgreSQL real. Si no, PGlite. */
  DATABASE_URL: z.string().min(1).optional(),
  /** Directorio de PGlite. Sin valor, la base vive en memoria. */
  PGLITE_DIR: z.string().min(1).optional(),
  /** Origenes permitidos para el navegador, separados por coma. Vacio = todos. */
  CORS_ORIGIN: z.string().optional(),
  /**
   * Aplica las migraciones al arrancar.
   *
   * En local conviene (true). En un servidor sin estado (Vercel) NO: la carpeta de
   * migraciones no viaja dentro del paquete, cada arranque intentaria migrar y varias
   * instancias podrian pisarse. Ahi se migra desde la maquina de desarrollo con
   * `npm run db:migrate`, y esto se deja en false.
   *
   * Se lee de forma tolerante: cualquier cosa que no sea "true" significa que no.
   * Un valor mal escrito no debe tumbar la aplicacion.
   */
  MIGRAR_AL_ARRANCAR: z
    .string()
    .default('false')
    .transform((valor) => valor.trim().toLowerCase() === 'true'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres').optional(),
  JWT_EXPIRA: z.string().min(1).default('12h'),
});

export interface Config {
  NODE_ENV: (typeof ENTORNOS)[number];
  PORT: number;
  HOST: string;
  LOG_LEVEL: (typeof NIVELES_LOG)[number];
  DATABASE_URL?: string;
  PGLITE_DIR?: string;
  CORS_ORIGIN?: string;
  MIGRAR_AL_ARRANCAR: boolean;
  JWT_SECRET: string;
  JWT_EXPIRA: string;
}

const SECRETO_SOLO_DESARROLLO = 'secreto-solo-para-desarrollo-no-usar-en-produccion';

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const resultado = EsquemaConfig.safeParse(env);

  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((problema) => `${problema.path.join('.')}: ${problema.message}`)
      .join(' | ');
    throw new Error(`Configuracion invalida -> ${detalle}`);
  }

  const datos = resultado.data;
  const secreto =
    datos.JWT_SECRET ?? (datos.NODE_ENV === 'production' ? undefined : SECRETO_SOLO_DESARROLLO);
  if (!secreto) {
    throw new Error('Falta JWT_SECRET: es obligatorio en produccion');
  }

  return {
    NODE_ENV: datos.NODE_ENV,
    PORT: datos.PORT,
    HOST: datos.HOST,
    LOG_LEVEL: datos.LOG_LEVEL,
    MIGRAR_AL_ARRANCAR: datos.MIGRAR_AL_ARRANCAR,
    JWT_SECRET: secreto,
    JWT_EXPIRA: datos.JWT_EXPIRA,
    ...(datos.DATABASE_URL !== undefined ? { DATABASE_URL: datos.DATABASE_URL } : {}),
    ...(datos.PGLITE_DIR !== undefined ? { PGLITE_DIR: datos.PGLITE_DIR } : {}),
    ...(datos.CORS_ORIGIN !== undefined ? { CORS_ORIGIN: datos.CORS_ORIGIN } : {}),
  };
}
