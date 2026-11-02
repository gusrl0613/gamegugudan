/* 구구단 놀이터 */
(() => {
  'use strict';

  /* ================= 설정 ================= */
  const CFG = Object.assign({ sheetUrl: '', showRanking: true }, window.GUGUDAN_CONFIG || {});
  CFG.sheetUrl = String(CFG.sheetUrl || '').trim();
  const SHEET = /^https:\/\/script\.google\.com\/.+\/exec$/.test(CFG.sheetUrl);

  /* ================= 구구단 기본 ================= */
  const KN = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const COLORS = ['red', 'yellow', 'blue', 'green'];
  const ALL = Array.from({ length: 72 }, (_, k) => k);   // 문제 번호 k = (단-2)*9 + (곱하는 수-1)
  const pa = k => [Math.floor(k / 9) + 2, (k % 9) + 1];
  const pid = (a, b) => (a - 2) * 9 + (b - 1);
  const danColor = d => COLORS[(d - 2) % 4];
  const sino = n => n < 10 ? KN[n] : (Math.floor(n / 10) === 1 ? '' : KN[Math.floor(n / 10)]) + '십' + (n % 10 ? KN[n % 10] : '');
  const hangulEnd = s => { const c = s.charCodeAt(s.length - 1) - 0xAC00; return c >= 0 && c < 11172; };
  const hasBatchim = s => hangulEnd(s) && (s.charCodeAt(s.length - 1) - 0xAC00) % 28 !== 0;
  const chant = (a, b) => { const p = a * b, head = KN[a] + KN[b]; return p < 10 ? head + (hasBatchim(KN[b]) ? '은 ' : '는 ') + sino(p) : head + ' ' + sino(p); };
  const eul = s => hangulEnd(s) ? (hasBatchim(s) ? '을' : '를') : '을(를)';
  const eun = s => hangulEnd(s) ? (hasBatchim(s) ? '은' : '는') : '은(는)';
  const callName = n => hangulEnd(n) ? n + (hasBatchim(n) ? '아' : '야') : n;

  /* ================= 도우미 ================= */
  const NBSP = ' ';
  const $ = id => document.getElementById(id);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const rand = n => Math.floor(Math.random() * n);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const fmt = n => Number(n || 0).toLocaleString('ko-KR');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const mkStore = area => ({
    get(k, d) { try { const v = window[area].getItem('gugudan-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { window[area].setItem('gugudan-' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { window[area].removeItem('gugudan-' + k); } catch (e) { /* 무시 */ } }
  });
  const store = mkStore('localStorage');
  const sess = mkStore('sessionStorage');

  const cleanName = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const validName = n => n.length >= 1 && n.length <= 12 && /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]+$/.test(n);
  const nameKey = n => cleanName(n).toLowerCase();

  async function hashPin(salt, pin) {
    const text = salt + ':' + pin;
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      let h1 = 0x811c9dc5, h2 = 0x12345678;
      for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507); }
      return 'f' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
    }
  }
  const randomSalt = () => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join('');

  /* ================= 계정과 저장 ================= */
  const RANKS = [[0, '구구단 새싹'], [200, '구구단 꼬마 탐험가'], [600, '구구단 탐험가'], [1200, '구구단 기사'], [2500, '구구단 마법사'], [5000, '구구단 박사'], [10000, '구구단 왕']];
  const rankOf = p => { let i = 0; while (i + 1 < RANKS.length && p >= RANKS[i + 1][0]) i++; return i; };

  function normData(d, name) {
    d = d && typeof d === 'object' ? d : {};
    const fix = (s, m) => { s = String(s || ''); let r = ''; for (let i = 0; i < 72; i++) r += s.charAt(i) === m ? m : '.'; return r; };
    return {
      name: cleanName(d.name) || name,
      points: Math.max(0, Math.floor(Number(d.points) || 0)),
      solved: fix(d.solved, 'o'),
      weak: fix(d.weak, 'x'),
      best: d.best && typeof d.best === 'object' ? Object.assign({}, d.best) : {},
      correct: Number(d.correct) || 0,
      wrong: Number(d.wrong) || 0
    };
  }
  const newPend = () => ({ points: 0, solvedAdd: new Set(), weakAdd: new Set(), weakDel: new Set(), best: {}, correct: 0, wrong: 0 });

  let acct = null;   // { mode: 'guest'|'local'|'sheet', name, pin, data, pend }
  const isSolved = k => acct.data.solved[k] === 'o';
  const isWeak = k => acct.data.weak[k] === 'x';
  const setAt = (s, k, c) => s.slice(0, k) + c + s.slice(k + 1);
  const stampCount = () => { let n = 0; for (const c of acct.data.solved) if (c === 'o') n++; return n; };

  const Local = {
    load() { const v = store.get('accounts', null); return v && typeof v === 'object' ? v : {}; },
    async login(name, pin, create) {
      const accs = this.load(), key = nameKey(name), acc = accs[key];
      if (!acc) {
        if (!create) return { ok: false, error: 'not_found' };
        const salt = randomSalt();
        accs[key] = { salt, hash: await hashPin(salt, pin), data: normData(null, name) };
        if (!store.set('accounts', accs)) return { ok: false, error: 'no_storage' };
        return { ok: true, created: true, data: accs[key].data };
      }
      if (await hashPin(acc.salt, pin) !== acc.hash) return { ok: false, error: 'wrong_pin' };
      return { ok: true, data: normData(acc.data, name) };
    },
    async save() {
      const accs = this.load(), key = nameKey(acct.name);
      if (!accs[key]) return { ok: false, error: 'not_found' };
      accs[key].data = acct.data;
      return store.set('accounts', accs) ? { ok: true } : { ok: false, error: 'no_storage' };
    },
    async rank() {
      const list = Object.values(this.load()).map(a => {
        const d = normData(a && a.data, '?');
        return { name: d.name, points: d.points, stamps: (d.solved.match(/o/g) || []).length };
      });
      list.sort((x, y) => y.points - x.points);
      return { ok: true, list: list.slice(0, 10) };
    }
  };

  async function api(body, keepalive) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : 0;
    try {
      const res = await fetch(CFG.sheetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined,
        keepalive: !!keepalive
      });
      const j = await res.json();
      return j && typeof j === 'object' ? j : { ok: false, error: 'bad_response' };
    } catch (e) {
      return { ok: false, error: 'network' };
    } finally {
      clearTimeout(timer);
    }
  }
  const Sheet = {
    login: (name, pin, create, code) => api({ action: 'login', name, pin, create: !!create, code: code || '' }),
    save: (a, p, keepalive) => api({
      action: 'save', name: a.name, pin: a.pin, points: p.points,
      solvedAdd: [...p.solvedAdd], weakAdd: [...p.weakAdd], weakDel: [...p.weakDel],
      best: p.best, correct: p.correct, wrong: p.wrong
    }, keepalive),
    rank: () => api({ action: 'rank' })
  };

  const pendEmpty = p => !p.points && !p.solvedAdd.size && !p.weakAdd.size && !p.weakDel.size && !Object.keys(p.best).length && !p.correct && !p.wrong;
  function mergePend(into, older) {
    into.points += older.points; into.correct += older.correct; into.wrong += older.wrong;
    older.solvedAdd.forEach(k => into.solvedAdd.add(k));
    older.weakAdd.forEach(k => { if (!into.weakDel.has(k)) into.weakAdd.add(k); });
    older.weakDel.forEach(k => { if (!into.weakAdd.has(k)) into.weakDel.add(k); });
    Object.keys(older.best).forEach(m => { into.best[m] = Math.max(into.best[m] || 0, older.best[m]); });
  }

  let saving = null;
  async function flush(keepalive) {
    if (!acct || acct.mode === 'guest') return { ok: true, skipped: true };
    if (acct.mode === 'local') {
      const r = await Local.save();
      setSaveState(r.ok ? 'saved' : 'error', r.error);
      return r;
    }
    while (saving) await saving;
    const a = acct;
    if (!a || a.mode !== 'sheet') return { ok: true };
    const p = a.pend;
    if (pendEmpty(p)) return { ok: true };
    a.pend = newPend();
    setSaveState('saving');
    saving = Sheet.save(a, p, keepalive);
    const r = await saving;
    saving = null;
    if (r.ok && r.data) {
      const sd = normData(r.data, a.name);
      a.data.points = sd.points + a.pend.points;
      let s = '';
      for (let k = 0; k < 72; k++) s += (sd.solved[k] === 'o' || a.data.solved[k] === 'o') ? 'o' : '.';
      a.data.solved = s;
      let w = sd.weak;
      a.pend.weakAdd.forEach(k => { w = setAt(w, k, 'x'); });
      a.pend.weakDel.forEach(k => { w = setAt(w, k, '.'); });
      a.data.weak = w;
      Object.keys(sd.best).forEach(m => { a.data.best[m] = Math.max(a.data.best[m] || 0, Number(sd.best[m]) || 0); });
      a.data.correct = sd.correct + a.pend.correct;
      a.data.wrong = sd.wrong + a.pend.wrong;
      if (acct === a) setSaveState('saved');
    } else {
      mergePend(a.pend, p);
      if (acct === a) setSaveState('error', r.error);
    }
    return r;
  }

  function setSaveState(st, err) {
    let text = '';
    if (!acct || acct.mode === 'guest') text = '손님은 포인트가 저장되지 않아요.';
    else if (st === 'saving') text = '저장하는 중…';
    else if (st === 'saved') text = acct.mode === 'sheet' ? '구글 시트에 저장했어요.' : '이 기기에 저장했어요.';
    else if (st === 'error') {
      text = '저장하지 못했어요.' + (err === 'network' ? ' 인터넷 연결을 확인해 주세요.' : err === 'no_storage' ? ' 이 브라우저는 저장이 막혀 있어요.' : err === 'wrong_pin' ? ' 암호가 바뀌었어요. 다시 로그인해 주세요.' : '');
    } else text = acct.mode === 'sheet' ? '포인트는 구글 시트에 저장돼요.' : '포인트는 이 기기에 저장돼요.';
    $('saveState').textContent = text;
    $('rSave').textContent = text;
    $('rSaveRetry').hidden = st !== 'error';
  }

  /* ================= 설정값 ================= */
  const state = { auto: true, dans: new Set([2, 3, 4, 5, 6, 7, 8, 9]), sound: true, hideAnswers: false };

  /* ================= 소리 ================= */
  let actx = null;
  function tone(freq, dur, type, when, vol) {
    if (!state.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime + (when || 0), o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.16, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(t); o.stop(t + dur + 0.03);
    } catch (e) { /* 소리를 못 내도 놀이는 계속 */ }
  }
  const sfx = {
    tap: () => tone(880, 0.05, 'sine', 0, 0.06),
    good: () => { tone(660, 0.12, 'triangle'); tone(990, 0.2, 'triangle', 0.09); },
    bad: () => { tone(220, 0.2, 'square', 0, 0.06); tone(165, 0.25, 'square', 0.12, 0.06); },
    pop: () => tone(1400, 0.05, 'square', 0, 0.05),
    hit: () => { tone(300, 0.08, 'sawtooth', 0, 0.07); tone(600, 0.1, 'triangle', 0.05); },
    level: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, 'triangle', i * 0.08)),
    end: () => [784, 659, 523].forEach((f, i) => tone(f, 0.18, 'triangle', i * 0.12))
  };

  /* ================= 화면·알림·꽃가루 ================= */
  const SCREENS = ['login', 'home', 'balloon', 'speed', 'monster', 'mole', 'memory', 'table', 'result'];
  function show(name) {
    SCREENS.forEach(s => { $('screen-' + s).hidden = s !== name; });
    try { window.scrollTo(0, 0); } catch (e) { /* 무시 */ }
  }

  let toastTimer = 0, toastPrio = 0;
  function toast(msg, ms, prio) {
    prio = prio || 1;
    const t = $('toast');
    if (!t.hidden && prio < toastPrio) return;
    toastPrio = prio;
    t.textContent = msg;
    t.hidden = false;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; toastPrio = 0; }, ms || 1600);
  }

  const cv = $('confetti');
  let parts = [], cfRaf = 0;
  function confetti(n) {
    if (reduceMotion || !cv.getContext) return;
    const W = innerWidth, H = innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(document.documentElement);
    const cols = ['--red', '--yellow', '--blue', '--green'].map(v => cs.getPropertyValue(v).trim() || '#FFC233');
    for (let i = 0; i < (n || 80); i++) {
      parts.push({ x: W / 2 + (Math.random() - 0.5) * W * 0.4, y: H * 0.3, vx: (Math.random() - 0.5) * 10, vy: -Math.random() * 10 - 3, w: 6 + Math.random() * 6, h: 4 + Math.random() * 4, c: cols[rand(4)], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, life: 0 });
    }
    if (!cfRaf) cfRaf = requestAnimationFrame(stepConfetti);
  }
  function stepConfetti() {
    const ctx = cv.getContext('2d'), W = innerWidth, H = innerHeight;
    ctx.clearRect(0, 0, W, H);
    parts.forEach(p => {
      p.vy += 0.25; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life++;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    });
    parts = parts.filter(p => p.y < H + 30 && p.life < 260);
    if (parts.length) cfRaf = requestAnimationFrame(stepConfetti);
    else { ctx.clearRect(0, 0, W, H); cfRaf = 0; }
  }

  function floatOn(el, text, bad) {
    const r = el.getBoundingClientRect(), f = document.createElement('span');
    f.className = 'float float-fixed' + (bad ? ' bad' : '');
    f.textContent = text;
    f.style.left = (r.left + r.width / 2) + 'px';
    f.style.top = (r.top + r.height * 0.3) + 'px';
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 950);
  }
  function flash(el, cls) {
    el.classList.remove('good', 'bad'); void el.offsetWidth; el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 700);
  }

  /* ================= 로그인 ================= */
  const LOGIN_ERR = {
    wrong_pin: '암호가 맞지 않아요. 다시 넣어 주세요. 잊어버렸다면 선생님께 말씀드려요.',
    need_code: '처음 만드는 이름이라 반 코드가 필요해요. 선생님께 받은 반 코드를 넣어 주세요.',
    wrong_code: '반 코드가 맞지 않아요. 다시 확인해 주세요.',
    bad_name: '이름은 한글, 영어, 숫자로 12글자까지 쓸 수 있어요.',
    bad_pin: '암호는 숫자 4~8자리로 넣어 주세요.',
    network: '저장 서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.',
    no_storage: '이 브라우저는 저장이 막혀 있어요. 손님으로 하거나 다른 브라우저를 써 주세요.',
    busy: '들어오는 사람이 많아요. 잠깐 뒤에 다시 눌러 주세요.'
  };
  const loginMsg = t => { $('loginMsg').textContent = t || ''; };
  function setLoginBusy(b) {
    $('loginBtn').disabled = b; $('createBtn').disabled = b;
    $('loginBtn').textContent = b ? '확인하는 중…' : '들어가기';
  }
  function resetConfirm() { $('confirmNew').hidden = true; $('loginBtn').hidden = false; }

  async function tryLogin(create) {
    const name = cleanName($('loginName').value), pin = $('loginPin').value.trim(), code = $('loginCode').value.trim();
    loginMsg('');
    if (!name) { loginMsg('이름을 넣어 주세요.'); $('loginName').focus(); return; }
    if (!validName(name)) { loginMsg(LOGIN_ERR.bad_name); $('loginName').focus(); return; }
    if (!/^\d{4,8}$/.test(pin)) { loginMsg(LOGIN_ERR.bad_pin); $('loginPin').focus(); return; }
    setLoginBusy(true);
    const r = SHEET ? await Sheet.login(name, pin, create, code) : await Local.login(name, pin, create);
    setLoginBusy(false);
    if (r.ok) { resetConfirm(); beginSession(SHEET ? 'sheet' : 'local', name, pin, r.data, r.created); return; }
    if (r.error === 'not_found') {
      $('confirmText').textContent = '‘' + name + '’' + eun(name) + ' 처음 보는 이름이에요. 이 이름과 암호로 새로 만들까요? 암호를 꼭 기억해 두세요.';
      $('confirmNew').hidden = false; $('loginBtn').hidden = true;
      $('createBtn').focus();
      return;
    }
    if (r.error === 'need_code' || r.error === 'wrong_code') {
      $('codeRow').hidden = false; $('confirmNew').hidden = false; $('loginBtn').hidden = true;
      $('loginCode').focus();
    }
    loginMsg(LOGIN_ERR[r.error] || '들어가지 못했어요. 잠시 뒤에 다시 해 주세요.');
  }

  function beginSession(mode, name, pin, data, created) {
    acct = { mode, name, pin, data: normData(data, name), pend: newPend() };
    acct.name = acct.data.name;
    if (mode !== 'guest') sess.set('session', { mode, name: acct.name, pin });
    $('loginPin').value = '';
    goHome();
    if (created) toast('반가워요, ' + acct.name + '! 도장판 72칸을 채워 봐요', 2400, 2);
  }

  async function restoreSession() {
    show('login');
    const s = sess.get('session', null);
    if (!s || !s.name || !s.pin || s.mode !== (SHEET ? 'sheet' : 'local')) return;
    loginMsg('들어가는 중…');
    const r = SHEET ? await Sheet.login(s.name, s.pin, false) : await Local.login(s.name, s.pin, false);
    loginMsg('');
    if (r.ok) beginSession(s.mode, s.name, s.pin, r.data, false);
    else { sess.del('session'); $('loginName').value = s.name; }
  }

  async function logout() {
    stopGame();
    const a = acct;
    if (a && a.mode !== 'guest') {
      const r = await flush();
      if (!r.ok && !a.forceOut) {
        a.forceOut = true;
        toast('저장하지 못한 포인트가 있어요. 한 번 더 누르면 저장하지 않고 나가요.', 3000, 3);
        return;
      }
    }
    acct = null;
    sess.del('session');
    $('meChip').hidden = true;
    resetConfirm(); loginMsg('');
    show('login');
  }

  /* ================= 첫 화면 ================= */
  function goHome() {
    stopGame();
    if (!acct) { show('login'); return; }
    renderHome();
    show('home');
    flush().then(() => { if (acct) { renderPoints(); loadRanking(); } });
  }

  function renderHome() {
    $('helloText').textContent = acct.mode === 'guest' ? '손님, 반가워요! 구구단 놀이를 해 볼까요?' : callName(acct.name) + ', 오늘도 구구단 해 볼까?';
    $('logoutBtn').textContent = acct.mode === 'guest' ? '로그인하기' : '나가기';
    $('rankPanel').hidden = !CFG.showRanking;
    renderPoints(); renderStamps(); renderSource(); renderBests();
    setSaveState('idle');
  }

  function renderPoints() {
    const p = acct.data.points, i = rankOf(p);
    $('pointsBig').textContent = fmt(p);
    $('rankName').textContent = RANKS[i][1];
    if (i + 1 < RANKS.length) {
      const lo = RANKS[i][0], hi = RANKS[i + 1][0];
      $('rankBar').style.width = Math.round((p - lo) / (hi - lo) * 100) + '%';
      $('rankNext').textContent = RANKS[i + 1][1] + '까지 ' + fmt(hi - p) + 'P';
    } else {
      $('rankBar').style.width = '100%';
      $('rankNext').textContent = '가장 높은 칭호예요!';
    }
    renderMeChip();
  }
  function renderMeChip() {
    $('meChip').textContent = acct.name + ' · ' + fmt(acct.data.points) + 'P';
    $('meChip').hidden = false;
  }

  function renderStamps() {
    let html = '<span class="sb-head"></span>';
    for (let b = 1; b <= 9; b++) html += '<span class="sb-head">×' + b + '</span>';
    for (let a = 2; a <= 9; a++) {
      let full = true, cells = '';
      for (let b = 1; b <= 9; b++) {
        const k = pid(a, b), s = isSolved(k), w = isWeak(k);
        if (!s) full = false;
        cells += '<span class="sb-cell' + (s ? ' on b-' + danColor(a) : '') + (w ? ' weak' : '') + '">' + (s ? a * b : '') + '</span>';
      }
      html += '<span class="sb-row' + (full ? ' full' : '') + '">' + a + '단</span>' + cells;
    }
    const n = stampCount();
    $('stampBoard').innerHTML = html;
    $('stampBoard').setAttribute('aria-label', '구구단 도장판: 72칸 중 ' + n + '칸에 도장');
    $('stampNum').textContent = n;
    $('stampMsg').textContent = n === 72
      ? '도장판을 다 채웠어요! 이제는 틀린 문제와 섞어서 복습해요.'
      : n === 0 ? '문제를 맞히면 그 칸에 도장이 찍혀요. 72칸을 다 채우면 구구단 표가 완성돼요!'
        : '남은 칸 ' + (72 - n) + '개. 빨간 테두리는 다시 볼 문제예요.';
    updateStampCounters(false);
  }
  function updateStampCounters(bump) {
    const n = stampCount();
    $$('.js-stamps').forEach(el => {
      el.textContent = n;
      if (bump) { const p = el.closest('.hud-stat'); p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }
    });
  }

  function buildChips() {
    const wrap = $('danChips');
    wrap.innerHTML = '';
    for (let d = 2; d <= 9; d++) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'dan' + d; b.className = 'chip b-' + danColor(d); b.textContent = d + '단';
      b.addEventListener('click', () => { if (state.dans.has(d)) state.dans.delete(d); else state.dans.add(d); syncChips(); sfx.tap(); });
      wrap.appendChild(b);
    }
  }
  function renderSource() {
    $('srcAuto').setAttribute('aria-pressed', String(state.auto));
    $('srcPick').setAttribute('aria-pressed', String(!state.auto));
    $('pickBox').hidden = state.auto;
    $('srcHelp').textContent = state.auto
      ? '도장을 아직 못 받은 문제가 먼저 나와요. 낮은 단부터 차례로 늘어나고, 틀린 문제는 다시 나와요.'
      : '고른 단에서만 문제가 나와요. 틀린 문제는 다시 나와요.';
    syncChips();
  }
  function syncChips() {
    for (let d = 2; d <= 9; d++) $('dan' + d).setAttribute('aria-pressed', String(state.dans.has(d)));
    $('allBtn').textContent = state.dans.size === 8 ? '모두 지우기' : '모두 고르기';
    $('danWarn').hidden = state.auto || state.dans.size > 0;
    $$('.mode').forEach(m => { m.disabled = !state.auto && state.dans.size === 0; });
    store.set('dans', Array.from(state.dans));
    store.set('auto', state.auto);
  }
  function renderBests() {
    ['balloon', 'monster', 'mole', 'speed', 'memory'].forEach(m => { $('best-' + m).textContent = '최고 ' + fmt(acct.data.best[m] || 0) + 'P'; });
  }
  function syncSound() {
    $('soundBtn').setAttribute('aria-pressed', String(state.sound));
    $('soundBtn').textContent = state.sound ? '소리 켜짐' : '소리 꺼짐';
  }

  let rankSeq = 0;
  async function loadRanking() {
    if (!CFG.showRanking) return;
    const seq = ++rankSeq, list = $('rankList');
    $('rankTitle').textContent = SHEET ? '우리 반 포인트 순위' : '이 기기 포인트 순위';
    if (!list.children.length) list.innerHTML = '<li class="rank-empty">불러오는 중…</li>';
    const r = SHEET ? await Sheet.rank() : await Local.rank();
    if (seq !== rankSeq) return;
    if (!r.ok || !Array.isArray(r.list)) { list.innerHTML = '<li class="rank-empty">순위를 불러오지 못했어요.</li>'; return; }
    if (!r.list.length) { list.innerHTML = '<li class="rank-empty">아직 아무도 없어요. 첫 번째 주인공이 되어 봐요!</li>'; return; }
    const me = acct && acct.mode !== 'guest' ? nameKey(acct.name) : '';
    list.innerHTML = r.list.map((x, i) =>
      '<li class="' + (nameKey(x.name) === me ? 'me' : '') + '"><span class="rk">' + (i + 1) + '</span><span class="nm">' + esc(x.name) +
      '</span><span class="st">도장 ' + (Number(x.stamps) || 0) + '</span><span class="pt">' + fmt(x.points) + 'P</span></li>').join('');
  }

  /* ================= 문제 내기 ================= */
  let game = null, lastGame = null;
  const GAME_NAMES = { balloon: '풍선 터뜨리기', speed: '60초 도전', monster: '몬스터 대결', mole: '두더지 잡기', memory: '짝 맞추기' };

  function newGame(mode, pool) {
    stopGame();
    const fixed = pool && pool.length ? pool.slice() : null;
    let base = fixed || (state.auto ? ALL.slice() : ALL.filter(k => state.dans.has(pa(k)[0])));
    if (!base.length) base = ALL.slice();
    game = {
      mode, auto: !fixed && state.auto, pool: base, recent: [],
      earned: 0, correct: 0, rounds: 0, combo: 0, maxCombo: 0, wrong: [], newStamps: 0,
      running: true, locked: true, timers: [], raf: 0, tick: 0, typing: false, input: '',
      startRank: rankOf(acct.data.points)
    };
    lastGame = { mode, pool: fixed };
    updateEarned();
    updateStampCounters(false);
    return game;
  }

  // 자동: 도장 없는 문제를 낮은 단부터(가장 낮은 세 단) 내고, 틀린 문제를 섞는다.
  function nextProblem(exclude) {
    const g = game;
    let cand;
    if (g.auto) {
      const unsolved = ALL.filter(k => !isSolved(k)), weak = ALL.filter(isWeak);
      let front = unsolved;
      if (unsolved.length) {
        const dans = [...new Set(unsolved.map(k => Math.floor(k / 9)))].slice(0, 3);
        front = unsolved.filter(k => dans.includes(Math.floor(k / 9)));
      }
      if (weak.length && (Math.random() < 0.3 || !unsolved.length)) cand = weak;
      else if (front.length) cand = front;
      else cand = ALL;
    } else {
      const weakIn = g.pool.filter(isWeak);
      cand = weakIn.length && Math.random() < 0.3 ? weakIn : g.pool;
    }
    const ex = k => exclude && exclude.has(k);
    let opts = cand.filter(k => !g.recent.includes(k) && !ex(k));
    if (!opts.length) opts = cand.filter(k => !ex(k));
    if (!opts.length && g.auto) opts = ALL.filter(k => !g.recent.includes(k) && !ex(k));
    if (!opts.length) opts = cand;
    const k = opts[rand(opts.length)];
    g.recent.push(k);
    if (g.recent.length > Math.min(3, g.pool.length - 1)) g.recent.shift();
    return k;
  }

  function choices(a, b, n) {
    n = n || 3;
    const p = a * b, rev = p >= 10 && p % 10 ? (p % 10) * 10 + Math.floor(p / 10) : -1;
    const near = [a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b, rev, a * (b + 2), (a + 2) * b];
    const far = [p + 1, p - 1, p + 2, p - 2, p + 10, p - 10, p + 5, p - 5];
    const used = new Set([p]), out = [];
    const take = (list, m) => shuffle(list.slice()).forEach(v => { if (out.length < m && v > 0 && v < 100 && !used.has(v)) { used.add(v); out.push(v); } });
    take(near, Math.ceil(n * 0.6));
    take(near.concat(far), n);
    return shuffle([p].concat(out));
  }

  // 한 문제의 결과를 기록하고 받은 포인트를 돌려준다. ok=true는 한 번에 맞힌 것.
  function record(k, ok) {
    const g = game, d = acct.data, p = acct.pend, [a] = pa(k);
    let pts = 0, stamp = false, row = false, all = false;
    if (ok) {
      g.combo++; g.maxCombo = Math.max(g.maxCombo, g.combo); g.correct++;
      d.correct++; p.correct++;
      pts = 10 + Math.min(g.combo - 1, 5) * 2;
      if (!isSolved(k)) {
        d.solved = setAt(d.solved, k, 'o'); p.solvedAdd.add(k);
        pts += 5; g.newStamps++; stamp = true;
        row = ALL.filter(x => Math.floor(x / 9) === a - 2).every(isSolved);
        all = stampCount() === 72;
      }
      if (isWeak(k)) { d.weak = setAt(d.weak, k, '.'); p.weakDel.add(k); p.weakAdd.delete(k); }
    } else {
      g.combo = 0;
      d.wrong++; p.wrong++;
      if (!g.wrong.includes(k)) g.wrong.push(k);
      d.weak = setAt(d.weak, k, 'x'); p.weakAdd.add(k); p.weakDel.delete(k);
    }
    if (pts) addPoints(pts);
    updateStampCounters(stamp);
    if (all) { toast('도장판 72칸을 다 채웠어요! 구구단 완성!', 3000, 4); confetti(180); sfx.level(); }
    else if (row) { toast(a + '단 도장을 다 모았어요!', 2200, 3); confetti(90); sfx.level(); }
    else if (ok && g.combo >= 5 && g.combo % 5 === 0) toast(g.combo + '번 연속 정답!', 1400, 1);
    return pts;
  }

  function addPoints(n) {
    const before = rankOf(acct.data.points);
    acct.data.points += n;
    acct.pend.points += n;
    if (game) game.earned += n;
    updateEarned();
    renderMeChip();
    const after = rankOf(acct.data.points);
    if (after > before) { toast('새 칭호를 받았어요: ' + RANKS[after][1] + '!', 2600, 3); confetti(120); sfx.level(); }
  }
  function updateEarned() { $$('.js-earned').forEach(el => { el.textContent = '+' + fmt(game ? game.earned : 0); }); }

  function setProblem(p, a, b) {
    $(p + 'A').textContent = a;
    $(p + 'B').textContent = b;
    const q = $(p + 'Q');
    q.textContent = '?';
    q.className = 'qbox';
  }
  function revealAnswer(p, ans, ok) {
    const q = $(p + 'Q');
    q.textContent = ans;
    q.className = 'qbox ' + (ok ? 'is-right' : 'is-told');
  }
  function later(fn, ms) {
    const g = game;
    g.timers.push(setTimeout(() => { if (game === g && g.running) fn(); }, ms));
  }
  function stopGame() {
    const g = game;
    if (!g) return;
    g.running = false;
    cancelAnimationFrame(g.raf);
    clearInterval(g.tick);
    g.timers.forEach(clearTimeout);
    if (g.cleanup) g.cleanup();
    game = null;
  }
  function endGame() {
    const g = game;
    if (!g || !g.running) return;
    stopGame();
    sfx.end();
    showResult(g);
  }

  const HEART = '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>';
  function renderHearts(id, n, broke) {
    let html = '';
    for (let i = 0; i < 3; i++) html += '<svg class="heart' + (i < n ? '' : ' lost' + (broke && i === n ? ' breaking' : '')) + '" viewBox="0 0 24 24" aria-hidden="true">' + HEART + '</svg>';
    $(id).innerHTML = html;
    $(id).setAttribute('aria-label', '남은 하트 ' + n + '개');
  }

  /* ================= 숫자 입력 (바로 채점) ================= */
  function buildPads() {
    ['sPad', 'mPad'].forEach(id => {
      const pad = $(id);
      pad.innerHTML = '';
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', '0', 'del'].forEach(k => {
        const b = document.createElement('button');
        b.type = 'button'; b.id = id + '-' + k; b.dataset.k = k;
        b.className = 'key' + (k === 'del' ? ' key-del' : k === 'skip' ? ' key-skip' : '');
        b.textContent = k === 'del' ? '지우기' : k === 'skip' ? '모르겠어요' : k;
        b.addEventListener('click', () => padPress(k));
        pad.appendChild(b);
      });
    });
  }
  function nextTyped() {
    const g = game, k = nextProblem(), [a, b] = pa(k);
    g.k = k; g.ans = a * b; g.input = '';
    setProblem(g.prefix, a, b);
    $(g.prefix + 'Chant').textContent = NBSP;
    g.locked = false;
  }
  function renderTyped() {
    const q = $(game.prefix + 'Q');
    q.textContent = game.input || '?';
    q.className = 'qbox' + (game.input ? ' filled' : '');
  }
  function padPress(k) {
    const g = game;
    if (!g || !g.typing || !g.running || g.locked) return;
    if (k === 'skip') { g.onAnswer(false, 'skip'); return; }
    if (k === 'del') { g.input = g.input.slice(0, -1); renderTyped(); sfx.tap(); return; }
    if (g.input.length >= 2) return;
    g.input = (g.input === '0' ? '' : g.input) + k;
    renderTyped(); sfx.tap();
    const ans = String(g.ans);
    if (g.input === ans) g.onAnswer(true, 'ok');
    else if (g.input.length >= ans.length) g.onAnswer(false, 'wrong');
  }
  // 맞으면 초록, 틀리면 쓴 답을 빨갛게 보여 주고 정답을 알려 준다.
  function typedFeedback(prefix, ok, k, mine, lead) {
    const [a, b] = pa(k), ans = a * b, q = $(prefix + 'Q'), ch = $(prefix + 'Chant');
    if (ok) {
      q.textContent = ans; q.className = 'qbox is-right';
      ch.textContent = chant(a, b);
      flash($(prefix + 'Board'), 'good');
      return;
    }
    flash($(prefix + 'Board'), 'bad');
    const tellHtml = (mine ? '<s class="bad-num">' + esc(mine) + '</s> ' : esc(lead || '')) + '정답은 <b>' + ans + '</b> · ' + chant(a, b);
    if (mine) {
      q.textContent = mine; q.className = 'qbox is-wrong';
      ch.textContent = '틀렸어요!';
      later(() => { q.textContent = ans; q.className = 'qbox is-told'; ch.innerHTML = tellHtml; }, 750);
    } else {
      q.textContent = ans; q.className = 'qbox is-told';
      ch.innerHTML = tellHtml;
    }
  }

  /* ================= 풍선 터뜨리기 ================= */
  function startBalloon(pool) {
    const g = newGame('balloon', pool);
    g.hearts = 3; g.level = 1; g.balloons = [];
    g.cleanup = clearStage;
    show('balloon');
    $('bLevel').textContent = '1';
    renderHearts('bHearts', 3, false);
    newRound();
    g.prev = performance.now();
    g.raf = requestAnimationFrame(loop);
  }
  function clearStage() {
    $('stage').querySelectorAll('.balloon, .bit').forEach(n => n.remove());
    if (game) game.balloons = [];
  }
  const riseTime = () => Math.max(4.2, 9.5 - (game.level - 1) * 0.7);
  function laneX(bl, W) {
    const lane = W / 4, slack = Math.max(0, (lane - game.bw) / 2);
    bl.x = lane * bl.i + slack + bl.jit * Math.min(8, slack);
  }
  function place(bl, ts) {
    const sway = Math.sin(ts * 1.7 + bl.phase) * 7;
    bl.el.style.transform = 'translate(' + (bl.x + sway).toFixed(1) + 'px,' + bl.y.toFixed(1) + 'px)';
  }
  function newRound() {
    const g = game;
    clearStage();
    const k = nextProblem(), [a, b] = pa(k);
    g.k = k; g.cur = { a, b, ans: a * b, slip: false };
    setProblem('b', a, b);
    $('bChant').textContent = NBSP;
    const stage = $('stage'), W = stage.clientWidth, H = stage.clientHeight;
    g.bw = Math.round(Math.max(56, Math.min(94, W / 4 - 16)));
    g.bh = g.bw * 1.22; g.tail = g.bw * 0.62;
    const vals = choices(a, b), cols = shuffle(COLORS.slice()), rise = riseTime(), ts = performance.now() / 1000;
    vals.forEach((v, i) => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'balloon b-' + cols[i];
      el.style.setProperty('--bw', g.bw + 'px');
      el.setAttribute('aria-label', '답 ' + v);
      el.innerHTML = '<span class="num">' + v + '</span><i class="knot" aria-hidden="true"></i>';
      const bl = {
        el, i, v, cls: 'b-' + cols[i], x: 0, y: H - 10 + Math.random() * 70, jit: Math.random() * 2 - 1,
        phase: Math.random() * 6.283, dead: false, wrong: false,
        speed: (H + g.bh + g.tail + 80) / rise * (0.88 + Math.random() * 0.24)
      };
      laneX(bl, W);
      el.addEventListener('pointerdown', e => { e.preventDefault(); hitBalloon(bl); });
      el.addEventListener('click', e => { if (e.detail === 0) hitBalloon(bl); });
      stage.appendChild(el);
      g.balloons.push(bl);
      place(bl, ts);
    });
    g.locked = false;
  }
  function loop(t) {
    const g = game;
    if (!g || g.mode !== 'balloon' || !g.running) return;
    const dt = Math.min(0.05, Math.max(0, (t - g.prev) / 1000)), ts = t / 1000;
    g.prev = t;
    g.balloons.forEach(bl => { if (!bl.dead) { bl.y -= bl.speed * dt; place(bl, ts); } });
    if (!g.locked) {
      const c = g.balloons.find(bl => bl.v === g.cur.ans);
      if (c && c.y < -(g.bh + g.tail)) balloonEscaped();
    }
    g.raf = requestAnimationFrame(loop);
  }
  function hitBalloon(bl) {
    const g = game;
    if (!g || g.mode !== 'balloon' || !g.running || g.locked || bl.dead || bl.wrong) return;
    const { a, b, ans } = g.cur;
    if (bl.v === ans) {
      g.locked = true; g.rounds++; bl.dead = true;
      burst(bl); sfx.pop(); sfx.good();
      let gain;
      if (!g.cur.slip) gain = record(g.k, true);
      else { gain = 3; addPoints(3); }
      floatOn(bl.el, '+' + gain);
      revealAnswer('b', ans, true);
      $('bChant').textContent = chant(a, b);
      flash($('bBoard'), 'good');
      let wait = 900;
      if (!g.cur.slip && g.correct % 5 === 0) {
        g.level++;
        $('bLevel').textContent = g.level;
        toast('레벨 ' + g.level + '! 풍선이 더 빨라져요', 1300, 1);
        sfx.level();
        wait = 1400;
      }
      later(newRound, wait);
    } else {
      bl.wrong = true;
      bl.el.classList.add('is-wrong');
      bl.el.disabled = true;
      bl.el.setAttribute('aria-label', '틀린 답 ' + bl.v);
      sfx.bad();
      flash($('bBoard'), 'bad');
      floatOn(bl.el, '틀렸어요', true);
      if (!g.cur.slip) record(g.k, false); else g.combo = 0;
      g.cur.slip = true;
      g.hearts--;
      renderHearts('bHearts', g.hearts, true);
      if (g.hearts <= 0) { g.locked = true; g.rounds++; tellBalloon(); later(endGame, 1700); }
    }
  }
  function balloonEscaped() {
    const g = game;
    g.locked = true; g.rounds++;
    if (!g.cur.slip) record(g.k, false); else g.combo = 0;
    sfx.bad();
    tellBalloon();
    flash($('bBoard'), 'bad');
    toast('풍선을 놓쳤어요! ' + g.cur.a + ' × ' + g.cur.b + ' = ' + g.cur.ans, 1500, 1);
    g.hearts--;
    renderHearts('bHearts', g.hearts, true);
    later(g.hearts <= 0 ? endGame : newRound, 1700);
  }
  function tellBalloon() {
    const g = game;
    revealAnswer('b', g.cur.ans, false);
    $('bChant').innerHTML = '정답은 <b>' + g.cur.ans + '</b> · ' + chant(g.cur.a, g.cur.b);
    const c = g.balloons.find(x => x.v === g.cur.ans);
    if (c && !c.dead) c.el.classList.add('is-answer');
  }
  function burst(bl) {
    const stage = $('stage'), r = bl.el.getBoundingClientRect(), s = stage.getBoundingClientRect();
    const cx = r.left - s.left + r.width / 2, cy = r.top - s.top + r.height / 2;
    bl.el.classList.add('popped');
    for (let i = 0; i < 10; i++) {
      const d = document.createElement('i'), ang = i / 10 * Math.PI * 2 + Math.random() * 0.4, dist = 40 + Math.random() * 40;
      d.className = 'bit ' + bl.cls;
      d.style.left = cx + 'px'; d.style.top = cy + 'px';
      d.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      d.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
      stage.appendChild(d);
      setTimeout(() => d.remove(), 700);
    }
  }

  /* ================= 60초 도전 ================= */
  function startSpeed(pool) {
    const g = newGame('speed', pool);
    g.typing = true; g.prefix = 's';
    g.endAt = performance.now() + 60000;
    g.onAnswer = (ok, why) => {
      g.locked = true; g.rounds++;
      const pts = record(g.k, ok);
      typedFeedback('s', ok, g.k, why === 'wrong' ? g.input : '', why === 'skip' ? '괜찮아요. ' : '');
      if (ok) { $('sCorrect').textContent = g.correct; sfx.good(); floatOn($('sQ'), '+' + pts); later(nextTyped, 450); }
      else { sfx.bad(); later(nextTyped, 1800); }
    };
    show('speed');
    $('sCorrect').textContent = '0';
    nextTyped();
    g.tick = setInterval(() => tickTimer('s', g), 100);
    tickTimer('s', g);
  }
  function tickTimer(prefix, g) {
    if (game !== g || !g.running) return;
    const left = Math.max(0, (g.endAt - performance.now()) / 1000);
    $(prefix + 'Time').textContent = Math.ceil(left);
    $(prefix + 'Bar').style.transform = 'scaleX(' + Math.min(1, left / 60).toFixed(3) + ')';
    $(prefix + 'Timer').classList.toggle('hurry', left <= 10);
    if (left <= 0) endGame();
  }

  /* ================= 몬스터 대결 ================= */
  const MONSTERS = [
    { name: '말랑이', body: '#5CC98B', eyes: 2 },
    { name: '뿔뿔이', body: '#9B7BEA', eyes: 2, horns: true },
    { name: '눈셋이', body: '#F59E4C', eyes: 3 },
    { name: '외눈이', body: '#4FB3E8', eyes: 1, horns: true },
    { name: '가시대장', body: '#E85D6A', eyes: 2, horns: true, spikes: true }
  ];
  function monsterSVG(m) {
    const c = m.body, L = 'currentColor';
    let s = '<svg viewBox="0 0 200 196" aria-hidden="true">';
    if (m.horns) s += '<path d="M62 56 L50 10 L90 44 Z M138 56 L150 10 L110 44 Z" fill="#F6E7BE" stroke="' + L + '" stroke-width="5" stroke-linejoin="round"/>';
    if (m.spikes) s += '<path d="M74 42 L86 12 L100 36 L114 12 L126 42 Z" fill="' + c + '" stroke="' + L + '" stroke-width="5" stroke-linejoin="round"/>';
    s += '<ellipse cx="66" cy="182" rx="22" ry="10" fill="' + c + '" stroke="' + L + '" stroke-width="5"/>';
    s += '<ellipse cx="134" cy="182" rx="22" ry="10" fill="' + c + '" stroke="' + L + '" stroke-width="5"/>';
    s += '<path d="M100 30 C156 30 186 72 186 120 C186 162 152 180 100 180 C48 180 14 162 14 120 C14 72 44 30 100 30 Z" fill="' + c + '" stroke="' + L + '" stroke-width="5"/>';
    s += '<ellipse cx="100" cy="148" rx="54" ry="24" fill="#FFFFFF" opacity=".22"/>';
    s += '<ellipse cx="44" cy="124" rx="12" ry="8" fill="#FF8FA3" opacity=".75"/><ellipse cx="156" cy="124" rx="12" ry="8" fill="#FF8FA3" opacity=".75"/>';
    const eyes = m.eyes === 1 ? [[100, 84, 25]] : m.eyes === 3 ? [[62, 92, 15], [100, 74, 17], [138, 92, 15]] : [[72, 88, 18], [128, 88, 18]];
    eyes.forEach(([x, y, r]) => {
      s += '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#FFFFFF" stroke="' + L + '" stroke-width="4"/>';
      s += '<circle cx="' + (x + 3) + '" cy="' + (y + 3) + '" r="' + Math.round(r * 0.42) + '" fill="' + L + '"/>';
    });
    s += '<path d="M68 128 Q100 160 132 128 Z" fill="' + L + '"/><path d="M80 129 L87 140 L94 129 Z M106 129 L113 140 L120 129 Z" fill="#FFFFFF"/>';
    return s + '</svg>';
  }
  function startMonster(pool) {
    const g = newGame('monster', pool);
    g.typing = true; g.prefix = 'm'; g.hearts = 3; g.kills = 0; g.stage = 0;
    g.onAnswer = monsterAnswer;
    show('monster');
    renderHearts('mHearts', 3, false);
    $('mKills').textContent = '0';
    spawnMonster();
    nextMonsterQ();
    g.tick = setInterval(() => monsterTick(g), 100);
  }
  function spawnMonster() {
    const g = game, base = MONSTERS[g.stage % MONSTERS.length], lap = Math.floor(g.stage / MONSTERS.length);
    const hp = Math.min(10, 4 + g.stage);
    g.mon = { name: (lap ? '왕 ' : '') + base.name, hp, maxHp: hp, art: base };
    $('mName').textContent = g.mon.name;
    const el = $('monster');
    el.innerHTML = monsterSVG(base);
    el.className = 'monster'; void el.offsetWidth; el.className = 'monster appear';
    renderHp();
  }
  function renderHp() {
    const m = game.mon;
    let html = '';
    for (let i = 0; i < m.maxHp; i++) html += '<i class="' + (i < m.hp ? '' : 'off') + '"></i>';
    $('mHp').innerHTML = html;
    $('mHp').setAttribute('aria-label', '몬스터 체력 ' + m.hp + ' / ' + m.maxHp);
  }
  const qLimit = () => Math.max(4, 10 - game.stage * 0.8) * 1000;
  function nextMonsterQ() {
    nextTyped();
    game.qEnd = performance.now() + qLimit();
  }
  function monsterTick(g) {
    if (game !== g || !g.running || g.locked) return;
    const left = g.qEnd - performance.now();
    $('mQBar').style.transform = 'scaleX(' + Math.max(0, left / qLimit()).toFixed(3) + ')';
    if (left <= 0) monsterAnswer(false, 'timeout');
  }
  function monsterAnim(cls) {
    const el = $('monster');
    el.classList.remove('appear', 'hit', 'attack'); void el.offsetWidth; el.classList.add(cls);
  }
  function monsterAnswer(ok, why) {
    const g = game;
    if (!g || g.locked) return;
    g.locked = true; g.rounds++;
    const pts = record(g.k, ok);
    typedFeedback('m', ok, g.k, why === 'wrong' ? g.input : '', why === 'timeout' ? '시간이 다 됐어요. ' : why === 'skip' ? '괜찮아요. ' : '');
    if (ok) {
      sfx.hit();
      g.mon.hp--;
      renderHp();
      monsterAnim('hit');
      const arena = $('arena'), d = document.createElement('span');
      d.className = 'dmg'; d.textContent = ['퍽!', '쾅!', '얍!'][rand(3)];
      d.style.left = (35 + Math.random() * 30) + '%'; d.style.top = (30 + Math.random() * 20) + '%';
      arena.appendChild(d);
      setTimeout(() => d.remove(), 800);
      floatOn($('mQ'), '+' + pts);
      if (g.mon.hp <= 0) {
        g.kills++;
        $('mKills').textContent = g.kills;
        $('monster').classList.add('defeated');
        const name = g.mon.name;
        later(() => { addPoints(30); toast(name + eul(name) + ' 물리쳤어요! +30P', 1800, 2); confetti(70); sfx.level(); }, 350);
        g.stage++;
        later(() => { spawnMonster(); nextMonsterQ(); }, 1600);
      } else {
        later(nextMonsterQ, 550);
      }
    } else {
      sfx.bad();
      monsterAnim('attack');
      const arena = $('arena');
      arena.classList.remove('shake'); void arena.offsetWidth; arena.classList.add('shake');
      g.hearts--;
      renderHearts('mHearts', g.hearts, true);
      later(g.hearts <= 0 ? endGame : nextMonsterQ, 1900);
    }
  }

  /* ================= 두더지 잡기 ================= */
  function buildField() {
    $('field').innerHTML = Array.from({ length: 9 }, (_, i) =>
      '<div class="hole" id="hole-' + i + '"><span class="pit"></span><span class="mole-win">' +
      '<button class="mole" type="button" id="mole-' + i + '" disabled><span class="mole-eyes"><i></i><i></i></span>' +
      '<span class="mole-nose"></span><span class="mole-num"></span></button></span><span class="lip"></span></div>').join('');
    for (let i = 0; i < 9; i++) {
      const m = $('mole-' + i);
      m.addEventListener('pointerdown', e => { e.preventDefault(); whack(i); });
      m.addEventListener('click', e => { if (e.detail === 0) whack(i); });
    }
  }
  function moleDown(i, reset) {
    const el = $('hole-' + i);
    el.classList.remove('up');
    $('mole-' + i).disabled = true;
    if (reset) el.classList.remove('whacked', 'missed');
    if (game && game.holes) game.holes[i].up = false;
  }
  function startMole(pool) {
    const g = newGame('mole', pool);
    g.endAt = performance.now() + 60000;
    g.holes = Array.from({ length: 9 }, () => ({ up: false, v: 0, t: 0, hit: false }));
    g.cleanup = () => { for (let i = 0; i < 9; i++) moleDown(i, true); };
    show('mole');
    for (let i = 0; i < 9; i++) moleDown(i, true);
    $('wCorrect').textContent = '0';
    newMoleQ();
    g.nextSpawn = performance.now() + 300;
    g.tick = setInterval(() => moleTick(g), 80);
    tickTimer('w', g);
  }
  function newMoleQ() {
    const g = game, k = nextProblem(), [a, b] = pa(k);
    g.k = k; g.ans = a * b; g.slip = false; g.sinceCorrect = 0;
    g.vals = choices(a, b, 5);
    setProblem('w', a, b);
    $('wChant').textContent = NBSP;
    g.locked = false;
  }
  function moleTick(g) {
    if (game !== g || !g.running) return;
    tickTimer('w', g);
    if (game !== g) return;
    const now = performance.now();
    g.holes.forEach((h, i) => { if (h.up && now > h.t) moleDown(i); });
    if (!g.locked && now >= g.nextSpawn) {
      spawnMole(g);
      g.nextSpawn = now + Math.max(420, 850 - g.correct * 18);
    }
  }
  function spawnMole(g) {
    const free = [];
    g.holes.forEach((h, i) => { if (!h.up) free.push(i); });
    const upVals = g.holes.filter(h => h.up).map(h => h.v);
    if (!free.length || upVals.length >= 4) return;
    let v;
    if (!upVals.includes(g.ans) && (g.sinceCorrect >= 2 || Math.random() < 0.38)) { v = g.ans; g.sinceCorrect = 0; }
    else {
      const opts = g.vals.filter(x => x !== g.ans && !upVals.includes(x));
      if (!opts.length) return;
      v = opts[rand(opts.length)];
      g.sinceCorrect++;
    }
    const i = free[rand(free.length)], h = g.holes[i], el = $('hole-' + i), m = $('mole-' + i);
    h.up = true; h.v = v; h.hit = false;
    h.t = performance.now() + Math.max(1150, 2100 - g.correct * 40);
    el.classList.remove('whacked', 'missed');
    el.querySelector('.mole-num').textContent = v;
    m.setAttribute('aria-label', '답 ' + v);
    m.disabled = false;
    el.classList.add('up');
  }
  function whack(i) {
    const g = game;
    if (!g || g.mode !== 'mole' || !g.running || g.locked) return;
    const h = g.holes[i];
    if (!h.up || h.hit) return;
    h.hit = true;
    const el = $('hole-' + i);
    if (h.v === g.ans) {
      g.locked = true; g.rounds++;
      el.classList.add('whacked');
      sfx.pop(); sfx.good();
      let pts;
      if (!g.slip) pts = record(g.k, true);
      else { pts = 3; addPoints(3); }
      floatOn(el, '+' + pts);
      const [a, b] = pa(g.k);
      revealAnswer('w', g.ans, true);
      $('wChant').textContent = chant(a, b);
      flash($('wBoard'), 'good');
      $('wCorrect').textContent = g.correct;
      later(() => { g.holes.forEach((x, j) => { if (x.up) moleDown(j); }); }, 380);
      later(() => { newMoleQ(); g.nextSpawn = performance.now() + 250; }, 700);
    } else {
      el.classList.add('missed');
      sfx.bad();
      flash($('wBoard'), 'bad');
      g.endAt -= 3000;
      floatOn($('wTimer'), '-3초', true);
      if (!g.slip) { g.slip = true; record(g.k, false); } else g.combo = 0;
      later(() => moleDown(i), 450);
    }
  }

  /* ================= 짝 맞추기 ================= */
  function startMemory(pool) {
    const g = newGame('memory', pool);
    g.board = 0; g.boards = 0; g.flips = 0; g.totalBoards = 3;
    show('memory');
    $('cFlips').textContent = '0';
    dealBoard();
  }
  function dealBoard() {
    const g = game;
    g.board++;
    $('cRound').textContent = g.board + '/' + g.totalBoards;
    $('cInfo').textContent = '문제 카드와 그 답 카드를 짝지어요.';
    g.open = []; g.matched = 0;
    const picks = [], prods = new Set(), excl = new Set();
    for (let guard = 0; picks.length < 6 && guard < 120; guard++) {
      const k = nextProblem(excl), [a, b] = pa(k);
      excl.add(k);
      if (prods.has(a * b)) continue;
      prods.add(a * b); picks.push(k);
    }
    if (picks.length < 6) {
      shuffle((g.auto ? ALL : g.pool).slice()).forEach(k => {
        const [a, b] = pa(k);
        if (picks.length < 6 && !prods.has(a * b)) { prods.add(a * b); picks.push(k); }
      });
    }
    g.cards = shuffle(picks.flatMap(k => [{ k, type: 'q' }, { k, type: 'a' }]));
    $('cards').innerHTML = g.cards.map((c, i) => {
      const [a, b] = pa(c.k), face = c.type === 'q' ? a + ' × ' + b : String(a * b);
      return '<button class="card" type="button" id="card-' + i + '" aria-label="뒤집힌 카드"><span class="card-inner">' +
        '<span class="card-face card-back" aria-hidden="true">×</span><span class="card-face card-front ' + c.type + '">' + face + '</span></span></button>';
    }).join('');
    g.cards.forEach((c, i) => $('card-' + i).addEventListener('click', () => flipCard(i)));
    g.locked = false;
  }
  function flipCard(i) {
    const g = game;
    if (!g || g.mode !== 'memory' || !g.running || g.locked) return;
    const c = g.cards[i];
    if (c.done || c.open) return;
    c.open = true;
    const el = $('card-' + i);
    el.classList.add('open');
    el.setAttribute('aria-label', el.querySelector('.card-front').textContent);
    sfx.tap();
    g.open.push(i);
    if (g.open.length < 2) return;
    g.flips++;
    $('cFlips').textContent = g.flips;
    const [i1, i2] = g.open, c1 = g.cards[i1], c2 = g.cards[i2];
    g.open = [];
    if (c1.k === c2.k && c1.type !== c2.type) {
      c1.done = c2.done = true;
      $('card-' + i1).classList.add('done'); $('card-' + i2).classList.add('done');
      g.rounds++; g.matched++;
      const pts = record(c1.k, true), [a, b] = pa(c1.k);
      floatOn($('card-' + i2), '+' + pts);
      $('cInfo').textContent = a + ' × ' + b + ' = ' + a * b + ' · ' + chant(a, b);
      sfx.good();
      if (g.matched === g.cards.length / 2) {
        g.boards++;
        g.locked = true;
        later(() => { addPoints(20); toast('한 판을 다 맞췄어요! +20P', 1600, 2); confetti(60); sfx.level(); }, 300);
        later(g.board >= g.totalBoards ? endGame : dealBoard, 1500);
      }
    } else {
      g.combo = 0;
      g.locked = true;
      later(() => {
        [i1, i2].forEach(j => { g.cards[j].open = false; const e = $('card-' + j); e.classList.remove('open'); e.setAttribute('aria-label', '뒤집힌 카드'); });
        g.locked = false;
      }, 900);
    }
  }

  /* ================= 구구단 표 ================= */
  function openTable() {
    stopGame();
    state.hideAnswers = false;
    renderTable();
    show('table');
  }
  function renderTable() {
    const dans = state.auto ? [2, 3, 4, 5, 6, 7, 8, 9] : Array.from(state.dans).sort((x, y) => x - y);
    const hide = state.hideAnswers;
    $('hideBtn').setAttribute('aria-pressed', String(hide));
    $('hideBtn').textContent = hide ? '답 보이기' : '답 가리기';
    $('tableTip').textContent = hide
      ? '빈칸을 누르면 답이 나와요. 먼저 소리 내어 말해 보고 눌러 봐요.'
      : '“이삼은 육, 이사 팔”처럼 소리 내어 읽으며 외워요. 다 외웠으면 ‘답 가리기’를 눌러 확인해요.';
    const grid = $('danGrid');
    grid.classList.toggle('hide-answers', hide);
    grid.innerHTML = dans.map(d => {
      let rows = '';
      for (let b = 1; b <= 9; b++) {
        const p = d * b;
        const ans = hide
          ? '<button type="button" class="ans" aria-label="' + d + ' 곱하기 ' + b + '의 답 보기">' + p + '</button>'
          : '<span class="ans">' + p + '</span>';
        rows += '<li><span class="eq">' + d + ' × ' + b + ' = ' + ans + '</span><span class="ch">' + chant(d, b) + '</span></li>';
      }
      return '<section class="dan-card b-' + danColor(d) + '"><h3>' + d + '단</h3><ol>' + rows + '</ol></section>';
    }).join('');
  }

  /* ================= 결과 ================= */
  function showResult(g) {
    const rate = g.rounds ? Math.round(g.correct / g.rounds * 100) : 0;
    const stats = {
      balloon: [[g.correct, '한 번에 맞힘'], [g.maxCombo, '최고 연속'], [rate + '%', '정답률']],
      speed: [[g.correct, '맞힌 문제'], [g.rounds, '푼 문제'], [rate + '%', '정답률']],
      monster: [[g.kills || 0, '물리친 몬스터'], [g.correct, '맞힌 문제'], [rate + '%', '정답률']],
      mole: [[g.correct, '한 번에 잡음'], [g.maxCombo, '최고 연속'], [rate + '%', '정답률']],
      memory: [[g.boards || 0, '다 맞춘 판'], [g.correct, '맞춘 짝'], [g.flips || 0, '뒤집은 횟수']]
    }[g.mode];
    stats.forEach(([v, l], i) => { $('rS' + (i + 1)).textContent = v; $('rL' + (i + 1)).textContent = l; });
    $('rKicker').textContent = GAME_NAMES[g.mode] + ' 결과';

    let title;
    if (g.mode === 'memory') title = g.boards >= 3 ? '세 판을 다 맞췄어요!' : g.correct ? '잘했어요! 다음엔 세 판 끝까지!' : '다음에는 끝까지 해 봐요!';
    else if (!g.rounds) title = '다음에는 끝까지 해 봐요!';
    else if (rate >= 90 && g.correct >= 10) title = '구구단 박사예요!';
    else if (rate >= 70) title = '아주 잘했어요!';
    else if (rate >= 40) title = '점점 좋아지고 있어요!';
    else title = '천천히 다시 해 봐요!';
    $('rTitle').textContent = title;

    $('rEarned').textContent = fmt(g.earned);
    $('rTotal').textContent = acct.mode === 'guest' ? '손님 포인트 ' + fmt(acct.data.points) + 'P' : '모두 ' + fmt(acct.data.points) + 'P';
    const n = stampCount();
    $('rStamps').textContent = (g.newStamps ? '새 도장 ' + g.newStamps + '개! ' : '') + '도장판 ' + n + ' / 72';

    const now = rankOf(acct.data.points);
    $('rRankUp').hidden = now <= g.startRank;
    $('rRankUp').textContent = '새 칭호: ' + RANKS[now][1];

    const prev = acct.data.best[g.mode] || 0, rec = $('rRecord');
    if (g.earned > prev) {
      acct.data.best[g.mode] = g.earned;
      acct.pend.best[g.mode] = g.earned;
      rec.textContent = '새 기록이에요! (전에는 ' + fmt(prev) + 'P)';
      rec.className = 'record new';
    } else {
      rec.textContent = '내 최고 기록은 ' + fmt(prev) + 'P';
      rec.className = 'record';
    }

    const wrong = g.wrong.slice().sort((x, y) => x - y);
    $('rList').innerHTML = wrong.length
      ? wrong.map(k => { const [a, b] = pa(k); return '<li><span class="rv-eq">' + a + ' × ' + b + ' = ' + a * b + '</span><span class="rv-ch">' + chant(a, b) + '</span></li>'; }).join('')
      : '<li class="empty">' + (g.rounds ? '틀린 문제가 없어요. 정말 잘했어요!' : '아직 푼 문제가 없어요.') + '</li>';
    $('rWrong').hidden = wrong.length === 0;
    lastGame.wrong = wrong;

    show('result');
    if (now > g.startRank) confetti(100);
    setSaveState(acct.mode === 'guest' ? 'idle' : 'saving');
    flush();
  }

  /* ================= 시작 ================= */
  function startMode(m, pool) {
    if (!acct) { show('login'); return; }
    if (m === 'table') { openTable(); return; }
    ({ balloon: startBalloon, speed: startSpeed, monster: startMonster, mole: startMole, memory: startMemory })[m](pool);
  }

  function init() {
    state.auto = store.get('auto', true) !== false;
    const sd = store.get('dans', null);
    if (Array.isArray(sd)) state.dans = new Set(sd.filter(d => d >= 2 && d <= 9));
    state.sound = store.get('sound', true) !== false;

    $('storeNote').textContent = SHEET
      ? '포인트와 도장은 선생님의 구글 시트에 저장돼요. 어느 기기에서 들어와도 이어서 할 수 있어요.'
      : '포인트와 도장은 이 기기(브라우저)에 저장돼요. 다른 기기에서는 이어지지 않아요.';
    buildChips(); buildPads(); buildField();
    $('artMonster').innerHTML = monsterSVG(MONSTERS[0]);
    syncSound();

    $('brandBtn').addEventListener('click', () => { if (acct) goHome(); else show('login'); });
    $('soundBtn').addEventListener('click', () => { state.sound = !state.sound; store.set('sound', state.sound); syncSound(); sfx.tap(); });

    $('loginForm').addEventListener('submit', e => { e.preventDefault(); tryLogin(false); });
    $('createBtn').addEventListener('click', () => tryLogin(true));
    $('cancelCreate').addEventListener('click', () => { resetConfirm(); loginMsg(''); $('loginName').focus(); });
    ['loginName', 'loginPin'].forEach(id => $(id).addEventListener('input', () => { if (!$('confirmNew').hidden) { resetConfirm(); loginMsg(''); } }));
    $('guestBtn').addEventListener('click', () => beginSession('guest', '손님', '', null, false));
    $('logoutBtn').addEventListener('click', () => {
      if (acct && acct.mode === 'guest') { acct = null; $('meChip').hidden = true; show('login'); }
      else logout();
    });

    $('srcAuto').addEventListener('click', () => { state.auto = true; renderSource(); sfx.tap(); });
    $('srcPick').addEventListener('click', () => { state.auto = false; renderSource(); sfx.tap(); });
    $('allBtn').addEventListener('click', () => { state.dans = state.dans.size === 8 ? new Set() : new Set([2, 3, 4, 5, 6, 7, 8, 9]); syncChips(); });
    $$('.mode').forEach(btn => btn.addEventListener('click', () => startMode(btn.dataset.mode)));
    $$('.js-quit').forEach(btn => btn.addEventListener('click', endGame));
    $('rankRefresh').addEventListener('click', loadRanking);

    $('hideBtn').addEventListener('click', () => { state.hideAnswers = !state.hideAnswers; renderTable(); });
    $('tBack').addEventListener('click', goHome);
    $('danGrid').addEventListener('click', e => {
      const btn = e.target.closest('button.ans');
      if (!btn || btn.classList.contains('shown')) return;
      btn.classList.add('shown');
      btn.closest('li').classList.add('open');
      btn.setAttribute('aria-label', btn.textContent);
      sfx.tap();
    });

    $('rRetry').addEventListener('click', () => { if (lastGame) startMode(lastGame.mode, lastGame.pool); else goHome(); });
    $('rWrong').addEventListener('click', () => { if (lastGame && lastGame.wrong && lastGame.wrong.length) startMode(lastGame.mode, lastGame.wrong); });
    $('rHome').addEventListener('click', goHome);
    $('rSaveRetry').addEventListener('click', () => flush());

    document.addEventListener('keydown', e => {
      if (!game || !game.typing || e.ctrlKey || e.metaKey || e.altKey) return;
      let k = null;
      if (/^[0-9]$/.test(e.key)) k = e.key;
      else if (e.key === 'Backspace') k = 'del';
      else if (e.key === 'Enter') { e.preventDefault(); return; }
      if (!k) return;
      e.preventDefault();
      padPress(k);
      const btn = $(game && game.prefix ? game.prefix + 'Pad-' + k : '');
      if (btn) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 120); }
    });
    window.addEventListener('resize', () => {
      if (!game || game.mode !== 'balloon') return;
      const W = $('stage').clientWidth;
      game.balloons.forEach(bl => laneX(bl, W));
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });

    restoreSession();
  }

  init();
})();
