(() => {
  'use strict';
  const G = window.CastleGame;
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'castle-what-where-when-v1';
  const demos = [
    'В старинном замке нет электричества. Вы входите в тёмную комнату, где стоят свеча, масляная лампа и камин. У вас всего одна спичка. Что вы зажжёте первым?',
    'Граф сказал гостю: «Позавчера мне было 300 лет, а в следующем году исполнится 303». В какой день и месяц состоялся этот разговор?',
    'На двери ведьмы висит табличка: «В этой комнате нет ни одного живого существа». В комнату вошёл человек и прочитал табличку. Почему её текст теперь неверен?',
    'Путник подошёл к замку и увидел троих стражей. Один смотрел на восток, другой — на запад, третий — на север. Все трое видели друг друга, не поворачивая головы. Как они стояли?',
    'У ведьмы пять дочерей. Каждая дочь имеет одного брата. Сколько всего детей у ведьмы?',
    'Старинные часы бьют шесть раз за пять секунд. За сколько секунд они пробьют двенадцать раз, если промежутки между ударами одинаковы?',
    'В тёмном сундуке лежат десять красных и десять чёрных перчаток: по пять левых и правых каждого цвета. Сколько перчаток нужно достать вслепую, чтобы наверняка получить две одного цвета, независимо от руки?',
    'Гость замка шёл под проливным дождём без плаща и зонта. Его одежда промокла, но ни один волос на голове не стал мокрым. Как это возможно?',
    'Вампир каждый вечер поднимается на башню высотой 20 метров. Лестница имеет 100 ступеней. Между первым и вторым этажом 25 ступеней. Во сколько раз путь на четвёртый этаж длиннее пути на второй, если этажи одинаковой высоты?',
    'В комнате горели десять свечей. Сквозняк погасил три. Остальные свечи полностью сгорели. Сколько свечей осталось в комнате к утру?',
    'Вы держите портрет обитателя замка. Хозяин говорит: «У меня нет братьев и сестёр, но отец этого человека — сын моего отца». Кто изображён на портрете?',
    'Две ведьмы сыграли пять партий в шахматы. Каждая выиграла по три партии, и ни одной ничьей не было. Как такое возможно?',
    'Чем больше земли вы забираете из неё, тем больше она становится. Что это?',
    'На озере возле замка растут волшебные кувшинки. Каждый день площадь, которую они занимают, удваивается. Всё озеро заросло за 30 дней. На какой день кувшинки занимали половину озера?',
    'Два отца и два сына нашли в подземелье три старинные монеты. Каждый взял по одной монете, и никому не пришлось делиться. Как это возможно?'
  ];
  const freshState = () => ({ questions: G.normalizeQuestions(demos.map((text, i) => ({ text, sender: i === 0 ? 'Графини Анны' : '' }))), used: [], currentId: null, scores: { experts: 0, viewers: 0 }, duration: 60, sound: false, volume: 45, demo: true, rotation: 0, timer: { running: false, remaining: 60000, deadline: null } });
  let storageAvailable = true;
  let state = restore();
  let spinning = false;
  let raf = null;
  let lastSecond = null;
  let editorDraft = [];
  let draftDemo = true;
  let toastTimeout;
  let audioContext;
  let pendingSettingsReset = false;

  function restore() {
    const fallback = freshState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const data = JSON.parse(raw);
      const questions = G.normalizeQuestions(data.questions);
      // Upgrade the original demo pack without touching custom questions or game progress.
      if (data.demo && questions[0].sender === '' && !Object.hasOwn(data.questions[0], 'sender')) questions[0].sender = 'Графини Анны';
      const ids = questions.map(q => q.id);
      const savedDuration = G.duration(data.duration);
      const savedRemaining = Number(data.timer?.remaining);
      const remaining = data.timer?.running && Number.isFinite(data.timer?.deadline) ? Math.max(0, data.timer.deadline - Date.now()) : Number.isFinite(savedRemaining) ? savedRemaining : savedDuration * 1000;
      return {
        ...fallback, questions, duration: savedDuration,
        used: Array.isArray(data.used) ? [...new Set(data.used)].filter(id => ids.includes(id)) : [],
        currentId: ids.includes(data.currentId) ? data.currentId : null,
        scores: { experts: safeScore(data.scores?.experts), viewers: safeScore(data.scores?.viewers) },
        sound: data.sound === true, volume: Number.isFinite(data.volume) ? Math.max(0, Math.min(100, data.volume)) : 45,
        demo: data.demo === true, rotation: Number.isFinite(data.rotation) ? data.rotation % 360 : 0,
        timer: { running: false, remaining: Math.min(savedDuration * 1000, Math.max(0, remaining)), deadline: null }
      };
    } catch { return fallback; }
  }
  function safeScore(n) { return Number.isInteger(n) ? Math.max(0, Math.min(999, n)) : 0; }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch {
      if (storageAvailable) toast('Браузер не сохраняет данные. Экспортируйте вопросы перед закрытием.');
      storageAvailable = false;
    }
  }
  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => $('toast').classList.remove('show'), 4300);
  }
  function announce(message) { $('announcer').textContent = message; }
  function secureRandom() {
    if (window.crypto?.getRandomValues) {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0] / 4294967296;
    }
    return Math.random();
  }

  // Every effect is synthesized locally. No audio files or network requests.
  async function unlockAudio() {
    if (!state.sound) return false;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error('unavailable');
      audioContext ||= new Context();
      if (audioContext.state === 'suspended') await audioContext.resume();
      return audioContext.state === 'running';
    } catch { toast('Звук недоступен в этом браузере. Попробуйте Chrome или Safari.'); return false; }
  }
  function tone(frequency, duration, volume = .1, type = 'sine', delay = 0, endFrequency = null) {
    if (!state.sound || !audioContext || audioContext.state !== 'running') return;
    const time = audioContext.currentTime + delay;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, time);
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
    gain.gain.setValueAtTime(.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0001, volume * state.volume / 100), time + .006);
    gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    osc.connect(gain).connect(audioContext.destination);
    osc.start(time); osc.stop(time + duration + .02);
  }
  function wheelClick() { tone(170, .045, .2, 'triangle', 0, 65); }
  function revealSound() { [196, 246.94, 293.66, 392].forEach((f, i) => tone(f, 1.6, .11, 'sine', i * .12)); }
  function gong() {
    [98, 147.6, 197.4, 248.5, 342.9].forEach((f, i) => tone(f, 4 - i * .35, .18 / (1 + i * .6), 'sine'));
  }
  function renderSound() {
    $('sound-toggle').setAttribute('aria-label', state.sound ? 'Выключить звук' : 'Включить звук');
    $('sound-toggle').title = state.sound ? 'Выключить звук' : 'Включить звук';
    $('sound-toggle').setAttribute('aria-pressed', String(state.sound));
    $('sound-waves').setAttribute('d', state.sound ? 'M15 8q4 4 0 8m3-11q7 7 0 14' : 'm16 9 5 6m0-6-5 6');
  }

  function svgNode(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }
  function renderWheel() {
    const rotor = $('wheel-rotor');
    rotor.replaceChildren();
    const count = state.questions.length;
    const radius = 197;
    const angle = 360 / count;
    rotor.append(svgNode('circle', { cx: 230, cy: 230, r: radius, fill: 'url(#wheel-face)' }));
    state.questions.forEach((question, index) => {
      const start = (index * angle - 90) * Math.PI / 180;
      const end = ((index + 1) * angle - 90) * Math.PI / 180;
      const middle = ((index + .5) * angle - 90) * Math.PI / 180;
      const used = state.used.includes(question.id);
      const selected = state.currentId === question.id;
      if (count > 1) {
        const d = `M230 230 L${230 + radius * Math.cos(start)} ${230 + radius * Math.sin(start)} A${radius} ${radius} 0 ${angle > 180 ? 1 : 0} 1 ${230 + radius * Math.cos(end)} ${230 + radius * Math.sin(end)} Z`;
        rotor.append(svgNode('path', { d, fill: selected ? '#a58b4c48' : used ? '#081719aa' : index % 2 ? '#d5c18007' : '#07171818', stroke: '#ac9565', 'stroke-opacity': '.22', 'stroke-width': '.8' }));
      } else if (selected || used) rotor.append(svgNode('circle', { cx: 230, cy: 230, r: radius, fill: selected ? '#a58b4c48' : '#081719aa' }));
      const label = svgNode('text', { x: 230 + 170 * Math.cos(middle), y: 230 + 170 * Math.sin(middle), fill: selected ? '#f5e2af' : used ? '#64736a' : '#cfbd91', 'font-size': count > 60 ? '7' : count > 35 ? '12' : count > 20 ? '17' : '23', 'font-family': 'Georgia, serif', 'text-anchor': 'middle', 'dominant-baseline': 'central', transform: `rotate(${(index + .5) * angle}, ${230 + 170 * Math.cos(middle)}, ${230 + 170 * Math.sin(middle)})` });
      // For very large packs show regular landmarks; every question still has its own sector.
      label.textContent = count > 100 && index % Math.ceil(count / 70) !== 0 ? '·' : String(index + 1);
      if (used && !selected) label.setAttribute('text-decoration', 'line-through');
      rotor.append(label);
    });
    for (let i = 0; i < 90; i++) {
      const a = i * Math.PI * 2 / 90;
      const r1 = i % 5 ? 204 : 201;
      rotor.append(svgNode('line', { x1: 230 + Math.sin(a) * r1, y1: 230 - Math.cos(a) * r1, x2: 230 + Math.sin(a) * 208, y2: 230 - Math.cos(a) * 208, stroke: '#b29b62', 'stroke-opacity': i % 5 ? '.4' : '.8', 'stroke-width': '.8' }));
    }
    rotor.style.transform = `rotate(${state.rotation}deg)`;
  }
  function renderQuestion() {
    const q = state.questions.find(item => item.id === state.currentId);
    const content = $('question-content');
    if (!q) return;
    content.className = 'question-content';
    const p = document.createElement('p');
    p.className = 'question-text' + (q.text.length > 650 ? ' very-long' : q.text.length > 310 ? ' long' : '');
    p.textContent = q.text;
    content.replaceChildren(p);
    $('question-label').textContent = `ВОПРОС № ${state.questions.indexOf(q) + 1}`;
    $('sender-attribution').hidden = false;
    $('sender-name').textContent = G.senderName(q);
    $('sender-photo').alt = `Отправитель: ${G.senderName(q)}`;
    loadSenderPhoto($('sender-photo'), q, state.questions.indexOf(q) + 1);
    content.closest('.question-card').classList.add('has-sender');
  }
  function loadSenderPhoto(image, question, number) {
    const candidates = G.photoCandidates(question, number);
    let next = 0;
    image.onerror = () => {
      if (next < candidates.length) image.src = candidates[next++];
      else { image.onerror = null; image.removeAttribute('src'); }
    };
    image.src = candidates[next++];
  }
  function renderGame() {
    const left = G.available(state.questions, state.used).length;
    $('remaining').textContent = left ? `Осталось вопросов: ${left} из ${state.questions.length}` : 'Все тайны раскрыты. Начните новую игру в настройках.';
    $('played-count').textContent = `Сыграно ${state.used.length} из ${state.questions.length}`;
    $('round-badge').textContent = `РАУНД ${String(Math.max(1, state.used.length)).padStart(2, '0')}`;
    $('spin').disabled = spinning || !left;
    $('spin').querySelector('span').textContent = spinning ? 'Судьба решает…' : !left ? 'Все вопросы сыграны' : 'Вращать колесо';
    $('pack-label').textContent = state.demo ? 'ДЕМОНСТРАЦИОННЫЕ ВОПРОСЫ' : 'ВОПРОСЫ ВАШЕГО ЗАМКА';
    $('score-experts').value = state.scores.experts;
    $('score-viewers').value = state.scores.viewers;
    document.querySelectorAll('[data-score]').forEach(button => { button.disabled = Number(button.dataset.delta) < 0 && state.scores[button.dataset.score] === 0; });
    $('settings-open').disabled = spinning;
    $('edit-questions').disabled = spinning;
    $('question-picker-open').disabled = spinning;
    $('timer-start').disabled = spinning;
  }
  function clearQuestion() {
    $('question-label').textContent = 'ТАЙНА ЕЩЁ НЕ РАСКРЫТА';
    $('sender-attribution').hidden = true;
    $('question-content').closest('.question-card').classList.remove('has-sender');
    const content = $('question-content');
    content.className = 'question-content empty';
    content.innerHTML = '<svg class="empty-symbol" viewBox="0 0 64 64" aria-hidden="true"><path d="M12 49V22Q12 5 32 5T52 22v27l-10-6-10 6-10-6Z"/><circle cx="25" cy="24" r="2"/><circle cx="39" cy="24" r="2"/><path d="M27 35q5-5 10 0"/></svg><h2>У каждой тайны — свой час</h2><p>Вращайте колесо, чтобы узнать,<br>какой вопрос приготовила вам эта ночь.</p>';
  }

  async function spin() {
    if (spinning || $('settings-dialog').open || $('duration-dialog').open || $('question-picker').open) return;
    if (state.timer.running) { toast('Приостановите таймер перед выбором нового вопроса.'); return; }
    const chosen = G.choose(state.questions, state.used, secureRandom);
    if (!chosen) return;
    spinning = true;
    await unlockAudio();
    resetTimer();
    const index = state.questions.indexOf(chosen);
    const from = state.rotation;
    const to = G.targetRotation(index, state.questions.length, from, 6);
    state.currentId = chosen.id;
    state.used.push(chosen.id);
    state.rotation = to;
    persist();
    renderGame();
    document.querySelector('.wheel-stage').classList.add('spinning');
    const content = $('question-content');
    $('sender-attribution').hidden = true;
    content.closest('.question-card').classList.remove('has-sender');
    content.className = 'question-content empty';
    content.innerHTML = '<div class="empty-symbol" style="font-size:40px;height:auto">✦</div><h2>Колесо пробуждает тайну…</h2><p>Узнаем, что приготовила эта ночь.</p>';
    $('question-label').textContent = 'СУДЬБА ДЕЛАЕТ ВЫБОР';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const length = reduced ? 250 : 5600;
    const start = performance.now();
    let lastSegment = -1;
    function frame(now) {
      const t = Math.min(1, (now - start) / length);
      const ease = 1 - Math.pow(1 - t, 4);
      const rotation = from + (to - from) * ease;
      $('wheel-rotor').style.transform = `rotate(${rotation}deg)`;
      const segment = Math.floor(rotation / (360 / state.questions.length));
      if (segment !== lastSegment && t < 1) { wheelClick(); lastSegment = segment; }
      if (t < 1) requestAnimationFrame(frame);
      else {
        spinning = false;
        state.rotation = to % 360;
        renderWheel(); renderQuestion(); renderGame(); persist();
        content.classList.add('reveal');
        document.querySelector('.wheel-stage').classList.remove('spinning');
        revealSound();
        announce(`Выбран вопрос номер ${index + 1}. Таймер готов к запуску.`);
      }
    }
    requestAnimationFrame(frame);
  }

  function renderTimer() {
    const remaining = G.remainingMs(state.timer, Date.now());
    const seconds = Math.ceil(remaining / 1000);
    const formatted = G.formatTime(remaining);
    if ($('timer').textContent !== formatted) {
      const [minutes, secs] = formatted.split(':');
      $('timer').replaceChildren(document.createTextNode(minutes), Object.assign(document.createElement('span'), { textContent: ':' }), document.createTextNode(secs));
    }
    $('timer-progress').style.transform = `scaleX(${Math.min(1, remaining / (state.duration * 1000))})`;
    $('timer-panel').classList.toggle('warning', remaining > 0 && seconds <= 10);
    $('timer-panel').classList.toggle('ended', remaining === 0);
    $('timer-panel').classList.toggle('running', state.timer.running);
    $('timer-start').querySelector('span').textContent = state.timer.running ? 'Пауза' : remaining === 0 ? 'Заново' : remaining < state.duration * 1000 ? 'Продолжить' : 'Начать';
    if ($('timer-start').dataset.running !== String(state.timer.running)) {
      $('timer-start').querySelector('svg').innerHTML = state.timer.running ? '<path d="M7 5h4v14H7Zm6 0h4v14h-4Z"/>' : '<path d="m9 5 10 7-10 7Z"/>';
      $('timer-start').dataset.running = String(state.timer.running);
    }
    $('timer-status').textContent = remaining === 0 ? 'Время вышло. Ваш ответ?' : state.timer.running ? seconds <= 10 ? 'Последние секунды…' : 'Тишина. Знатоки размышляют.' : remaining < state.duration * 1000 ? 'Время приостановлено' : state.duration === 60 ? 'Минута, чтобы найти истину' : 'Таймер готов к запуску';
    if (state.timer.running && seconds !== lastSecond) {
      if (seconds > 0 && seconds <= 10) tone(seconds <= 3 ? 660 : 440, .16, .14, 'sine');
      if (seconds === 10) announce('Осталось десять секунд.');
      lastSecond = seconds;
    }
    return remaining;
  }
  function timerLoop() {
    if (!state.timer.running) return;
    const remaining = renderTimer();
    if (remaining === 0) {
      state.timer = { running: false, remaining: 0, deadline: null };
      renderTimer(); persist(); gong(); announce('Время вышло! Ваш ответ?');
      return;
    }
    raf = requestAnimationFrame(timerLoop);
  }
  async function toggleTimer() {
    if (spinning || $('settings-dialog').open || $('duration-dialog').open || $('question-picker').open) return;
    if (state.timer.running) pauseTimer();
    else {
      await unlockAudio();
      if (state.timer.running) return;
      if (state.timer.remaining <= 0) state.timer.remaining = state.duration * 1000;
      state.timer.deadline = Date.now() + state.timer.remaining;
      state.timer.running = true;
      lastSecond = Math.ceil(state.timer.remaining / 1000) + 1;
      persist(); tone(294, .3, .09); timerLoop();
    }
  }
  function pauseTimer() {
    if (!state.timer.running) return;
    state.timer.remaining = G.remainingMs(state.timer, Date.now());
    state.timer.running = false; state.timer.deadline = null;
    cancelAnimationFrame(raf); renderTimer(); persist();
  }
  function resetTimer() {
    cancelAnimationFrame(raf);
    state.timer = { running: false, remaining: state.duration * 1000, deadline: null };
    lastSecond = null; renderTimer(); persist();
  }

  function openSettings() {
    if (spinning) return;
    pauseTimer();
    editorDraft = state.questions.map(q => ({ ...q }));
    draftDemo = state.demo;
    pendingSettingsReset = false;
    $('duration').value = state.duration;
    $('sound-enabled').checked = state.sound;
    $('volume').value = state.volume;
    $('settings-message').textContent = 'Изменения вопросов начнут новую игру.';
    renderEditor();
    $('settings-dialog').showModal();
  }
  function updateEditorMeta() {
    $('editor-count').textContent = `· ${editorDraft.filter(q => q.text.trim()).length}`;
    $('demo-notice').hidden = !draftDemo;
  }
  function renderEditor() {
    const editor = $('question-editor');
    editor.replaceChildren();
    editorDraft.forEach((question, i) => {
      const row = document.createElement('div'); row.className = 'question-row';
      const number = document.createElement('span'); number.className = 'question-number'; number.textContent = String(i + 1).padStart(2, '0');
      const fields = document.createElement('div'); fields.className = 'question-fields';
      const field = document.createElement('textarea'); field.value = question.text; field.maxLength = 6000; field.placeholder = 'Текст вашего вопроса…'; field.setAttribute('aria-label', `Текст вопроса ${i + 1}`);
      field.addEventListener('input', () => { editorDraft[i].text = field.value; draftDemo = false; updateEditorMeta(); });
      const metadata = document.createElement('div'); metadata.className = 'sender-fields';
      const preview = document.createElement('img'); preview.className = 'editor-sender-photo'; preview.alt = `Предпросмотр отправителя вопроса ${i + 1}`;
      loadSenderPhoto(preview, question, i + 1);
      const senderLabel = document.createElement('label'); senderLabel.textContent = 'Вопрос от (имя в родительном падеже)';
      const sender = document.createElement('input'); sender.type = 'text'; sender.value = question.sender; sender.maxLength = 150; sender.placeholder = G.DEFAULT_SENDER; sender.setAttribute('aria-label', `Отправитель вопроса ${i + 1}`);
      sender.addEventListener('input', () => { editorDraft[i].sender = sender.value; });
      senderLabel.append(sender);
      const photoLabel = document.createElement('label'); photoLabel.textContent = 'Фото (путь к файлу)';
      const photo = document.createElement('input'); photo.type = 'text'; photo.value = question.photo; photo.placeholder = `senders_img/${i + 1}.jpeg или .png`; photo.setAttribute('aria-label', `Фото отправителя вопроса ${i + 1}`);
      photo.addEventListener('input', () => { editorDraft[i].photo = photo.value; });
      photo.addEventListener('change', () => loadSenderPhoto(preview, editorDraft[i], i + 1));
      photoLabel.append(photo); metadata.append(preview, senderLabel, photoLabel); fields.append(field, metadata);
      const actions = document.createElement('div'); actions.className = 'row-actions';
      [['↑', 'Выше', -1], ['↓', 'Ниже', 1], ['×', 'Удалить', 0]].forEach(([symbol, label, delta]) => {
        const button = document.createElement('button'); button.textContent = symbol; button.setAttribute('aria-label', `${label}: вопрос ${i + 1}`);
        button.disabled = delta === -1 && i === 0 || delta === 1 && i === editorDraft.length - 1;
        button.addEventListener('click', () => {
          if (!delta) editorDraft.splice(i, 1);
          else [editorDraft[i], editorDraft[i + delta]] = [editorDraft[i + delta], editorDraft[i]];
          draftDemo = false; renderEditor();
        });
        actions.append(button);
      });
      row.append(number, fields, actions); editor.append(row);
    });
    updateEditorMeta();
    $('add-question').disabled = editorDraft.length >= 200;
  }
  function newGame() {
    state.used = []; state.currentId = null; state.scores = { experts: 0, viewers: 0 }; state.rotation = 0;
    resetTimer(); clearQuestion(); renderWheel(); renderGame(); persist();
  }
  function saveSettings() {
    try {
      const questions = G.normalizeQuestions(editorDraft);
      const duration = G.duration($('duration').value);
      const changed = JSON.stringify(questions.map(q => q.text)) !== JSON.stringify(state.questions.map(q => q.text));
      if (changed && state.used.length && !confirm('Сохранить новый список и начать игру заново? Счёт и сыгранные вопросы будут сброшены.')) return;
      const durationChanged = duration !== state.duration;
      state.questions = questions; state.duration = duration; state.demo = draftDemo;
      state.sound = $('sound-enabled').checked; state.volume = Number($('volume').value);
      if (changed || pendingSettingsReset) newGame();
      else if (durationChanged) resetTimer();
      renderSound(); renderGame(); renderQuestion(); renderTimer(); persist();
      $('settings-dialog').close();
      unlockAudio(); toast('Настройки сохранены. Замок готов к игре.');
    } catch (error) { $('settings-message').textContent = error.message; }
  }
  function exportQuestions() {
    try {
      const questions = G.normalizeQuestions(editorDraft);
      const blob = new Blob([JSON.stringify(questions.map(({ text, sender, photo }) => ({ text, sender, photo })), null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'voprosy-zamka.json'; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      $('settings-message').textContent = 'Вопросы экспортированы в JSON.';
    } catch (error) { $('settings-message').textContent = error.message; }
  }
  async function importQuestions(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 2000000) throw new Error('Файл слишком большой. Максимум — 2 МБ.');
      const questions = G.parseQuestions(await file.text(), file.name);
      if (!confirm(`Заменить текущий список в редакторе? В файле вопросов: ${questions.length}.`)) return;
      editorDraft = questions.map(q => ({ ...q })); draftDemo = false; renderEditor();
      $('settings-message').textContent = `Импортировано вопросов: ${questions.length}. Нажмите «Сохранить».`;
    } catch (error) { $('settings-message').textContent = error.message; }
    finally { event.target.value = ''; }
  }
  function closeSettings() {
    const dirty = JSON.stringify(editorDraft) !== JSON.stringify(state.questions) || pendingSettingsReset || String(state.duration) !== $('duration').value || state.sound !== $('sound-enabled').checked || String(state.volume) !== $('volume').value;
    if (dirty && !confirm('Закрыть настройки без сохранения изменений?')) return;
    $('settings-dialog').close();
  }
  function openDuration() {
    if (spinning) return;
    pauseTimer(); $('quick-duration').value = state.duration; $('duration-dialog').showModal();
  }
  function openQuestionPicker() {
    if (spinning) return;
    pauseTimer(); $('question-search').value = ''; renderQuestionPicker(); $('question-picker').showModal();
  }
  function renderQuestionPicker() {
    const search = $('question-search').value.trim().toLocaleLowerCase('ru');
    const list = $('question-list'); list.replaceChildren();
    state.questions.forEach((q, i) => {
      if (search && !`${i + 1} ${G.senderName(q)} ${q.text}`.toLocaleLowerCase('ru').includes(search)) return;
      const button = document.createElement('button'); button.className = 'picker-question';
      button.setAttribute('aria-label', `Открыть вопрос ${i + 1}. Вопрос от ${G.senderName(q)}`);
      const number = document.createElement('span'); number.className = 'picker-number'; number.textContent = String(i + 1).padStart(2, '0');
      const details = document.createElement('span'); details.className = 'picker-details';
      const sender = document.createElement('strong'); sender.textContent = `Вопрос от ${G.senderName(q)}`;
      const text = document.createElement('span'); text.textContent = q.text; details.append(sender, text);
      const status = document.createElement('span'); status.className = 'picker-status';
      status.textContent = q.id === state.currentId ? 'Открыт' : state.used.includes(q.id) ? 'Сыгран' : 'Новый';
      button.classList.toggle('played', state.used.includes(q.id)); button.classList.toggle('current', q.id === state.currentId);
      button.append(number, details, status);
      button.addEventListener('click', () => {
        const selected = G.selectQuestion(state.questions, state.used, q.id);
        state.currentId = q.id; state.used = selected.used;
        state.rotation = G.targetRotation(i, state.questions.length, 0, 1) % 360;
        resetTimer(); renderWheel(); renderQuestion(); renderGame(); persist(); $('question-picker').close();
        announce(`Открыт вопрос номер ${i + 1}. Вопрос от ${G.senderName(q)}.`);
        toast(selected.revisited ? `Вопрос № ${i + 1} открыт повторно. Счёт сохранён.` : `Выбран вопрос № ${i + 1}.`);
      });
      list.append(button);
    });
    if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'settings-help'; empty.textContent = 'Вопросы не найдены.'; list.append(empty); }
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else toast('Используйте полноэкранный режим браузера: Ctrl + ⌘ + F на Mac или F11 на Windows.');
    } catch { toast('Используйте полноэкранный режим браузера: Ctrl + ⌘ + F на Mac или F11 на Windows.'); }
  }

  $('spin').addEventListener('click', spin);
  $('timer-start').addEventListener('click', toggleTimer);
  $('timer-reset').addEventListener('click', resetTimer);
  $('settings-open').addEventListener('click', openSettings);
  $('edit-questions').addEventListener('click', openSettings);
  $('question-picker-open').addEventListener('click', openQuestionPicker);
  $('question-picker-close').addEventListener('click', () => $('question-picker').close());
  $('question-search').addEventListener('input', renderQuestionPicker);
  $('settings-close').addEventListener('click', closeSettings);
  $('settings-dialog').addEventListener('cancel', event => { event.preventDefault(); closeSettings(); });
  $('save-settings').addEventListener('click', saveSettings);
  $('add-question').addEventListener('click', () => {
    if (editorDraft.length >= 200) return;
    editorDraft.push({ id: String(editorDraft.length + 1), text: '', sender: '', photo: '' }); renderEditor();
    $('question-editor').lastElementChild?.querySelector('textarea').focus();
  });
  $('clear-questions').addEventListener('click', () => {
    if (!editorDraft.some(q => q.text.trim()) || confirm('Удалить все вопросы из редактора? Изменения вступят в силу после сохранения.')) { editorDraft = [{ id: '1', text: '', sender: '', photo: '' }]; draftDemo = false; renderEditor(); }
  });
  $('import-button').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', importQuestions);
  $('export-button').addEventListener('click', exportQuestions);
  $('new-game').addEventListener('click', () => {
    if (confirm('Сбросить счёт и сыгранные вопросы после сохранения настроек?')) { pendingSettingsReset = true; $('settings-message').textContent = 'Игра начнётся заново после нажатия «Сохранить».'; }
  });
  $('sound-test').addEventListener('click', async () => {
    const oldSound = state.sound; const oldVolume = state.volume;
    state.sound = true; state.volume = Number($('volume').value);
    if (await unlockAudio()) revealSound();
    state.sound = oldSound; state.volume = oldVolume;
  });
  $('sound-toggle').addEventListener('click', async () => {
    state.sound = !state.sound; renderSound(); persist();
    if (state.sound) { await unlockAudio(); tone(392, .5, .12); toast('Звуки замка включены'); }
    else { if (audioContext?.state === 'running') await audioContext.suspend(); toast('Звук выключен'); }
  });
  $('fullscreen').addEventListener('click', fullscreen);
  document.addEventListener('fullscreenchange', () => { $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Выйти из полного экрана' : 'На весь экран'); });
  document.querySelectorAll('[data-score]').forEach(button => button.addEventListener('click', () => {
    const team = button.dataset.score;
    state.scores[team] = safeScore(state.scores[team] + Number(button.dataset.delta));
    renderGame(); persist();
    announce(`Счёт: знатоки ${state.scores.experts}, зрители ${state.scores.viewers}.`);
    if (Number(button.dataset.delta) > 0) { unlockAudio().then(() => tone(team === 'experts' ? 392 : 196, .5, .08)); }
  }));
  $('duration-open').addEventListener('click', openDuration);
  $('duration-cancel').addEventListener('click', () => $('duration-dialog').close());
  document.querySelectorAll('[data-duration]').forEach(button => button.addEventListener('click', () => { $('quick-duration').value = button.dataset.duration; }));
  $('duration-form').addEventListener('submit', event => {
    event.preventDefault();
    try { state.duration = G.duration($('quick-duration').value); resetTimer(); $('duration-dialog').close(); toast(`Время раунда: ${G.formatTime(state.duration * 1000)}`); }
    catch (error) { toast(error.message); }
  });
  document.addEventListener('keydown', event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input, textarea, select') || $('settings-dialog').open || $('duration-dialog').open || $('question-picker').open) return;
    if (event.code === 'Space' && !event.target.closest('button,a')) { event.preventDefault(); toggleTimer(); }
    else if (event.code === 'KeyW') { event.preventDefault(); spin(); }
    else if (event.code === 'KeyR') { event.preventDefault(); resetTimer(); }
    else if (event.code === 'KeyF') { event.preventDefault(); fullscreen(); }
    else if (event.code === 'KeyM') { event.preventDefault(); $('sound-toggle').click(); }
  });
  // Save the live deadline; a reload restores the timer paused at the real remainder.
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); else if (state.timer.running) renderTimer(); });
  renderWheel(); renderGame(); renderQuestion(); renderTimer(); renderSound(); persist();
})();
