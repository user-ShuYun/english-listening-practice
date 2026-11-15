import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/library.js', import.meta.url), 'utf8');
const tracks = {
  female: { '1': { url: './audio/female-standard.opus', rate: 1, native: true }, '1.1': { url: './audio/female-fast.opus', rate: 1, native: true } },
  male: { '1': { url: './audio/male-standard.opus', rate: 1, native: true }, '1.1': { url: './audio/male-fast.opus', rate: 1, native: true } },
};
const choice = { type: 'choice', prompt: 'Why did the plan change?', options: ['Rain', 'Cost', 'Wind', 'Time'], answer: 'Rain', explanation: '原文提及降雨。' };
const blank = { type: 'blank', prompt: 'Meet at the ____.', options: [], answer: 'main hall', explanation: '原文提及主厅。' };
const materials = {
  './materials/cet4-short.json': { id: 'cet4-short', level: 'cet4', length: 'short', title: 'A radio report', transcript: 'Rain changed the plan.', questions: [choice, { ...choice, prompt: 'What caused the delay?' }], audio: tracks },
  './materials/ielts-long.json': { id: 'ielts-long', level: 'ielts', length: 'long', title: 'An enquiry', transcript: 'Meet at the main hall.', questions: [blank, choice], audio: tracks },
};
const catalog = { version: 1, total: 2, voices: ['female', 'male'], items: [
  { id: 'cet4-short', level: 'cet4', length: 'short', sample: true, detail: './materials/cet4-short.json' },
  { id: 'ielts-long', level: 'ielts', length: 'long', sample: true, detail: './materials/ielts-long.json' },
] };
const calls = [];
const storage = new Map();
let delayDetail;
const context = vm.createContext({ window: {}, crypto: webcrypto, DOMException, AbortController,
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  fetch: async (url, options = {}) => {
    calls.push({ url, options });
    if (delayDetail && url.startsWith('./materials/')) await delayDetail;
    const data = url === './catalog.json' ? catalog : materials[url];
    assert(data, `Unexpected request: ${url}`);
    return { ok: true, json: async () => structuredClone(data) };
  },
});
vm.runInContext(source, context);
const library = context.window.ListeningLibrary;
await Promise.all([library.loadCatalog(), library.loadCatalog()]);
assert.equal(calls.length, 1, 'Initial load only requests the catalog, once.');
const call = async (path, body, signal) => (await library.request(path, body, signal)).json();
const first = await call('/api/exercise', { level: 'cet4', length: 'short' });
assert.equal(first.questions.length, 2);
assert(first.questions.every(q => q.prompt === '' && !('answer' in q) && !('explanation' in q)));
assert(!('transcript' in first));
assert.equal(calls.length, 2, 'Opening a question fetches only its detail.');
const shortSample = await call('/api/exercise', { level: 'cet4', length: 'short', sample: true });
assert.equal(shortSample.questions.length, 2, 'A short sample respects the selected length.');
library.abandon(shortSample.attemptId);
assert.equal((await call('/api/voice', { attemptId: first.attemptId, voice: 'male', pace: 1.1 })).url, './audio/male-fast.opus');
assert.equal(calls.length, 3, 'Voice selection returns a URL without downloading the audio.');
const graded = await call('/api/submit', { attemptId: first.attemptId, answers: ['Rain', 'Cost'] });
assert.equal(graded.score, 1);
assert.equal(graded.transcript, materials['./materials/cet4-short.json'].transcript);
assert.equal((await call('/api/submit', { attemptId: first.attemptId, answers: ['Rain', 'Rain'] })).score, 1);
assert([...storage.values()][0].includes('cet4-short'));
const second = await call('/api/exercise', { id: 'ielts-long' });
assert.equal(second.questions[0].prompt, blank.prompt);
const recording = await call('/api/voice', { attemptId: second.attemptId, voice: 'female', pace: 1.1 });
assert.equal(recording.native, true);
assert.equal(recording.rate, 1);
const scored = await call('/api/submit', { attemptId: second.attemptId, answers: ['  MAIN   HALL  ', 'Rain'] });
assert.equal(scored.score, 2);
library.abandon(first.attemptId);
await assert.rejects(call('/api/voice', { attemptId: first.attemptId, voice: 'female', pace: 1 }));
let release;
delayDetail = new Promise(resolve => { release = resolve; });
const controller = new AbortController();
const abandoned = call('/api/exercise', { id: 'cet4-short' }, controller.signal);
controller.abort();
release();
await assert.rejects(abandoned, error => error.name === 'AbortError');
assert(calls.every(({ url, options }) => !url.startsWith('/api/') && !url.startsWith('./audio/') && !options.method));
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size, 'HTML IDs must be unique.');
for (const match of (source + app).matchAll(/(?:byId|(?:document\.)?getElementById)\("([^"]+)"\)/g)) {
  assert(ids.includes(match[1]), `Missing UI element ${match[1]}`);
}
assert(html.indexOf('src="./library.js"') < html.indexOf('src="./app.js"'));
assert(!html.includes('id="generate-live"'));
assert(html.includes('© 2026 舒韫 · 聆听手记'));
console.log('PASS: catalog-only initial load; selected detail only; hidden answers; native fast-track selection; no audio prefetch; IELTS normalization; idempotent grading; local progress; cancellation.');
