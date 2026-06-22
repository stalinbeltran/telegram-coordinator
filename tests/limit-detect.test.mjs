// Tests del núcleo de detección de límite de uso de claude (scripts/limit-detect.mjs).
// Runner nativo de Node (`node --test`), sin dependencias externas, coherente con
// la filosofía del proyecto (los tests son datos/scripts, no requieren build).
//
// Correr: node --test  (o  npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isRateLimited,
  rateLimitConfidence,
  parseResetMs,
  calculateWaitMs,
} from '../scripts/limit-detect.mjs';

const HOUR = 3600e3;
const MIN = 60e3;

// --- Capa 1: patrones definitivos -----------------------------------------
test('isRateLimited: frases inequívocas del banner del límite', () => {
  const strong = [
    'Claude usage limit reached',
    'usage limit reached. Your limit will reset at 3pm',
    '5-hour limit reached',
    'session limit reached',
    'weekly limit reached',
    "you've reached your usage limit",
    'rate_limit_error',
    'Error 429: too many requests',
    'too many requests (429)',
    'Upgrade to increase your usage limit',
  ];
  for (const t of strong) {
    assert.equal(isRateLimited(t), true, `debería detectar límite en: ${t}`);
  }
});

// --- Falsos positivos: NO debe disparar -----------------------------------
test('isRateLimited: texto normal no dispara', () => {
  const benign = [
    '',
    'Aquí está la respuesta a tu pregunta.',
    'El archivo se guardó correctamente.',
    'function add(a, b) { return a + b; }',
    // Mención casual de "rate limit" de pasada: solo 0.45 < 0.7 (umbral).
    'You can configure the API rate limit in the settings panel.',
  ];
  for (const t of benign) {
    assert.equal(isRateLimited(t), false, `NO debería detectar límite en: ${JSON.stringify(t)}`);
  }
});

test('isRateLimited: null/undefined devuelve false sin lanzar', () => {
  assert.equal(isRateLimited(null), false);
  assert.equal(isRateLimited(undefined), false);
});

// --- Capa 2: confianza estadística ----------------------------------------
test('rateLimitConfidence: acumula señales y se acota a 1', () => {
  // Sin señales -> 0.
  assert.equal(rateLimitConfidence('hola mundo'), 0);

  // Una sola señal débil queda por debajo del umbral por defecto (0.7).
  const casual = rateLimitConfidence('the API rate limit is high');
  assert.ok(casual > 0 && casual < 0.7, `esperaba 0<c<0.7, fue ${casual}`);

  // Varias señales fuertes saturan a 1 como tope.
  const strong = rateLimitConfidence(
    'usage limit reached: your session limit will reset; upgrade your plan',
  );
  assert.ok(strong <= 1, 'nunca debe superar 1');
  assert.ok(strong >= 0.7, `texto cargado de señales debería superar el umbral, fue ${strong}`);
});

test('isRateLimited: variante no catalogada se capta por la capa 2', () => {
  // No coincide con ningún STRONG_PATTERN literal, pero suma señales suficientes.
  const t = 'Your weekly limit will reset; you have used up your plan quota.';
  assert.equal(isRateLimited(t), true);
});

// --- parseResetMs: "in X hours/minutes" -----------------------------------
test('parseResetMs: formato relativo "in X hours/minutes"', () => {
  assert.equal(parseResetMs('try again in 3 hours'), 3 * HOUR);
  assert.equal(parseResetMs('your limit will reset in 45 minutes'), 45 * MIN);
  assert.equal(parseResetMs('resets in 1 hr'), 1 * HOUR);
  assert.equal(parseResetMs('available again in 10 min'), 10 * MIN);
});

// --- parseResetMs: hora absoluta am/pm y 24h ------------------------------
test('parseResetMs: hora absoluta devuelve un ms futuro (<= 24h)', () => {
  for (const t of ['your limit will reset at 3pm', 'resets 9:30am', 'try again at 15:00']) {
    const ms = parseResetMs(t);
    assert.ok(ms != null, `debería parsear: ${t}`);
    assert.ok(ms > 0 && ms <= 24 * HOUR + 1000, `${t} -> ${ms} fuera de rango`);
  }
});

test('parseResetMs: horas/minutos inválidos devuelven null', () => {
  assert.equal(parseResetMs('resets at 25:00'), null); // hora 25 inválida
  assert.equal(parseResetMs('reset at 12:99'), null); // minuto 99 inválido
});

test('parseResetMs: sin información de tiempo devuelve null', () => {
  assert.equal(parseResetMs('usage limit reached'), null);
  assert.equal(parseResetMs('texto cualquiera sin horas'), null);
});

test('parseResetMs: zona horaria IANA no rompe y da ms futuro', () => {
  const ms = parseResetMs('your limit will reset at 9am (America/Panama)');
  assert.ok(ms != null && ms > 0, 'con tz debería dar un ms futuro válido');
});

// --- calculateWaitMs: margen y fallback -----------------------------------
test('calculateWaitMs: hora parseable suma el margen por defecto (30s)', () => {
  // 2 horas + 30s de margen.
  assert.equal(calculateWaitMs('try again in 2 hours'), 2 * HOUR + 30 * 1000);
});

test('calculateWaitMs: sin hora legible usa el fallback (5h por defecto)', () => {
  assert.equal(calculateWaitMs('usage limit reached, no time info'), 5 * HOUR);
});
