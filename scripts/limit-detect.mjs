// Detección de límite de uso de claude + parseo de la hora de reinicio.
//
// Portado de C:\Desarrollo\claude-auto-retry\claude-retry.mjs, adaptado a este
// proyecto: lo usan el encargado `claude-watch` (para decidir si lanzar la
// reanudación) y el `claude-resumer` (para recalcular cuánto esperar en cada
// reintento). Sin dependencias externas.
//
// La detección tiene DOS capas:
//   1) PATRONES DEFINITIVOS: frases inequívocas del banner real del límite.
//   2) DETECCIÓN ESTADÍSTICA: suma pesos de muchas señales parciales y compara
//      contra un umbral (CLAUDE_DETECTION_PRECISION) para captar variantes nuevas
//      sin disparar falsos positivos cuando claude menciona "rate limit" de pasada.
//
// Variables de entorno (todas opcionales):
//   CLAUDE_DETECTION_PRECISION   (def 0.7)  umbral 0..1 (o 0..100) de la capa 2.
//   CLAUDE_RETRY_MARGIN_SECONDS  (def 30)   margen extra tras la hora de reinicio.
//   CLAUDE_RETRY_FALLBACK_HOURS  (def 5)    espera si no se logra leer la hora.

const PRECISION = parsePrecision(process.env.CLAUDE_DETECTION_PRECISION, 0.7);
const MARGIN_SECONDS = num(process.env.CLAUDE_RETRY_MARGIN_SECONDS, 30);
const FALLBACK_HOURS = num(process.env.CLAUDE_RETRY_FALLBACK_HOURS, 5);

// Capa 1: frases definitivas (suscripción + API 429).
const STRONG_PATTERNS = [
  /usage limit reached/i,
  /claude usage limit/i,
  /\b\d+\s*-?\s*hour limit reached/i,
  /\b(?:session|weekly|daily|account|message|opus|plan)\s+limit\s+reached/i,
  /you'?ve\s+(?:hit|reached|used up|exceeded)\s+your\b[^.\n]{0,40}\blimit/i,
  /\b(?:hit|reached|exceeded)\s+your\s+(?:session|usage|weekly|daily|account|message|plan)\s+limit/i,
  /your\s+limit\s+will\s+reset/i,
  /upgrade\s+to\s+increase\s+your\s+usage\s+limit/i,
  /rate_limit_error/i,
  /\b429\b[^\n]*too many requests/i,
  /too many requests[^\n]*\b429\b/i,
];

// Capa 2: señales ponderadas para variantes no catalogadas.
const WEIGHTED_SIGNALS = [
  { name: 'limit-reached', weight: 0.6, re: /\blimit\s+reached\b/i },
  { name: 'limit-will-reset', weight: 0.7, re: /\blimit\b[^.\n]{0,30}\breset/i },
  { name: 'session-limit', weight: 0.55, re: /\bsession\s+limit\b/i },
  { name: 'usage-limit', weight: 0.55, re: /\busage\s+limit\b/i },
  { name: 'rate-limit', weight: 0.45, re: /\brate[\s_-]?limit\b/i },
  { name: 'weekly-daily-limit', weight: 0.55, re: /\b(?:weekly|daily|monthly|plan|account)\s+limit\b/i },
  { name: 'hour-limit', weight: 0.6, re: /\b\d+\s*-?\s*hour\s+limit\b/i },
  { name: 'hit-reached-your', weight: 0.55, re: /\b(?:hit|reached|exceeded|used\s+up)\s+your\b[^.\n]{0,40}\blimit/i },
  { name: 'resets-at-time', weight: 0.5, re: /\breset[s]?\b[^.\n]{0,24}?\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i },
  { name: 'upgrade', weight: 0.4, re: /\/upgrade\b|\bupgrade\s+(?:to|your)\b/i },
  { name: 'too-many-requests', weight: 0.45, re: /\btoo many requests\b/i },
  { name: 'http-429', weight: 0.35, re: /\b429\b/ },
  { name: 'quota-exceeded', weight: 0.55, re: /\bquota\b[^.\n]{0,20}\b(?:exceed|reached|exhaust)/i },
  { name: 'out-of', weight: 0.4, re: /\bout of\b[^.\n]{0,20}\b(?:usage|credits?|messages?|tokens?|quota)\b/i },
  { name: 'try-again-later', weight: 0.3, re: /\btry again (?:later|in|at)\b/i },
  { name: 'come-back', weight: 0.35, re: /\b(?:come back|check back|available again)\b[^.\n]{0,20}\b(?:later|in|at|reset)/i },
  { name: 'limit-of-your-plan', weight: 0.5, re: /\blimit\b[^.\n]{0,20}\b(?:plan|subscription|tier)\b/i },
];

export function rateLimitConfidence(text) {
  let score = 0;
  for (const sig of WEIGHTED_SIGNALS) if (sig.re.test(text)) score += sig.weight;
  return Math.min(score, 1);
}

/** ¿El texto parece un mensaje de límite de uso? (capa 1 OR capa 2). */
export function isRateLimited(text) {
  if (!text) return false;
  for (const re of STRONG_PATTERNS) if (re.test(text)) return true;
  return rateLimitConfidence(text) >= PRECISION;
}

// --- Parseo de la hora de reinicio ----------------------------------------
// Soporta "in X hours/minutes", "resets 3pm", "reset at 15:00", con zona horaria
// IANA opcional entre paréntesis (p. ej. "(America/Panama)").
export function parseResetMs(text) {
  let m = text.match(
    /(?:reset[s]?|try again|expires?|available again)\D{0,24}?in\s+(\d+)\s*(hour|hr|minute|min)/i,
  );
  if (m) {
    const n = parseInt(m[1], 10);
    return m[2].toLowerCase().startsWith('h') ? n * 3600e3 : n * 60e3;
  }

  const tzMatch = text.match(/\(([A-Za-z]+(?:\/[A-Za-z_]+)+)\)/);
  const tz = tzMatch ? tzMatch[1] : null;

  m = text.match(
    /(?:reset[s]?|try again|expires?|available again)\b[^0-9\n]{0,24}?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  );
  if (!m) {
    m = text.match(
      /(?:reset[s]?|try again|expires?|available again)\b[^0-9\n]{0,24}?(\d{1,2}):(\d{2})\b/i,
    );
    if (m) m = [m[0], m[1], m[2], undefined];
  }
  if (m) {
    let hour = parseInt(m[1], 10);
    const minute = m[2] ? parseInt(m[2], 10) : 0;
    const ap = m[3] ? m[3].toLowerCase() : null;
    if (ap === 'pm' && hour < 12) hour += 12;
    if (ap === 'am' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;

    if (tz) {
      const ms = zonedFutureMs(hour, minute, tz);
      if (ms != null) return ms;
    }
    const now = new Date();
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }
  return null;
}

function zonedFutureMs(hour, minute, tz) {
  try {
    const now = new Date();
    const offsetAt = (date) => {
      const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });
      const p = {};
      for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
      const h = p.hour === '24' ? 0 : p.hour;
      const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +h, +p.minute, +p.second);
      return asUTC - date.getTime();
    };
    const dp = {};
    for (const part of new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now)) {
      dp[part.type] = part.value;
    }
    const instantFor = (y, mo, d) => {
      const wall = Date.UTC(y, mo - 1, d, hour, minute, 0);
      let off = offsetAt(new Date(wall - 0));
      const inst = wall - off;
      off = offsetAt(new Date(inst));
      return wall - off;
    };
    let inst = instantFor(+dp.year, +dp.month, +dp.day);
    if (inst <= now.getTime()) {
      const tomorrow = new Date(now.getTime() + 24 * 3600e3);
      const tp = {};
      for (const part of new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(tomorrow)) {
        tp[part.type] = part.value;
      }
      inst = instantFor(+tp.year, +tp.month, +tp.day);
    }
    return inst - now.getTime();
  } catch {
    return null;
  }
}

/** ms a esperar: hora de reinicio + margen, o el fallback si no se pudo leer. */
export function calculateWaitMs(text) {
  const parsed = parseResetMs(text);
  if (parsed != null && parsed > 0) return parsed + MARGIN_SECONDS * 1000;
  return FALLBACK_HOURS * 3600e3;
}

// --- utilidades -----------------------------------------------------------
function num(v, d) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}
function parsePrecision(v, d) {
  if (v == null || v === '') return d;
  const n = parseFloat(String(v).replace('%', '').trim());
  if (!Number.isFinite(n)) return d;
  const frac = n > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0, frac));
}
