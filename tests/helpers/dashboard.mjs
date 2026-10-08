import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

export const readIndex = () => readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

// This project currently uses inline classic scripts. Fail explicitly if that
// contract changes instead of silently skipping an external/module script.
export function inlineScripts(html) {
  const matches = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  assert.ok(matches.length > 0, 'index.html must contain dashboard JavaScript');
  return matches.map(match => {
    assert.doesNotMatch(match[1], /\bsrc\s*=/i, 'Extend the loader for external scripts');
    const type = match[1].match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
    assert.ok(!type || /^(?:text|application)\/javascript$/i.test(type),
      'Extend the loader for modules or non-JavaScript script elements');
    const start = match.index + match[0].indexOf('>') + 1;
    return { source: match[2], line: html.slice(0, start).split('\n').length };
  });
}

export const plain = value => JSON.parse(JSON.stringify(value));
export const csvResponse = text => ({ ok: true, status: 200, text: async () => text });
export const BASIC_CSV = 'Estudiante,Nota final\nAna,10\nBruno,11\nCarla,18\n';

export async function createDashboard({ fetchImpl = async () => csvResponse(BASIC_CSV) } = {}) {
  const html = readIndex();
  const elements = new Map();
  const draws = [];
  const requests = [];
  const windowEvents = new Map();
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    const id = match[1];
    const listeners = new Map();
    const context2d = Object.fromEntries(
      ['setTransform', 'clearRect', 'fillRect', 'fillText', 'beginPath', 'arc', 'stroke']
        .map(method => [method, (...args) => draws.push({ id, method, args })]),
    );
    elements.set(id, {
      value: '', textContent: '', innerHTML: '', style: {}, clientWidth: 600,
      listeners,
      addEventListener: (event, callback) => listeners.set(event, callback),
      getContext: type => {
        assert.equal(type, '2d');
        return context2d;
      },
    });
  }
  const element = id => {
    assert.ok(elements.has(id), `Missing actual HTML element: #${id}`);
    return elements.get(id);
  };
  element('csvUrl').value = html.match(/<input\b[^>]*\bid="csvUrl"[^>]*\bvalue="([^"]*)"/)?.[1] ?? '';
  for (const id of ['estado', 'orden']) {
    const options = html.match(new RegExp(`<select\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`))?.[1];
    element(id).value = options?.match(/<option\b[^>]*value="([^"]*)"/)?.[1] ?? '';
  }
  const context = createContext({
    console,
    document: { getElementById: id => elements.get(id) ?? null },
    window: { devicePixelRatio: 1, addEventListener: (name, callback) => windowEvents.set(name, callback) },
    fetch: async (...args) => { requests.push(args); return fetchImpl(...args); },
  });
  for (const { source, line } of inlineScripts(html)) {
    new Script(source, { filename: 'index.html', lineOffset: line - 1 }).runInContext(context, { timeout: 1000 });
  }
  // Bridge lexical declarations without copying or editing production code.
  new Script(`globalThis.__dashboard = {
    ST, normalizeUrl, parseCSV, detectCols, toNum, median, getRows,
    render, loadData, drawBars, drawDonut
  };`).runInContext(context, { timeout: 1000 });
  // All fixtures resolve/reject immediately. Drain the actual boot loadData()
  // microtasks before exposing the instance to avoid a second competing load.
  await new Promise(resolve => setImmediate(resolve));
  return { api: context.__dashboard, element, draws, requests, windowEvents };
}
