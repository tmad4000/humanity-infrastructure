// Concept page arithmetic. Every figure here is an illustration; the usage formula is the draft from the
// usage-meter design and is not agreed.
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var el = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  var money = function (n) { return '$' + n.toFixed(2); };
  var whole = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
  var FEE = 10 * 0.029 + 0.30, NET = 10 - FEE;            // what reaches projects from one $10 charge

  // ---- one example patron, worked with the draft formula: weight = U x V ------------
  // U = (days / 30) x (1 + log2(1 + hours per day used));  V = 2^(rating - 3)
  var PATRON = [
    { name: 'LocalVocal', days: 20, hours: 1, rating: 5, c: 'c1' },
    { name: 'A code editor (stand-in)', days: 22, hours: 6, rating: 3, c: 'c2' },
    { name: 'A notes app (stand-in)', days: 30, hours: 0.5, rating: 4, c: 'c3' },
    { name: 'A browser extension (stand-in)', days: 30, hours: 0.1, rating: 3, c: 'c4' },
    { name: 'A command-line tool (stand-in)', days: 8, hours: 0.2, rating: 3, c: 'c5' }
  ];
  var total = 0;
  PATRON.forEach(function (p) { p.w = (p.days / 30) * (1 + Math.log(1 + p.hours) / Math.LN2) * Math.pow(2, p.rating - 3); total += p.w; });
  var bar = $('#c-bar'), body = $('#c-split'), RATING = { 3: 'as measured', 4: 'more', 5: 'much more' };
  PATRON.forEach(function (p) {
    var share = p.w / total, seg = el('span', p.c); seg.style.flexGrow = String(share); seg.title = p.name + ': ' + Math.round(share * 100) + '%'; bar.appendChild(seg);
    var tr = el('tr'), th = el('th'); th.scope = 'row';
    var sw = el('span', 'sw ' + p.c); sw.setAttribute('aria-hidden', 'true'); th.appendChild(sw); th.appendChild(document.createTextNode(' ' + p.name)); tr.appendChild(th);
    [String(p.days), String(p.hours), RATING[p.rating], Math.round(share * 100) + '%', money(NET * share)].forEach(function (v) { tr.appendChild(el('td', 'num', v)); });
    if (p.name === 'LocalVocal') tr.className = 'total';
    body.appendChild(tr);
  });
  var foot = el('tr'), fh = el('th', null, 'Card fee'); fh.scope = 'row'; foot.appendChild(fh);
  ['', '', '', '', money(FEE)].forEach(function (v) { foot.appendChild(el('td', 'num', v)); }); body.appendChild(foot);

  // ---- maker scenarios -----------------------------------------------------------
  var NS = [100, 500, 2000, 10000], SS = [0.03, 0.1, 0.2, 0.35];
  var income = function (n, s) { return n * NET * s; };
  var grid = $('#c-grid');
  NS.forEach(function (n) {
    var tr = el('tr'), th = el('th', null, n.toLocaleString('en-US')); th.scope = 'row'; tr.appendChild(th);
    SS.forEach(function (s) { var td = el('td', 'num', whole(income(n, s))); td.setAttribute('data-n', n); td.setAttribute('data-s', s); tr.appendChild(td); });
    grid.appendChild(tr);
  });
  function pick(name) { var c = document.querySelector('input[name="' + name + '"]:checked'); return c ? parseFloat(c.value) : 0; }
  function render() {
    var n = pick('c-n'), s = pick('c-s'), m = income(n, s), each = NET * s * 12;
    $('#c-month').textContent = whole(m); $('#c-year').textContent = whole(m * 12); $('#c-each').textContent = money(each);
    // Comparison uses the one-time prices published on localvocal.ai on 25 Nov 2026.
    var months = function (price) { return Math.ceil(price / (NET * s)); };
    $('#c-compare').textContent = 'For comparison with today\'s published one-time prices: at this share one such patron passes $9.99 in ' + months(9.99) +
      (months(9.99) === 1 ? ' month' : ' months') + ', $29.98 in ' + months(29.98) + ' months and $49.97 in ' + months(49.97) + ' months, and keeps paying for as long as they keep using it.';
    Array.prototype.forEach.call(grid.querySelectorAll('td'), function (td) { td.classList.toggle('on', +td.getAttribute('data-n') === n && +td.getAttribute('data-s') === s); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="c-n"], input[name="c-s"]'), function (r) { r.addEventListener('change', render); });
  render();

  // ---- the real voice count for LocalVocal from the live patron page ----------------
  var out = $('#c-voices');
  fetch('/api/patron-voices').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    var c = d && d.counts && Object.prototype.hasOwnProperty.call(d.counts, 'localvocal') ? d.counts.localvocal : null;
    var n = c && typeof c.total === 'number' ? c.total : 0;
    out.textContent = n === 0 ? 'No voices yet.' : n + (n === 1 ? ' voice' : ' voices') + ' so far.';
  }).catch(function () { out.textContent = 'The live count could not be read just now.'; });
})();
