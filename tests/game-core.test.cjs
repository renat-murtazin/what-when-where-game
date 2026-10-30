const { test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game-core.js');

test('selection exhausts all questions without repeats, then returns null', () => {
  const questions = G.normalizeQuestions(['A', 'B', 'C', 'D']);
  const used = [];
  for (let i = 0; i < 4; i++) {
    const selected = G.choose(questions, used, () => .7);
    assert.ok(!used.includes(selected.id)); used.push(selected.id);
  }
  assert.equal(new Set(used).size, 4);
  assert.equal(G.choose(questions, used), null);
});
test('every wheel sector lands precisely under the pointer', () => {
  for (const count of [1, 2, 3, 15, 27, 100, 200]) {
    for (let i = 0; i < count; i++) {
      const current = 2987.3;
      const target = G.targetRotation(i, count, current, 6);
      const landed = (target + (i + .5) * 360 / count) % 360;
      assert.ok(landed < .000001 || 360 - landed < .000001, `${count} questions, index ${i}`);
      assert.ok(target >= current + 6 * 360);
    }
  }
});
test('clock uses deadline rather than number of ticks', () => {
  assert.equal(G.remainingMs({ running: true, deadline: 60000, remaining: 60000 }, 45321), 14679);
  assert.equal(G.remainingMs({ running: true, deadline: 60000 }, 70000), 0);
  assert.equal(G.remainingMs({ running: false, remaining: 12345 }, 999999), 12345);
  assert.equal(G.formatTime(59999), '01:00');
  assert.equal(G.formatTime(1001), '00:02');
  assert.equal(G.formatTime(0), '00:00');
  assert.equal(G.formatTime(-200), '00:00');
  assert.equal(G.formatTime(5999000), '99:59');
});
test('question files accept multiline TXT and JSON and reject invalid input', () => {
  assert.deepEqual(G.parseQuestions('First\ncontinued\r\n\r\nSecond', 'q.txt').map(q => q.text), ['First\ncontinued', 'Second']);
  assert.equal(G.parseQuestions('\uFEFF["A", "B"]', 'q.json').length, 2);
  assert.equal(G.parseQuestions('{"questions":[{"text":" A "}]}', 'q.json')[0].text, 'A');
  assert.throws(() => G.parseQuestions('broken', 'q.json'));
  assert.throws(() => G.normalizeQuestions(['   ']));
  assert.throws(() => G.normalizeQuestions([42]));
  assert.throws(() => G.normalizeQuestions(Array(201).fill('Q')));
  assert.throws(() => G.normalizeQuestions(['Q'.repeat(6001)]));
});
test('duration rejects empty, fractional, negative, and excessive values', () => {
  assert.equal(G.duration('90'), 90);
  for (const value of ['', 0, -1, 1.5, 6000, NaN, 'x']) assert.throws(() => G.duration(value));
});

test('sender metadata survives normalization and JSON import/export', () => {
  const source = [{ text: ' Первый вопрос ', sender: ' Анны ', photo: 'senders_img/1.jpeg' }, { text: 'Второй вопрос' }];
  const normalized = G.normalizeQuestions(source);
  assert.equal(normalized[0].sender, 'Анны');
  assert.equal(normalized[0].photo, 'senders_img/1.jpeg');
  assert.equal(G.senderName(normalized[1]), 'Тайного гостя');
  assert.deepEqual(G.parseQuestions(JSON.stringify(normalized), 'questions.json'), normalized);
  assert.equal(G.normalizeQuestions(['Legacy question'])[0].sender, '');
  assert.equal(G.normalizeQuestions([{ text: 'Old saved question', id: '1' }])[0].photo, '');
});
test('photo lookup tries numbered local files and always ends with the default', () => {
  assert.deepEqual(G.photoCandidates({ photo: '' }, 5), ['senders_img/5.jpeg', 'senders_img/5.png', 'senders_img/5.jpg', 'senders_img/default.png']);
  assert.equal(G.photoCandidates({ photo: 'senders_img/anna.png' }, 2)[0], 'senders_img/anna.png');
  for (const photo of ['https://example.com/picture.png', '//example.com/p.png', '../photo.png', 'javascript:thing.png', '/tmp/photo.png', 'senders_img/1.png?x=y', 'senders_img/p.svg']) {
    assert.throws(() => G.normalizeQuestions([{ text: 'Q', photo }]));
  }
});
test('reopening a question preserves played history and does not consume other questions', () => {
  const questions = G.normalizeQuestions(['A', 'B', 'C']);
  const used = ['1', '2'];
  const reopened = G.selectQuestion(questions, used, '1');
  assert.equal(reopened.revisited, true);
  assert.deepEqual(reopened.used, ['1', '2']);
  assert.equal(G.available(questions, reopened.used).length, 1);
  const firstOpening = G.selectQuestion(questions, used, '3');
  assert.equal(firstOpening.revisited, false);
  assert.deepEqual(firstOpening.used, ['1', '2', '3']);
  assert.deepEqual(used, ['1', '2']);
  assert.throws(() => G.selectQuestion(questions, used, '404'));
});
