/**
 * 구구단 놀이터 - 포인트 저장용 Google Apps Script
 *
 * 구글 시트의 [확장 프로그램] → [Apps Script]에 이 코드를 통째로 붙여 넣고
 * 웹 앱으로 배포하면, 학생들의 포인트와 도장이 이 시트의 '학생' 탭에 쌓여요.
 * 자세한 순서는 저장소 README의 "구글 시트에 포인트 저장하기"를 보세요.
 *
 * 선생님이 할 수 있는 일
 * - 학생이 암호를 잊었을 때: 그 학생 줄의 '암호 해시' 칸을 지우면, 다음에 넣는 암호가 새 암호가 돼요.
 * - 포인트 고치기: '포인트' 칸 숫자를 바꾸면 돼요.
 * - 학생 지우기: 그 줄을 삭제하면 돼요.
 */

// 새 이름을 만들 때 필요한 반 코드예요. 비워 두면 누구나 새 이름을 만들 수 있어요.
// 예: var JOIN_CODE = '3반2026';
var JOIN_CODE = '';

var SHEET_NAME = '학생';
var HEAD = ['이름', '포인트', '도장 수', '맞힘', '틀림', '마지막 접속', '처음 접속', '도장', '다시 볼 문제', '최고 기록', '솔트', '암호 해시'];
var COL = { name: 1, points: 2, stamps: 3, correct: 4, wrong: 5, last: 6, first: 7, solved: 8, weak: 9, best: 10, salt: 11, hash: 12 };

function doGet() {
  return out({ ok: true, app: 'gugudan' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({ ok: false, error: 'bad_request' });
  }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return out({ ok: false, error: 'busy' });
  }
  try {
    if (req.action === 'login') return out(login(req));
    if (req.action === 'save') return out(save(req));
    if (req.action === 'rank') return out(rank());
    return out({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return out({ ok: false, error: 'server', detail: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('H:L').setNumberFormat('@');
  }
  return sh;
}

function cleanName(s) {
  return String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}
function validName(n) {
  return n.length >= 1 && n.length <= 12 && /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]+$/.test(n);
}
function validPin(p) {
  return /^\d{4,8}$/.test(p);
}
function nameKey(n) {
  return cleanName(n).toLowerCase();
}

function findRow(sh, name) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var names = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  var key = nameKey(name);
  for (var i = 0; i < names.length; i++) {
    if (names[i][0] && nameKey(names[i][0]) === key) return i + 2;
  }
  return -1;
}

function hashPin(salt, pin) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function fixMarks(s, mark) {
  s = String(s || '');
  var r = '';
  for (var i = 0; i < 72; i++) r += s.charAt(i) === mark ? mark : '.';
  return r;
}

function rowData(v) {
  var best = {};
  try { best = JSON.parse(String(v[COL.best - 1] || '{}')) || {}; } catch (err) { best = {}; }
  return {
    name: String(v[COL.name - 1]),
    points: Number(v[COL.points - 1]) || 0,
    solved: fixMarks(v[COL.solved - 1], 'o'),
    weak: fixMarks(v[COL.weak - 1], 'x'),
    best: best,
    correct: Number(v[COL.correct - 1]) || 0,
    wrong: Number(v[COL.wrong - 1]) || 0
  };
}

// 암호를 확인해요. 선생님이 '암호 해시' 칸을 비워 두었다면 이번에 넣은 암호를 새 암호로 정해요.
function checkPin(sh, row, v, pin) {
  var salt = String(v[COL.salt - 1] || '');
  var hash = String(v[COL.hash - 1] || '');
  if (!hash) {
    salt = salt || Utilities.getUuid();
    sh.getRange(row, COL.salt, 1, 2).setValues([[salt, hashPin(salt, pin)]]);
    return true;
  }
  return hashPin(salt, pin) === hash;
}

function login(req) {
  var name = cleanName(req.name), pin = String(req.pin || '');
  if (!validName(name)) return { ok: false, error: 'bad_name' };
  if (!validPin(pin)) return { ok: false, error: 'bad_pin' };
  var sh = getSheet(), row = findRow(sh, name);
  if (row < 0) {
    if (!req.create) return { ok: false, error: 'not_found' };
    if (JOIN_CODE && String(req.code || '').trim() !== JOIN_CODE) {
      return { ok: false, error: req.code ? 'wrong_code' : 'need_code' };
    }
    var salt = Utilities.getUuid(), now = new Date();
    var r = [name, 0, 0, 0, 0, now, now, fixMarks('', 'o'), fixMarks('', 'x'), '{}', salt, hashPin(salt, pin)];
    sh.appendRow(r);
    return { ok: true, created: true, data: rowData(r) };
  }
  var v = sh.getRange(row, 1, 1, HEAD.length).getValues()[0];
  if (!checkPin(sh, row, v, pin)) return { ok: false, error: 'wrong_pin' };
  sh.getRange(row, COL.last).setValue(new Date());
  return { ok: true, data: rowData(v) };
}

function toIds(list) {
  return (Array.isArray(list) ? list : []).map(Number).filter(function (k) {
    return k >= 0 && k < 72 && Math.floor(k) === k;
  });
}
function clampInt(x, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.floor(Number(x) || 0)));
}

function save(req) {
  var name = cleanName(req.name), pin = String(req.pin || '');
  var sh = getSheet(), row = findRow(sh, name);
  if (row < 0) return { ok: false, error: 'not_found' };
  var v = sh.getRange(row, 1, 1, HEAD.length).getValues()[0];
  if (!checkPin(sh, row, v, pin)) return { ok: false, error: 'wrong_pin' };

  var d = rowData(v);
  d.points += clampInt(req.points, 0, 5000);
  d.correct += clampInt(req.correct, 0, 2000);
  d.wrong += clampInt(req.wrong, 0, 2000);

  var solved = d.solved.split(''), weak = d.weak.split('');
  toIds(req.solvedAdd).forEach(function (k) { solved[k] = 'o'; });
  toIds(req.weakAdd).forEach(function (k) { weak[k] = 'x'; });
  toIds(req.weakDel).forEach(function (k) { weak[k] = '.'; });
  d.solved = solved.join('');
  d.weak = weak.join('');

  var best = req.best && typeof req.best === 'object' ? req.best : {};
  Object.keys(best).forEach(function (m) {
    if (!/^[a-z]{1,12}$/.test(m)) return;
    var n = clampInt(best[m], 0, 100000);
    if (n > (Number(d.best[m]) || 0)) d.best[m] = n;
  });

  var stamps = d.solved.split('o').length - 1;
  sh.getRange(row, COL.points, 1, 9).setValues([[
    d.points, stamps, d.correct, d.wrong, new Date(), v[COL.first - 1] || new Date(), d.solved, d.weak, JSON.stringify(d.best)
  ]]);
  return { ok: true, data: d };
}

function rank() {
  var sh = getSheet(), last = sh.getLastRow();
  if (last < 2) return { ok: true, list: [] };
  var rows = sh.getRange(2, 1, last - 1, 3).getValues();
  var list = rows.filter(function (r) { return r[0]; }).map(function (r) {
    return { name: String(r[0]), points: Number(r[1]) || 0, stamps: Number(r[2]) || 0 };
  });
  list.sort(function (a, b) { return b.points - a.points; });
  return { ok: true, list: list.slice(0, 10) };
}
