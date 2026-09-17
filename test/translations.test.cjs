const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { applyTranslationOverrides } = require('../scripts/translation-overrides.cjs');
const root = path.join(__dirname, '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const dict = read('data/dictionary.json'), patch = read('data/i18n-patch.json');
applyTranslationOverrides(patch, dict);
const source = fs.readFileSync(path.join(root, 'src/maplescouter-en-fix.user.js'), 'utf8');
const ctx = vm.createContext({ data: () => ({ dict, rules: read('data/rules.json') }), HANGUL: /[가-힣]/ });
vm.runInContext(source.slice(source.indexOf('  var KO_NUM_UNITS'), source.indexOf('  function translateTitle(')), ctx);
const reviewed = read('data/overrides/2026-09-17.json');

test('reviewed UI strings work in both i18next and exact DOM text, including whitespace', () => {
  for (const [ko, en] of Object.entries(reviewed)) {
    assert.equal(patch[ko], en, ko);
    assert.equal(ctx.translateString(ko), en, ko);
    assert.deepEqual(en.match(/{{[^}]+}}/g), ko.match(/{{[^}]+}}/g), ko);
  }
});

test('all 184 probability tables preserve every number, row and odds column', () => {
  const tables = Object.entries(reviewed).filter(([ko]) => ko.startsWith('\n') && /\s{2,}[\d.]+%/.test(ko));
  assert.equal(tables.length, 184);
  for (const [ko, en] of tables) {
    assert.doesNotMatch(en, /[가-힣]/);
    assert.deepEqual(en.match(/\d+(?:\.\d+)?/g), ko.match(/\d+(?:\.\d+)?/g));
    assert.equal(en.split('\n').length, ko.split('\n').length);
    assert.deepEqual(en.match(/\s{2,}\d+(?:\.\d+)?%\s*$/gm), ko.match(/\s{2,}\d+(?:\.\d+)?%\s*$/gm));
  }
});

test('potential skill names use GMS terminology', () => {
  const table = Object.values(reviewed).find(s => s.includes('Decent Speed Infusion'));
  assert.ok(table);
  assert.doesNotMatch(table, /Wind Booster/);
});

test('HEXA icon labels translate complete skill groups before splitting Korean runs', () => {
  assert.equal(ctx.translateString('hexa-이슈타르의 링 VI'), 'HEXA: Ishtar’s Ring VI');
  assert.equal(ctx.translateString('hexa-유니콘 스파이크 VI/거스트 다이브 VI/스트라이크 듀얼샷 VI'), 'HEXA: Unicorn Spike VI/Gust Dive VI/Stunning Strikes VI');
});

test('class analysis metadata translates around the server date and sample count', () => {
  const out = ctx.translateString('기준일 2026-09-13 · 샘플 8,795캐릭터 (환산주스탯 구간별)');
  assert.doesNotMatch(out, /[가-힣]/);
  assert.match(out, /2026-09-13/);
  assert.match(out, /8,795 characters by Equivalent Stat range/);
});

test('reviewed English is not changed a second time by legacy English substitutions', () => {
  for (const en of Object.values(reviewed)) {
    if (/[가-힣]/.test(en)) continue; // Required literal submission tag stays Korean.
    const again = ctx.translateString(en);
    assert.ok(again === null || again === en, `${en} -> ${again}`);
  }
});

for (const [ko, en] of [
  ['2086억 6801만 6589', '208,668,016,589'],
  ['1.5억', '150,000,000'], ['8천만', '80,000,000'],
  ['1.5천만', '15,000,000'], ['2경 3조', '20,003,000,000,000,000'],
  ['0억', '0'],
]) test(`Korean numeric display: ${ko}`, () => assert.equal(ctx.koreanNumberToEnglish(ko), en));

test('numeric translation leaves malformed strings and non-numeric names alone', () => {
  for (const text of ['억', '천만', '1..5억', '1억garbage', '23천억', '억1만', '1억2만3조oops', 'HTomer']) {
    assert.equal(ctx.koreanNumberToEnglish(text), null, text);
  }
});

test('dynamic equipment levels and stat tooltips retain their meaning', () => {
  assert.equal(ctx.translateString('250제 모자'), 'Lv. 250 Hat');
  assert.equal(ctx.translateString('운 32 증가'), 'LUK +32');
  assert.equal(ctx.translateString('힘 100 증가'), 'STR +100');
});

function localeHarness(current, saved, referrer = '') {
  let redirected, value = saved;
  const ctx = vm.createContext({
    URL, LOCALES: ['ko', 'en', 'ja', 'ch'], LS_LOCALE: 'locale',
    location: { pathname: current, origin: 'https://maplescouter.com', search: '?manual=true', hash: '#boss', replace: url => { redirected = url; } },
    document: { referrer },
    localStorage: { getItem: () => value, setItem: (_key, v) => { value = v; } },
  });
  vm.runInContext(source.slice(source.indexOf('  function pathLocale('), source.indexOf('  /* ---------------- 2. Region')), ctx);
  return { ctx, value: () => value, redirected: () => redirected };
}

test('detailed results retain English when a native route defaults to Korean', () => {
  const h = localeHarness('/ko/result', 'en', 'https://maplescouter.com/en/input');
  assert.equal(h.ctx.restoreLocale(), true);
  assert.equal(h.redirected(), '/en/result?manual=true#boss');
  assert.equal(h.value(), 'en');
  assert.equal(h.ctx.navigationLocale('/en/input', '/ko/result', 'en'), 'en');
});

test('deliberate language changes on the same page still work in both directions', () => {
  for (const [from, to] of [['en','ko'], ['ko','en'], ['ja','en']]) {
    const h = localeHarness(`/${to}/input`, from, `https://maplescouter.com/${from}/input`);
    const item = { textContent: {en:'English',ko:'Korean',ja:'Japanese'}[to], closest: () => ({}) };
    h.ctx.rememberLanguageChoice({ target: { closest: () => item } });
    assert.equal(h.ctx.restoreLocale(), false);
    assert.equal(h.value(), to);
    assert.equal(h.ctx.navigationLocale(`/${from}/input`, `/${to}/input`, h.value()), to);
  }
});

test('fresh entry and lookalike origins cannot overwrite the remembered language', () => {
  for (const ref of ['', 'https://maplescouter.com/en/result', 'https://maplescouter.com.evil.example/en/result']) {
    const h = localeHarness('/ko/result', 'en', ref);
    assert.equal(h.ctx.restoreLocale(), true);
    assert.equal(h.value(), 'en');
  }
});

test('first visit records the visible locale and ordinary navigation keeps it', () => {
  const h = localeHarness('/en/input', null);
  assert.equal(h.ctx.restoreLocale(), false);
  assert.equal(h.value(), 'en');
  assert.equal(h.ctx.navigationLocale('/en/input', '/en/base', 'en'), 'en');
});
