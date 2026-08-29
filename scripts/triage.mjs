#!/usr/bin/env node
// ¿De qué CLASE es esta petición, y qué es obligatorio antes de actuar?
//
//   node scripts/triage.mjs --hook     # lee el JSON del UserPromptSubmit por stdin
//   node scripts/triage.mjs "texto"    # a mano, para ver qué clasificaría
//
// POR QUE ESTO ES UN HOOK Y NO UNA LINEA EN CLAUDE.md
// ---------------------------------------------------
// Es la regla 17 del propio proyecto: «una comprobación que no corre sola no
// existe». Una instrucción en CLAUDE.md ("revisa siempre antes de actuar") es
// PROSA: compite con otras 1.400 líneas y se cumple mientras alguien la
// recuerde. Un `UserPromptSubmit` lo dispara el harness en CADA mensaje, no el
// modelo, así que no depende de que nadie se acuerde.
//
// LO QUE ESTE FICHERO **NO** PUEDE HACER, Y HAY QUE SABERLO
// --------------------------------------------------------
// Es un comando de shell: casa patrones, NO entiende la petición. No sabe si lo
// que pides es buena idea. Sólo decide **qué clase de cosa parece** y, con eso,
// **a qué agente hay que pasarla**. El juicio lo pone el agente; esto sólo
// garantiza que se le llame. Separar las dos cosas es el diseño entero:
//
//   hook  = corre siempre, no razona   -> pone la OBLIGACION
//   agente= razona, no corre solo      -> pone el JUICIO
//
// Y CALLA CUANDO NO HAY NADA QUE DECIR
// ------------------------------------
// Una pregunta normal no imprime nada. Es deliberado y es la lección del
// preflight (patrón B de revision-2026-08-22.md): un aviso que sale siempre se
// deja de leer en una semana, y entonces tampoco se lee el que importaba. Si
// esto hablara en cada mensaje, en quince días sería ruido de fondo.

const AGENTES = {
  revisor: 'revisor',
  arquitecto: 'arquitecto',
  verificador: 'verificador',
};

// Las clases van de MAS grave a menos: la primera que casa manda. El orden
// importa -- "destruye los droplets" es gasto Y destructivo, y lo que hay que
// leer primero es que cuesta dinero.
const CLASES = [
  {
    clase: 'gasto',
    // Cualquier cosa que pueda encender, apagar o facturar recursos ajenos.
    // Los plurales van explícitos: `\bdroplet\b` NO casa con "droplets", así que
    // "destruye los droplets" caía en `destructivo` y se perdía el aviso de que
    // eso cuesta dinero. Lo encontró el test, no la lectura.
    //
    // ⚠ El VERBO + «estudio/tanteo/recorrido» entró el 2026-08-29, y el hueco lo
    // encontró ejecutar el comando que `docs/agentes.md` promete. `lanza el
    // estudio do-v` -- que es LA tarea pendiente de CLAUDE.md, ≈1,1 $ y 20 runs
    // en máquinas alquiladas -- salía `consulta`: ni revisor, ni aviso de que
    // cuesta dinero. Sobrevivió porque el test decía `lanza el estudio do-v EN LA
    // FLOTA`, y ahí lo que casaba era «flota»: la prueba había elegido, sin
    // querer, la única redacción que pasaba.
    //
    // Va con verbo y no suelto A PROPÓSITO: un `estudios?` a secas convertiría
    // «¿qué dice el reporte del estudio de dropout?» en una alarma de gasto, y un
    // aviso que salta con cualquier pregunta se deja de leer (patrón B). Tiene
    // test por los dos lados: el que tiene que saltar y el que no.
    patron: /\b(alquil\w*|vast|droplets?|flotas?|estudio_flota|bench_fleet|instancias?|barrid\w+|(lanz\w+|corre|correr|arranc\w+|ejecut\w+|repit\w+|repetir)\s+(el\s+|un\s+|los\s+|la\s+)?(estudios?|tanteos?|recorridos?|sweeps?)|lanzar?\s+(un\s+)?(server|servidor|m[áa]quinas?)|launch|destroy|reap)\b/i,
    titulo: '💸 GASTO O RECURSOS EN LA NUBE',
    obliga: [AGENTES.revisor],
    // Reglas de docs/reglas-de-diseno.md que gobiernan esto.
    reglas: ['R11 (quien enciende tiene que poder apagar)',
             'R12 (lo efímero se registra según ocurre)',
             'R13 (el criterio se escribe antes de mirar)'],
    exige: [
      'NO ejecutes nada todavía. Pasa la petición por el agente `revisor` primero.',
      'Di qué se va a alquilar, cuánto cuesta y quién lo apaga si esta máquina muere.',
      'Si no puedes contestar a las tres, no se lanza.',
    ],
  },
  {
    clase: 'destructivo',
    patron: /(\brm\b|--force|-f\b|reset\s+--hard|\bdrop\b|\bborra\w*|\belimina\w*|\bpurga\w*|\bdestru\w+|sobrescrib\w+|\bpisa\w+)/i,
    titulo: '🔥 DESTRUCTIVO O IRREVERSIBLE',
    obliga: [AGENTES.revisor],
    reglas: ['R9 (un dato que no se puede re-derivar y no se guarda, se pierde)',
             'R16 (la identidad la da un dato comprobable, no un nombre)'],
    exige: [
      'MIRA el destino antes de tocarlo, y di qué hay ahí.',
      'Comprueba que es TUYO (workspace, prefijo, cwd), no de otra sesión.',
      'Confirma con el usuario antes de ejecutar.',
    ],
  },
  {
    clase: 'estructura',
    patron: /(repo\s+nuevo|nuevo\s+repo|crear?\s+(un\s+)?(repo|m[óo]dulo|paquete|servicio)|\bmigra\w*|\brenombra\w*|\brefactoriza\w*|\bsepara\w+|\barquitectura\b|\bdise[ñn]\w*|d[óo]nde\s+(lo\s+)?(guardo|va|vive|pongo|dejo)|estructura\s+d[e']|\bmover\b\s+.*\b(a|hacia)\b|\bacopl\w+|\binterfaz\b|\bcontrato\b)/i,
    titulo: '🏗 DECISIÓN DE ESTRUCTURA',
    obliga: [AGENTES.arquitecto],
    reglas: ['entra por § 0 de docs/reglas-de-diseno.md: la tabla va de TU ACCIÓN a sus reglas'],
    exige: [
      'Pasa por el agente `arquitecto` ANTES de escribir código.',
      'Nombra explícitamente qué reglas de las 19 aplican, y si alguna choca, DILO.',
    ],
  },
  {
    clase: 'implementacion',
    patron: /(\bimplementa\w*|\ba[ñn]ade\w*|\bagrega\w*|\bescribe\b|\bcrea\w*\b|\barregla\w*|\bcorrige\w*|\bmodifica\w*|\bcambia\w*|haz\s+que|\bprograma\b)/i,
    titulo: '🔧 IMPLEMENTACIÓN',
    obliga: [AGENTES.verificador],
    reglas: ['R10 (el esfuerzo de prueba se reparte por consecuencia del fallo)',
             'R17 (una comprobación que no corre sola no existe)'],
    exige: [
      'Antes de decir «hecho», pasa por el agente `verificador`: un comando documentado se EJECUTA antes de presentarlo como verificado.',
      'Si el cambio puede empezar o parar un gasto, su freno va en el MISMO commit.',
    ],
  },
];

/** La clase de una petición, o null si es una consulta normal. */
export function clasificar(texto) {
  const t = String(texto ?? '');
  if (!t.trim()) return null;
  for (const c of CLASES) if (c.patron.test(t)) return c;
  return null;
}

/** El texto que se inyecta en el contexto. Cadena vacía = no molestar. */
export function aviso(texto) {
  const c = clasificar(texto);
  if (!c) return '';
  const lineas = [
    `${c.titulo} — triage automático (scripts/triage.mjs), no es opcional.`,
    '',
    ...c.exige.map((e) => `- ${e}`),
    '',
    `Reglas que aplican: ${c.reglas.join(' · ')}`,
    `Agente obligatorio: \`${c.obliga.join('`, `')}\`  (Agent tool, subagent_type)`,
    '',
    '⚠ El triage casa PATRONES, no entiende la petición: puede equivocarse de clase.',
    'Si no aplica, dilo en una línea y sigue — pero dilo, no lo ignores en silencio.',
  ];
  return lineas.join('\n');
}

async function leerStdin() {
  if (process.stdin.isTTY) return '';
  let d = '';
  for await (const trozo of process.stdin) d += trozo;
  return d;
}

async function main() {
  const args = process.argv.slice(2);
  const esHook = args.includes('--hook');

  let texto = args.filter((a) => !a.startsWith('--')).join(' ');
  if (esHook || !texto) {
    const crudo = await leerStdin();
    try {
      texto = JSON.parse(crudo)?.prompt ?? texto;
    } catch {
      texto = crudo || texto;          // a mano, por tubería, sin JSON
    }
  }

  const texto_ = aviso(texto);

  if (esHook) {
    // La envoltura que el harness sabe leer. Sin aviso, no se imprime nada:
    // un objeto vacío es "no tengo nada que decir", no un fallo.
    if (texto_) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: texto_,
        },
      }));
    }
    return 0;
  }

  const c = clasificar(texto);
  console.log(c ? `clase: ${c.clase}\n\n${texto_}` : 'clase: consulta (no obliga a nada)');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((c) => process.exit(c)).catch((e) => {
    // Un hook que revienta NO puede impedir que el usuario mande su mensaje.
    // Misma regla que el SessionStart de sesiones.mjs: sale con 0 pase lo que
    // pase, y si algo falla se queja por stderr, que no va al contexto.
    console.error(`triage: ${e?.message ?? e}`);
    process.exit(0);
  });
}
