import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const librarySource = await read('../dist/library.js');
const blank = (prompt, answer, acceptedAnswers) => ({ type: 'blank', prompt, options: [], answer,
  explanation: '原文直接提供相应信息。', ...(acceptedAnswers === undefined ? {} : { acceptedAnswers }) });
const choice = (prompt, answer, options) => ({ type: 'choice', prompt, answer, options, explanation: '原文说明原因。' });
const questions = [
  blank('Meet at the ____.', 'main hall', ['hall']),
  { ...choice('Why was the original plan changed?', 'Rain', ['Rain', 'Wind', 'Cost']), acceptedAnswers: ['Wind'] },
  blank('The task lasts ____.', 'six minutes', ['6 minutes']),
  choice('Why is a shared reference needed?', 'Comparison', ['Comparison', 'Security', 'Price']),
  blank('Each image includes a ____.', 'colour card', ['color card']),
];
const material = { id: 'mixed', level: 'ielts', length: 'long', title: 'Mixed question order',
  transcript: 'Meet at the main hall. Rain changed the plan. The task lasts six minutes. Comparison requires a shared reference. Each image includes a colour card.',
  questions, audio: { female: { '1': { url: './audio/example.opus', rate: 1, native: true } } } };
const catalog = { version: 1, total: 1, voices: ['female'], items: [{ id: material.id, level: 'ielts', length: 'long', detail: './materials/mixed.json' }] };
const noLeak = (attempt, expected = questions) => {
  assert.deepEqual(Array.from(attempt.questions, q => q.type), Array.from(expected, q => q.type));
  for (const question of attempt.questions) {
    assert(!('answer' in question) && !('acceptedAnswers' in question) && !('explanation' in question));
  }
  assert(!('transcript' in attempt));
};

let activeMaterial = material;
const browser = vm.createContext({ window: {}, crypto: webcrypto, DOMException,
  localStorage: { getItem: () => null, setItem() {} },
  fetch: async url => ({ ok: true, json: async () => structuredClone(url === './catalog.json' ? catalog : activeMaterial) }),
});
vm.runInContext(librarySource, browser);
const call = async (path, body) => (await browser.window.ListeningLibrary.request(path, body)).json();
async function browserGrade(answers, exercise = material) {
  activeMaterial = { ...exercise, id: material.id, level: 'ielts', audio: material.audio };
  const attempt = await call('/api/exercise', { id: material.id });
  noLeak(attempt, exercise.questions);
  await call('/api/voice', { attemptId: attempt.attemptId, voice: 'female', pace: 1 });
  return call('/api/submit', { attemptId: attempt.attemptId, answers });
}

{
  const grade = browserGrade;
  const aliases = await grade(['  HALL  ', 'Rain', '  6   MINUTES  ', 'Comparison', ' COLOR   CARD ']);
  assert.equal(aliases.score, 5, 'Explicit aliases accept case and whitespace differences.');
  const canonical = await grade(['MAIN HALL', 'Rain', 'six minutes', 'Comparison', 'colour card']);
  assert.equal(canonical.score, 5, 'Canonical answers remain valid even when omitted from acceptedAnswers.');
  const wrong = await grade(['lobby', 'Wind', '7 minutes', 'comparison', 'card']);
  assert.equal(wrong.score, 0, 'Unlisted guesses fail; choice ignores aliases and keeps exact option matching.');
  const empty = await grade(['', 'Rain', ' ', 'Comparison', '\t']);
  assert.equal(empty.score, 2, 'Empty blanks remain incorrect.');
}

assert((await read('../dist/app.js')).includes('填空题每空不超过两个单词，数量可用数字。'));
const index = JSON.parse(await read('../dist/catalog.json'));
const realMaterials = await Promise.all(index.items.filter(item => item.level === 'ielts')
  .map(async item => JSON.parse(await read('../dist/' + item.detail))));
assert.equal(realMaterials.length, 60);
let aliasItems = 0;
let mixedItems = 0;
for (const exercise of realMaterials) {
  if (exercise.questions.map(q => q.type).join(',') !== 'blank,blank,blank,choice,choice') mixedItems++;
  aliasItems += exercise.questions.filter(question => question.acceptedAnswers?.length).length;
  const canonical = exercise.questions.map(q => q.answer);
  const alternatives = exercise.questions.map(q => q.type === 'blank'
    ? `  ${(q.acceptedAnswers?.[0] ?? q.answer).toUpperCase().replaceAll(' ', '   ')}  ` : q.answer);
  assert.equal((await browserGrade(canonical, exercise)).score, 5, exercise.title + ': canonical answers');
  assert.equal((await browserGrade(alternatives, exercise)).score, 5, exercise.title + ': accepted alternatives');
}
assert(aliasItems > 0, 'The real bank must exercise acceptedAnswers preservation.');
assert(mixedItems > 0, 'The real bank must exercise mixed question order.');
console.log('PASS: browser grading handles aliases, canonical answers, Unicode and spacing; incorrect and empty answers remain incorrect.');
console.log(`PASS: ${realMaterials.length} IELTS materials, ${mixedItems} with mixed question order and ${aliasItems} questions with explicit aliases.`);
