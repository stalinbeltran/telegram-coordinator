// Redactar secretos de un texto, definido UNA VEZ.
//
// Lo usan el archivador de conversaciones y el registrador de errores, y los dos
// escriben en el repo de DATOS. Copiar esto en el segundo era la opcion facil y
// la trampa conocida: dos redacciones divergen, y la que se queda corta es la
// que deja el secreto en un sitio del que git no lo suelta.
//
// ⚠ El repo de datos paso a PRIVADO el 2026-09-01 y eso NO afloja nada: privado
// es un permiso, no un borrado. Un secreto que se cuela hay que ROTARLO.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CASA = process.env.COORD_HOME
  || join(new URL('.', import.meta.url).pathname, '..');

// Formas de secreto conocidas. Se usan para redactar Y como REJILLA FINAL: si
// después de redactar sigue casando alguna, la conversación no se guarda.
export const PATRONES = [
  [/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, 'TOKEN-TELEGRAM'],
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, 'CLAVE-ANTHROPIC'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/g, 'TOKEN-GITHUB'],
  [/dop_v1_[a-f0-9]{64}/g, 'TOKEN-DIGITALOCEAN'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'CLAVE-PRIVADA'],
  [/AKIA[0-9A-Z]{16}/g, 'CLAVE-AWS'],
];

export function ficherosDeSecretos() {
  return [join(CASA, '.env'), join(homedir(), '.config', 'dev-secrets.env')];
}

// Qué NOMBRE de variable contiene una credencial. Es la convención de siempre, y
// hace falta porque la longitud NO basta: medido el 2026-08-31, filtrar sólo por
// «>= 12 caracteres» redactaba `CLAUDE_PERMISSION_MODE` (= `bypassPermissions`),
// que es CONFIGURACIÓN y aparece 18 veces en una conversación normal. Redactarlo
// destroza texto útil justo en el archivo que existe para poder leerlo después.
const NOMBRE_ES_SECRETO = /TOKEN|KEY|SECRET|PASS|PWD|CLAVE|CREDENTIAL|AUTH/;

// Longitud mínima para redactar por valor. Un valor corto aparece en cualquier
// texto por casualidad; una credencial real nunca es corta.
const MIN_VALOR = 12;

// Por encima de esto, un valor que NO se redacta se AVISA aunque su nombre no
// parezca de secreto: decidir en silencio en cualquiera de los dos sentidos es
// el fallo, así que lo dudoso lo mira una persona.
const AVISAR_DESDE = 20;

/** Los VALORES a redactar, con su nombre. No se imprimen nunca, sólo se buscan. */
export function valoresSecretos() {
  const redactar = [], dudosos = [];
  for (const f of ficherosDeSecretos()) {
    if (!existsSync(f)) continue;
    for (const linea of readFileSync(f, 'utf8').split('\n')) {
      const m = linea.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const valor = m[2].trim().replace(/^["']|["']$/g, '');
      if (valor.length < MIN_VALOR) continue;
      if (NOMBRE_ES_SECRETO.test(m[1])) redactar.push([valor, m[1]]);
      else if (valor.length >= AVISAR_DESDE) dudosos.push([valor, m[1]]);
    }
  }
  return { redactar, dudosos };
}

export function redactar(texto, secretos) {
  let n = 0;
  for (const [valor, nombre] of secretos) {
    if (!texto.includes(valor)) continue;
    // JSON escapa, así que se busca también la forma escapada del valor
    texto = texto.split(valor).join(`«REDACTADO:${nombre}»`);
    n++;
  }
  for (const [re, etiqueta] of PATRONES) {
    texto = texto.replace(re, () => { n++; return `«REDACTADO:${etiqueta}»`; });
  }
  return { texto, n };
}

/** Lo que queda casando un patrón DESPUÉS de redactar. Vacío = se puede guardar. */
export function loQueSigueSiendoSecreto(texto) {
  const restos = [];
  for (const [re, etiqueta] of PATRONES) {
    const m = texto.match(re);
    if (m) restos.push(`${etiqueta} (${m.length})`);
  }
  return restos;
}
