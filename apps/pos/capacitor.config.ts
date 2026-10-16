import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Configuracion de la app de Android.
 *
 * La aplicacion web se empaqueta tal cual dentro del APK. El almacenamiento del
 * telefono (catalogo, cola de ventas, turno) sigue funcionando igual, asi que el modo
 * sin conexion tambien funciona dentro de la app.
 */
const config: CapacitorConfig = {
  appId: 'mx.mostrador.pos',
  appName: 'Mostrador',
  webDir: 'dist',
  android: {
    // Permite que la app siga funcionando con la pantalla encendida durante la venta.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
