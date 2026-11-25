(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // PAYMENT PLACEHOLDERS. Nothing here is live. When Jacob creates the Stripe
  // Payment Links (or Checkout prices) and the Patreon page, paste the URLs here.
  // While a tier's link is null, its button opens the interest form instead.
  // ---------------------------------------------------------------------------
  var PAYMENTS = {
    stripe: { seed: null, supporter: null, patron: null, custom: null }, // e.g. 'https://buy.stripe.com/…'
    patreon: null,                                                      // e.g. 'https://www.patreon.com/…'
    interestEndpoint: '/api/patron-interest'
  };
  var TIERS = { seed: { usd: 1, name: 'Seed' }, supporter: { usd: 3, name: 'Supporter' }, patron: { usd: 10, name: 'Patron' }, custom: { usd: null, name: 'your amount' } };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var el = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  var money = function (n) { return '$' + n.toFixed(2); };

  // ---- theme ----------------------------------------------------------------
  var themeBtn = $('#theme-btn');
  if (themeBtn && window.hiTheme) {
    var order = ['auto', 'light', 'dark'];
    var label = function () { themeBtn.textContent = 'Theme: ' + window.hiTheme.get(); };
    themeBtn.addEventListener('click', function () {
      window.hiTheme.set(order[(order.indexOf(window.hiTheme.get()) + 1) % 3]); label();
    });
    label();
  }

  // ---- interest dialog ------------------------------------------------------
  var dlg = $('#join'), form = $('#join-form'), done = $('#join-done'), err = $('#join-err');
  var amountField = $('#amount-field'), emailInput = $('#join-email'), amountInput = $('#join-amount');
  var opener = null, pending = null, rowHooks = [], readyHooks = [], idFilter = null;

  function currentTier() { var c = $('input[name="tier"]:checked', form); return c ? c.value : 'patron'; }
  function syncAmount() { amountField.hidden = currentTier() !== 'custom'; }
  function openJoin(tier, from, extra) {
    if (!extra && PAYMENTS.stripe[tier]) { window.location.href = PAYMENTS.stripe[tier]; return; }
    opener = from || null; pending = extra || null;
    var note = $('#join-summary'); note.hidden = !pending; note.textContent = pending ? pending.summary : '';
    amountInput.readOnly = !!pending; if (pending) amountInput.value = pending.amount;
    $('.tier-pick', form).hidden = !!pending;
    form.hidden = false; done.hidden = true; err.textContent = '';
    emailInput.removeAttribute('aria-invalid');
    var r = $('input[name="tier"][value="' + tier + '"]', form); if (r) r.checked = true;
    syncAmount();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    emailInput.focus();
  }
  function closeJoin() { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); if (opener) opener.focus(); }

  $$('[data-join]').forEach(function (b) { b.addEventListener('click', function () { openJoin(b.getAttribute('data-join'), b); }); });
  $$('input[name="tier"]', form).forEach(function (r) { r.addEventListener('change', syncAmount); });
  ['#join-close', '#done-close', '#done-ok'].forEach(function (s) { $(s).addEventListener('click', closeJoin); });
  dlg.addEventListener('click', function (e) {
    if (e.target !== dlg) return;
    var r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeJoin();
  });
  $('#dlg-privacy').addEventListener('click', function () { var d = $('#privacy'); if (d) d.open = true; closeJoin(); });
  // Deep link: /#join or /#join-seed opens the form, so other pages can link straight to it.
  var deep = /^#join(?:-(seed|supporter|patron|custom))?$/.exec(location.hash);
  if (deep) openJoin(deep[1] || 'patron', null);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.textContent = '';
    var tier = currentTier(), email = emailInput.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/.test(email)) {
      emailInput.setAttribute('aria-invalid', 'true'); err.textContent = 'Enter a valid email address.'; emailInput.focus(); return;
    }
    emailInput.removeAttribute('aria-invalid');
    var body = { email: email, tier: tier, notify: form.elements.notify.checked, website: form.elements.website.value, source_page: location.pathname };
    if (pending && tier === 'custom') { body.allocations = pending.allocations; body.amount = pending.amount; }
    else if (tier === 'custom') {
      var a = parseFloat(amountInput.value);
      if (!(a >= 1 && a <= 1000)) { err.textContent = 'Enter an amount between $1 and $1,000.'; amountInput.focus(); return; }
      body.amount = a;
    }
    var btn = $('#join-submit'); btn.disabled = true; btn.textContent = 'Saving…';
    fetch(PAYMENTS.interestEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok && j.ok, code: j.error, status: r.status }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.status === 429 ? 'slow_down' : 'failed');
        var amt = tier === 'custom' ? body.amount : TIERS[tier].usd;
        $('#done-text').textContent = 'We saved ' + email + ' at $' + (amt % 1 ? amt.toFixed(2) : amt) + ' a month. Nothing was charged and no email was sent.' +
          (body.notify ? ' We will write once when patronage opens.' : ' We will not email you.');
        form.hidden = true; done.hidden = false; form.reset(); pending = null; $('#done-ok').focus();
      })
      .catch(function (x) {
        err.textContent = x.message === 'slow_down' ? 'Too many tries. Please try again in an hour.' : 'That did not save. Please try again.';
      })
      .then(function () { btn.disabled = false; btn.textContent = 'Save my place'; });
  });

  // Hooks used by lab.js (fund-your-own split, lists, scan, nominate, sign-in).
  window.hiPatrons = {
    openJoin: openJoin,
    onRow: function (h) { rowHooks.push(h); },
    onReady: function (h) { readyHooks.push(h); },
    redraw: function () { if (entries.length) draw(); },
    filterIds: function (ids, label) { idFilter = { ids: ids, label: label }; $$('.chip').forEach(function (o) { o.setAttribute('aria-pressed', 'false'); }); draw(); },
    prefillEmail: function (email) { if (email && !emailInput.value) emailInput.value = email; }
  };

  // ---- allocation preview (illustrative numbers only) ------------------------
  var EXAMPLE = [
    { id: 'vision', name: 'Vision', usage: 40, c: 'c1' },
    { id: 'buzz', name: 'Buzz', usage: 20, c: 'c2' },
    { id: 'openchat', name: 'OpenChat', usage: 12, c: 'c3' },
    { id: 'wikihub', name: 'WikiHub', usage: 10, c: 'c4' },
    { id: 'noos', name: 'Noos', usage: 8, c: 'c5' },
    { id: 'lastbook', name: 'Lastbook', usage: 6, c: 'c6' },
    { id: 'other', name: 'All other projects', usage: 4, c: 'c7' }
  ];
  var weights = EXAMPLE.map(function (p) { return p.usage; });
  var bar = $('#split-bar'), rows = $('#split-rows'), summary = $('#split-summary');
  var segs = [], pctEls = [], usdEls = [], sliders = [];

  EXAMPLE.forEach(function (p, i) {
    var seg = el('span', p.c); bar.appendChild(seg); segs.push(seg);
    var li = el('li');
    li.appendChild(el('span', 'sw ' + p.c)).setAttribute('aria-hidden', 'true');
    var lab = el('label', null, p.name); lab.htmlFor = 'w-' + p.id;
    lab.appendChild(el('span', 'usage', 'Example usage ' + p.usage + '%'));
    li.appendChild(lab);
    var s = el('input'); s.type = 'range'; s.min = 0; s.max = 100; s.step = 1; s.value = p.usage; s.id = 'w-' + p.id;
    s.addEventListener('input', function () { weights[i] = +s.value; render(); });
    li.appendChild(s); sliders.push(s);
    pctEls.push(li.appendChild(el('span', 'pct')));
    usdEls.push(li.appendChild(el('span', 'usd')));
    var hl = function (on) { segs.forEach(function (g, j) { g.classList.toggle('dim', on && j !== i); }); };
    li.addEventListener('mouseenter', function () { hl(true); }); li.addEventListener('mouseleave', function () { hl(false); });
    seg.addEventListener('mouseenter', function () { hl(true); }); seg.addEventListener('mouseleave', function () { hl(false); });
    rows.appendChild(li);
  });

  function render() {
    var amt = +($('input[name="amt"]:checked') || { value: 10 }).value;
    var yearly = ($('input[name="bill"]:checked') || {}).value === 'year';
    var charge = yearly ? amt * 12 : amt;
    var feeMonth = (charge * 0.029 + 0.30) / (yearly ? 12 : 1);
    var pool = Math.max(amt - feeMonth, 0);
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var changed = false;
    EXAMPLE.forEach(function (p, i) {
      var share = total ? weights[i] / total : 1 / EXAMPLE.length;
      segs[i].style.flexGrow = String(Math.max(share, 0.0001));
      segs[i].title = p.name + ': ' + Math.round(share * 100) + '% · ' + money(pool * share);
      pctEls[i].textContent = Math.round(share * 100) + '%';
      usdEls[i].textContent = money(pool * share);
      sliders[i].setAttribute('aria-valuetext', p.name + ' ' + Math.round(share * 100) + ' percent, ' + money(pool * share) + ' a month');
      if (weights[i] !== p.usage) changed = true;
    });
    summary.textContent = 'Of ' + money(amt) + ' a month, about ' + money(feeMonth) + ' goes to card fees' +
      (yearly ? ' (one yearly charge)' : '') + ' and ' + money(pool) + ' reaches projects. ' +
      (changed ? 'You have changed the split from the usage default.' : 'This is the usage default.');
  }
  // The $1 level is billed yearly, so choosing it switches the billing control to match.
  $$('input[name="amt"]').forEach(function (r) { r.addEventListener('change', function () { if (r.value === '1') $('input[name="bill"][value="year"]').checked = true; }); });
  $$('input[name="amt"], input[name="bill"]').forEach(function (r) { r.addEventListener('change', render); });
  $('#split-reset').addEventListener('click', function () {
    EXAMPLE.forEach(function (p, i) { weights[i] = p.usage; sliders[i].value = p.usage; }); render();
  });
  render();

  // ---- catalog ----------------------------------------------------------------
  var LABEL = { open: 'Open', 'needs-license': 'Needs a license', 'source-available': 'Source-available', closed: 'Not public', content: 'Content', fork: 'Fork' };
  var RANK = ['open', 'needs-license', 'source-available', 'content', 'fork', 'closed'], FOLD = 5, expanded = {};
  var list = $('#cat-list'), count = $('#cat-count'), entries = [], filter = 'all', showAll = false, query = '';

  function match(e) {
    if (idFilter) return idFilter.ids.indexOf(e.id) >= 0;
    if (!showAll && e.tier !== 'featured') return false;
    if (filter === 'third' ? !e.thirdParty : (filter !== 'all' && e.status !== filter)) return false;
    if (query && (e.name + ' ' + e.line + ' ' + e.license + ' ' + e.maker).toLowerCase().indexOf(query) < 0) return false;
    return true;
  }
  function draw() {
    list.textContent = '';
    var shown = entries.filter(match), groups = [], by = {};
    shown.forEach(function (e) { if (!by[e.group]) { by[e.group] = []; groups.push(e.group); } by[e.group].push(e); });
    groups.forEach(function (g) {
      var sec = el('div', 'cat-group'); sec.appendChild(el('h3', null, g + ' · ' + by[g].length));
      var ul = el('ul', 'cat-items');
      var all = by[g].sort(function (x, y) { return RANK.indexOf(x.status) - RANK.indexOf(y.status); });
      var folded = !query && !idFilter && !expanded[g] && all.length > FOLD;
      (folded ? all.slice(0, FOLD) : all).forEach(function (e) {
        var li = el('li'), head = el('div');
        var a = el('a', 'cat-name', e.name); a.href = e.link; a.rel = 'noopener'; head.appendChild(a);
        if (e.thirdParty) head.appendChild(el('span', 'cat-maker', 'by ' + e.maker));
        else if (e.stage) head.appendChild(el('span', 'cat-maker', e.stage));
        li.appendChild(head);
        var meta = el('div', 'cat-meta');
        meta.appendChild(el('span', 'pill s-' + e.status, LABEL[e.status] || e.status));
        if (e.license !== 'Source not public' && e.license !== 'No license file') meta.appendChild(el('span', 'cat-lic', e.license));
        if (e.repo && e.repo !== e.link) { var s = el('a', 'cat-src', 'Source'); s.href = e.repo; s.rel = 'noopener'; s.setAttribute('aria-label', 'Source for ' + e.name); meta.appendChild(s); }
        li.appendChild(meta);
        li.appendChild(el('p', 'cat-line', e.line));
        if (e.note) li.appendChild(el('p', 'cat-note', e.note));
        rowHooks.forEach(function (h) { h(li, e); });
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      if (folded) {
        var more = el('button', 'btn ghost small cat-fold', 'Show all ' + all.length + ' in ' + g);
        more.type = 'button';
        more.addEventListener('click', function () { expanded[g] = true; draw(); });
        sec.appendChild(more);
      }
      list.appendChild(sec);
    });
    if (!shown.length) list.appendChild(el('p', 'fineprint', 'Nothing matches.'));
    count.textContent = idFilter ? 'Showing the list "' + idFilter.label + '": ' + shown.length + (shown.length === 1 ? ' project.' : ' projects.') + ' Choose a filter above to leave the list.'
      : shown.length + (shown.length === 1 ? ' project' : ' projects') + ' shown' + (showAll ? ', including every public repository.' : '.');
  }
  $$('.chip').forEach(function (c) {
    c.addEventListener('click', function () {
      filter = c.getAttribute('data-filter'); idFilter = null;
      $$('.chip').forEach(function (o) { o.setAttribute('aria-pressed', String(o === c)); });
      draw();
    });
  });
  $('#cat-search').addEventListener('input', function (e) { query = e.target.value.trim().toLowerCase(); draw(); });
  $('#cat-all').addEventListener('click', function (e) {
    showAll = !showAll; e.target.setAttribute('aria-pressed', String(showAll));
    e.target.textContent = showAll ? 'Show featured projects only' : 'Show every public repository'; draw();
  });
  fetch('/patrons/catalog.json').then(function (r) { return r.json(); }).then(function (d) {
    entries = d.entries;
    $('#stat-featured').textContent = d.summary.counts.featured;
    $('#stat-open').textContent = d.summary.counts.open;
    $('#stat-repos').textContent = d.summary.counts.publicRepos;
    draw();
    readyHooks.forEach(function (h) { h(d); });
  }).catch(function () { /* the fallback link to catalog.json stays visible */ });
})();
