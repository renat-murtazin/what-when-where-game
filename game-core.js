(function (root) {
  'use strict';
  const MAX_DURATION = 5999;
  function duration(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > MAX_DURATION) throw new Error('Укажите целое число секунд от 1 до 5999.');
    return n;
  }
  function formatTime(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }
  function normalizeQuestions(input) {
    if (!Array.isArray(input)) throw new Error('Ожидается список вопросов.');
    if (input.length > 200) throw new Error('В одном наборе может быть не более 200 вопросов.');
    const questions = input.map(q => {
      if (typeof q === 'string') return { text: q.trim(), sender: '', photo: '' };
      if (q && typeof q.text === 'string') {
        const sender = typeof q.sender === 'string' ? q.sender.trim() : '';
        const photo = typeof q.photo === 'string' ? q.photo.trim() : '';
        if (sender.length > 150) throw new Error('Имя отправителя не должно превышать 150 символов.');
        if (photo && !isLocalPhoto(photo)) throw new Error('Фото должно быть локальным файлом JPEG или PNG: например, senders_img/1.jpeg.');
        return { text: q.text.trim(), sender, photo };
      }
      throw new Error('Каждый вопрос должен содержать текст.');
    }).filter(q => q.text);
    if (!questions.length) throw new Error('Добавьте хотя бы один вопрос.');
    if (questions.some(q => q.text.length > 6000)) throw new Error('Вопрос не должен превышать 6000 символов.');
    return questions.map((question, i) => ({ id: String(i + 1), ...question }));
  }
  const DEFAULT_SENDER = 'Тайного гостя';
  const DEFAULT_PHOTO = 'senders_img/default.png';
  function isLocalPhoto(path) {
    return !/^(?:[a-z][a-z\d+.-]*:|[\\/])|[?#]/i.test(path) && !path.split(/[\\/]/).includes('..') && /\.(?:jpe?g|png)$/i.test(path);
  }
  function senderName(question) { return question.sender?.trim() || DEFAULT_SENDER; }
  function photoCandidates(question, number) {
    const automatic = [`senders_img/${number}.jpeg`, `senders_img/${number}.png`, `senders_img/${number}.jpg`, DEFAULT_PHOTO];
    return [...new Set(question.photo && isLocalPhoto(question.photo) ? [question.photo, ...automatic] : automatic)];
  }
  function selectQuestion(questions, used, id) {
    const question = questions.find(q => q.id === id);
    if (!question) throw new Error('Вопрос не найден.');
    const revisited = used.includes(id);
    return { question, used: revisited ? [...used] : [...used, id], revisited };
  }
  function parseQuestions(text, filename) {
    const raw = text.replace(/^\uFEFF/, '').trim();
    if (!raw) throw new Error('Файл пуст.');
    if (/\.json$/i.test(filename) || raw.startsWith('[') || raw.startsWith('{')) {
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error('Не удалось прочитать JSON. Проверьте формат файла.'); }
      return normalizeQuestions(Array.isArray(data) ? data : data.questions);
    }
    return normalizeQuestions(raw.split(/\r?\n\s*\r?\n/));
  }
  function available(questions, used) {
    return questions.filter(q => !used.includes(q.id));
  }
  function choose(questions, used, random) {
    const pool = available(questions, used);
    return pool.length ? pool[Math.min(pool.length - 1, Math.floor((random || Math.random)() * pool.length))] : null;
  }
  function targetRotation(index, count, current, turns) {
    const target = ((360 - ((index + .5) * 360 / count)) % 360 + 360) % 360;
    const normalized = ((current % 360) + 360) % 360;
    return current + (turns || 6) * 360 + ((target - normalized + 360) % 360);
  }
  function remainingMs(timer, now) {
    return Math.max(0, timer.running ? timer.deadline - now : timer.remaining);
  }
  const api = { duration, formatTime, normalizeQuestions, parseQuestions, available, choose, targetRotation, remainingMs, senderName, photoCandidates, selectQuestion, DEFAULT_SENDER, DEFAULT_PHOTO };
  root.CastleGame = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
