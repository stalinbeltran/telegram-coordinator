// Punto de entrada. Todo el bot vive en `bot.ts`, que se puede importar sin
// arrancar nada: es lo que permite probar el camino real de un mensaje sin red.
import { arrancar } from './bot.js';

arrancar().catch((err) => {
  console.error('Fallo fatal al iniciar:', err);
  process.exit(1);
});
