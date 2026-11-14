import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, dist), 'utf8'));
const catalog = await json('catalog.json');
assert.equal(catalog.total, 180);
assert.equal(catalog.items.length, 180);
assert.deepEqual(catalog.voices, ['female', 'male']);
assert.equal(new Set(catalog.items.map(item => item.id)).size, 180);
const audioFiles = new Set();
const details = new Set();
const summary = { passages: 180, questions: 0, recordings: 0, audioBytes: 0, levels: {},
  nativeFastRatio: { min: Infinity, max: 0 } };
for (const level of ['cet4', 'cet6', 'ielts']) {
  const entries = catalog.items.filter(item => item.level === level);
  assert.equal(entries.length, 60);
  summary.levels[level] = { short: 0, long: 0, minWords: Infinity, maxWords: 0,
    standardWpm: { min: Infinity, max: 0 } };
}
for (const entry of catalog.items) {
  assert(/^\.\/materials\/(cet4|cet6|ielts)-(short|long)-[a-f0-9]{12}-[a-f0-9]{12}\.json$/.test(entry.detail));
  details.add(entry.detail.slice('./materials/'.length));
  const material = await json(entry.detail);
  assert.equal(material.id, entry.id);
  assert.equal(material.level, entry.level);
  assert.equal(material.length, entry.length);
  assert.equal(material.title, entry.title);
  assert.equal(material.source, 'original');
  assert(material.transcript.length > 300);
  const expectedCount = entry.level === 'ielts' ? 5 : entry.length === 'short' ? 2 : 4;
  assert.equal(material.questions.length, expectedCount);
  summary.questions += material.questions.length;
  assert.equal(entry.questionCount, expectedCount);
  assert.deepEqual(Object.keys(material.audio).sort(), catalog.voices);
  assert(!/[\uFFFD\uD800-\uDFFF]/u.test(JSON.stringify(material)), `${entry.id}: invalid Unicode`);
  const group = summary.levels[entry.level];
  group[entry.length]++;
  group.minWords = Math.min(group.minWords, material.words);
  group.maxWords = Math.max(group.maxWords, material.words);
  for (const question of material.questions) {
    assert(question.prompt && question.answer && question.explanation);
    if (question.type === 'choice') {
      assert(question.options.includes(question.answer));
      assert.equal(new Set(question.options).size, entry.level === 'ielts' ? 3 : 4);
    } else {
      assert.equal(entry.level, 'ielts');
      assert.equal(question.type, 'blank');
      assert(question.answer.trim().split(/\s+/).length <= 2);
      assert(material.transcript.toLowerCase().includes(question.answer.toLowerCase()));
      if (question.acceptedAnswers) {
        assert(Array.isArray(question.acceptedAnswers));
        assert(question.acceptedAnswers.every(value => typeof value === 'string' && value.trim()
          && value.trim().split(/\s+/).length <= 2));
      }
    }
  }
  for (const voice of catalog.voices) {
    const tracks = material.audio[voice];
    assert(tracks, `${entry.id}: missing ${voice}`);
    assert.deepEqual(Object.keys(tracks).sort(), ['1', '1.1']);
    for (const track of Object.values(tracks)) {
      assert(/^\.\/audio\/[a-f0-9]{32}\.opus$/.test(track.url));
      assert(track.seconds > 10 && track.seconds < 600);
      assert.equal(track.native, true);
      assert.equal(track.rate, 1);
      const filename = track.url.slice('./audio/'.length);
      assert(!audioFiles.has(filename), 'Each passage, voice and pace has its own recording.');
      audioFiles.add(filename);
      const bytes = await readFile(new URL(track.url, dist));
      assert(bytes.length > 1000 && bytes.length < 25 * 1024 ** 2);
      assert.equal(bytes.toString('ascii', 0, 4), 'OggS');
      assert.equal(createHash('sha256').update(bytes).digest('hex').slice(0, 32) + '.opus', filename);
      summary.audioBytes += bytes.length;
      summary.recordings++;
    }
  }
  const turns = material.dialogue ? material.transcript.split(/\r?\n/).filter(line => line.trim()).length : 1;
  const pauses = (turns - 1) * .4 + (entry.level === 'ielts' ? 0 : 2 + material.questions.length * 7);
  for (const voice of ['female', 'male']) {
    const standardSeconds = material.audio[voice]['1'].seconds - pauses;
    const fastSeconds = material.audio[voice]['1.1'].seconds - pauses;
    assert(standardSeconds > 0 && fastSeconds > 0);
    const relative = standardSeconds / fastSeconds;
    const spokenQuestions = entry.level === 'ielts' ? [] : material.questions.map(question => question.prompt);
    const spokenWords = ([material.transcript, ...spokenQuestions].join(' ').match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length
      + spokenQuestions.length * 2;
    const standardWpm = spokenWords * 60 / standardSeconds;
    const target = { cet4: 152, cet6: 166, ielts: 190 }[entry.level];
    assert(Math.abs(standardWpm - target) / target <= .1, `${entry.id}/${voice}: standard WPM ${standardWpm}`);
    group.standardWpm.min = Math.min(group.standardWpm.min, standardWpm);
    group.standardWpm.max = Math.max(group.standardWpm.max, standardWpm);
    // Tiny tolerance beyond the 2% calibration bound allows MP3 encoder padding
    // on the older verified examples whose durations came from the container.
    assert(relative >= 1.075 && relative <= 1.125, `${entry.id}/${voice}: fast ratio ${relative}`);
    summary.nativeFastRatio.min = Math.min(summary.nativeFastRatio.min, relative);
    summary.nativeFastRatio.max = Math.max(summary.nativeFastRatio.max, relative);
  }
}
assert.equal(summary.recordings, 720);
assert.equal(summary.questions, 646);
assert.deepEqual((await readdir(new URL('materials/', dist))).sort(), [...details].sort());
assert.deepEqual((await readdir(new URL('audio/', dist))).sort(), [...audioFiles].sort());
for (const file of ['index.html', 'styles.css', 'app.js', 'library.js', 'icon.svg']) {
  assert((await stat(new URL(file, dist))).size > 0);
}
const html = await readFile(new URL('index.html', dist), 'utf8');
assert(html.includes('© 2026 舒韫 · 英语听力练习'));
assert(!/localhost|127\.0\.0\.1|\.runtime|[A-Z]:\\/.test(html));
summary.catalogBytes = (await stat(new URL('catalog.json', dist))).size;
console.log(JSON.stringify(summary, null, 2));
