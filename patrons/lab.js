// Fund-your-own split, lists, stack scan, nominations and optional sign-in.
// Everything here runs in the browser. The only requests are the ones a button says it will send.
(function () {
  'use strict';
  var core = window.hiPatrons;
  if (!core) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var el = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  var money = function (n) { return '$' + n.toFixed(2); };
  var byId = {}, entries = [], lists = [];
  var store = {
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j.ok === true, status: r.status, error: j.error }; }); });
  }
  function say(node, text, bad) { node.textContent = text; node.classList.toggle('bad', !!bad); }

  // ---- my list (kept in this browser only) -------------------------------------
  var mine = store.get('hi-patron-list', { name: '', items: [] });
  if (!mine || !Array.isArray(mine.items)) mine = { name: '', items: [] };
  function saveMine() { store.set('hi-patron-list', mine); drawMine(); core.redraw(); }
  function inMine(id) { return mine.items.indexOf(id) >= 0; }
  function toggleMine(id) { var i = mine.items.indexOf(id); if (i >= 0) mine.items.splice(i, 1); else if (mine.items.length < 40) mine.items.push(id); saveMine(); }

  core.onRow(function (li, e) {
    if (e.tier !== 'featured') return;
    var b = el('button', 'row-add', inMine(e.id) ? 'In my list' : 'Add to my list');
    b.type = 'button'; b.setAttribute('aria-pressed', String(inMine(e.id)));
    b.setAttribute('aria-label', (inMine(e.id) ? 'Remove ' : 'Add ') + e.name + (inMine(e.id) ? ' from my list' : ' to my list'));
    b.addEventListener('click', function () { toggleMine(e.id); });
    $('.cat-meta', li).appendChild(b);
  });

  // ---- fund what you choose -----------------------------------------------------
  var picks = store.get('hi-patron-picks', {});            // {projectId: dollars}
  if (!picks || typeof picks !== 'object' || Array.isArray(picks)) picks = {};
  var pickRows = $('#pick-rows'), pickTotal = $('#pick-total'), pickNote = $('#pick-note'), pickSave = $('#pick-save');
  function addPick(id, dollars) { if (!byId[id] || Object.keys(picks).length >= 40 && !(id in picks)) return; if (!(id in picks)) picks[id] = dollars || 1; }
  function drawPicks() {
    Object.keys(picks).forEach(function (id) { if (!byId[id]) delete picks[id]; });
    store.set('hi-patron-picks', picks);
    pickRows.textContent = '';
    var ids = Object.keys(picks), total = 0, notOpen = 0;
    ids.forEach(function (id) {
      var e = byId[id], li = el('li');
      var name = el('label', 'pick-name', e.name); name.htmlFor = 'pick-' + id;
      if (e.status !== 'open') { name.appendChild(el('span', 'pick-flag', e.status === 'needs-license' ? 'needs a license' : 'not open yet')); notOpen++; }
      li.appendChild(name);
      var wrap = el('span', 'pick-amt'); wrap.appendChild(el('span', null, '$'));
      var input = el('input'); input.type = 'number'; input.id = 'pick-' + id; input.min = '0.5'; input.max = '1000'; input.step = '0.5'; input.value = picks[id]; input.inputMode = 'decimal';
      input.addEventListener('change', function () { var v = Math.round(parseFloat(input.value) * 2) / 2; picks[id] = v >= 0.5 && v <= 1000 ? v : 1; drawPicks(); });
      wrap.appendChild(input); wrap.appendChild(el('span', 'per', '/ month')); li.appendChild(wrap);
      var rm = el('button', 'pick-rm', 'Remove'); rm.type = 'button'; rm.setAttribute('aria-label', 'Remove ' + e.name);
      rm.addEventListener('click', function () { delete picks[id]; drawPicks(); });
      li.appendChild(rm); pickRows.appendChild(li); total += picks[id];
    });
    if (!ids.length) pickRows.appendChild(el('li', 'empty', 'No projects yet. Add one above, or add a list below.'));
    pickTotal.textContent = ids.length ? money(total) + ' a month across ' + ids.length + (ids.length === 1 ? ' project' : ' projects') : '';
    pickNote.textContent = notOpen ? notOpen + (notOpen === 1 ? ' pick is' : ' picks are') + ' not open-licensed yet. Under the proposed rule that money waits; your pick still tells us and the maintainers that it matters.' : '';
    pickSave.disabled = !(total >= 1 && total <= 1000);
    pickSave.textContent = ids.length ? 'Save this split · ' + money(total) + '/mo' : 'Save this split';
  }
  $('#pick-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var input = $('#pick-search'), q = input.value.trim().toLowerCase(), status = $('#pick-status');
    var hit = entries.filter(function (e) { return e.tier === 'featured' && e.name.toLowerCase() === q; })[0] ||
      entries.filter(function (e) { return e.tier === 'featured' && q && e.name.toLowerCase().indexOf(q) >= 0; })[0];
    if (!hit) { say(status, 'No listed project matches. You can nominate it below.', true); return; }
    addPick(hit.id, 1); input.value = ''; say(status, 'Added ' + hit.name + '.'); drawPicks();
  });
  pickSave.addEventListener('click', function () {
    var total = Object.keys(picks).reduce(function (a, id) { return a + picks[id]; }, 0), copy = {};
    Object.keys(picks).forEach(function (id) { copy[id] = picks[id]; });
    core.openJoin('custom', pickSave, { allocations: copy, amount: total, summary: 'Your own split: ' + money(total) + ' a month across ' + Object.keys(copy).length + ' projects.' });
  });
  $('#pick-clear').addEventListener('click', function () { picks = {}; drawPicks(); });

  // ---- lists --------------------------------------------------------------------
  function names(ids, n) { var a = ids.filter(function (id) { return byId[id]; }).slice(0, n).map(function (id) { return byId[id].name; }); return a.join(', ') + (ids.length > n ? ' and ' + (ids.length - n) + ' more' : ''); }
  function fundList(ids, from) { ids.forEach(function (id) { addPick(id, 1); }); drawPicks(); $('#fund').scrollIntoView(); $('#pick-save').focus(); }
  function listCard(l, official) {
    var card = el('article', 'list-card');
    card.appendChild(el('p', 'list-by', official ? 'Curated by ' + l.by : l.by));
    card.appendChild(el('h3', null, l.name)); card.appendChild(el('p', 'list-line', l.line));
    card.appendChild(el('p', 'list-items', l.items.length + ' projects: ' + names(l.items, 5)));
    var row = el('p', 'list-actions');
    var show = el('button', 'btn ghost small', 'Show in catalog'); show.type = 'button';
    show.addEventListener('click', function () { core.filterIds(l.items, l.name); $('#catalog').scrollIntoView(); });
    var fund = el('button', 'btn ghost small', 'Add to my split'); fund.type = 'button';
    fund.addEventListener('click', function () { fundList(l.items, fund); });
    row.appendChild(show); row.appendChild(fund); card.appendChild(row);
    return card;
  }
  var mineBox = $('#mine-items'), mineName = $('#mine-name'), mineStatus = $('#mine-status');
  function shareLink() { return location.origin + location.pathname + '#list=' + mine.items.join(',') + (mine.name ? '&name=' + encodeURIComponent(mine.name) : ''); }
  function drawMine() {
    mineBox.textContent = '';
    mine.items = mine.items.filter(function (id) { return byId[id]; });
    mine.items.forEach(function (id) {
      var chip = el('li'); chip.appendChild(el('span', null, byId[id].name));
      var rm = el('button', null, '×'); rm.type = 'button'; rm.setAttribute('aria-label', 'Remove ' + byId[id].name + ' from my list');
      rm.addEventListener('click', function () { toggleMine(id); }); chip.appendChild(rm); mineBox.appendChild(chip);
    });
    if (!mine.items.length) mineBox.appendChild(el('li', 'empty', 'Empty. Use "Add to my list" on any project in the catalog.'));
    $$('#mine-share, #mine-fund, #mine-clear').forEach(function (b) { b.disabled = !mine.items.length; });
    if (document.activeElement !== mineName) mineName.value = mine.name;
  }
  mineName.addEventListener('input', function () { mine.name = mineName.value.slice(0, 60); store.set('hi-patron-list', mine); });
  $('#mine-share').addEventListener('click', function () {
    var link = shareLink();
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { say(mineStatus, 'Link copied. Anyone with it sees this list; nothing is stored on our side.'); },
      function () { say(mineStatus, link); });
  });
  $('#mine-fund').addEventListener('click', function () { fundList(mine.items); });
  $('#mine-clear').addEventListener('click', function () { mine = { name: '', items: [] }; saveMine(); say(mineStatus, 'Cleared.'); });
  function readShared() {
    var m = /^#list=([a-z0-9,\-]{1,2000})(?:&name=([^&]{0,300}))?$/.exec(location.hash); if (!m) return;
    var ids = m[1].split(',').filter(function (id, i, a) { return byId[id] && byId[id].tier === 'featured' && a.indexOf(id) === i; }).slice(0, 40);
    if (!ids.length) return;
    var name = ''; try { name = decodeURIComponent(m[2] || '').slice(0, 60); } catch (e) {}
    var box = $('#shared-list'); box.hidden = false; box.textContent = '';
    box.appendChild(el('p', 'list-by', 'A list someone shared with you. Not curated or checked by us.'));
    box.appendChild(el('h3', null, name || 'Untitled list')); box.appendChild(el('p', 'list-items', ids.length + ' projects: ' + names(ids, 8)));
    var row = el('p', 'list-actions');
    var keep = el('button', 'btn ghost small', 'Save as my list'); keep.type = 'button';
    keep.addEventListener('click', function () { mine = { name: name, items: ids.slice() }; saveMine(); say(mineStatus, 'Saved as your list in this browser.'); });
    var show = el('button', 'btn ghost small', 'Show in catalog'); show.type = 'button';
    show.addEventListener('click', function () { core.filterIds(ids, name || 'Shared list'); $('#catalog').scrollIntoView(); });
    var fund = el('button', 'btn ghost small', 'Add to my split'); fund.type = 'button'; fund.addEventListener('click', function () { fundList(ids); });
    row.appendChild(keep); row.appendChild(show); row.appendChild(fund); box.appendChild(row);
    $('#lists').scrollIntoView();
  }

  // ---- scan your stack (parsed here; nothing leaves the page unless you nominate) --
  var REG = { npm: 'https://www.npmjs.com/package/', pypi: 'https://pypi.org/project/', cargo: 'https://crates.io/crates/', go: 'https://pkg.go.dev/', rubygems: 'https://rubygems.org/gems/', homebrew: 'https://formulae.brew.sh/formula/' };
  var ECO = { npm: 'npm', pypi: 'PyPI', cargo: 'Cargo', go: 'Go', rubygems: 'RubyGems', homebrew: 'Homebrew' };
  function parseStack(text) {
    var out = [], seen = {}, add = function (eco, name) { name = String(name).trim(); var k = eco + ':' + name.toLowerCase(); if (name && name.length <= 120 && !seen[k]) { seen[k] = 1; out.push({ ecosystem: eco, name: name }); } };
    var json = null; try { json = JSON.parse(text); } catch (e) {}
    if (json && typeof json === 'object') {
      ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].forEach(function (k) { if (json[k] && typeof json[k] === 'object') Object.keys(json[k]).forEach(function (n) { add('npm', n); }); });
      return out;
    }
    var section = '', inRequire = false;
    text.split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/\s+#.*$/, '').trim(), m;
      if (!line || line.charAt(0) === '#' || line.indexOf('//') === 0) return;
      if ((m = /^\[([^\]]+)\]$/.exec(line))) { section = m[1].trim(); return; }
      if (/^(dependencies|dev-dependencies|build-dependencies)$/.test(section) || /^(workspace\.dependencies|target\..+\.dependencies)$/.test(section)) { if ((m = /^([A-Za-z0-9_\-]+)\s*=/.exec(line))) add('cargo', m[1]); return; }
      if (section) return;
      if (/^require\s*\($/.test(line)) { inRequire = true; return; }
      if (inRequire) { if (line === ')') { inRequire = false; return; } if ((m = /^([\w.\-]+\.[a-z]{2,}\/\S+)\s+v\S+/.exec(line))) add('go', m[1]); return; }
      if ((m = /^require\s+([\w.\-]+\.[a-z]{2,}\/\S+)\s+v\S+/.exec(line))) { add('go', m[1]); return; }
      if (/^(module|go|toolchain|replace|exclude|retract)\b/.test(line)) return;
      if ((m = /^gem\s+["']([^"']+)["']/.exec(line))) { add('rubygems', m[1]); return; }
      if ((m = /^(?:brew|cask)\s+["']([^"']+)["']/.exec(line))) { add('homebrew', m[1].split('/').pop()); return; }
      if (/^(source|ruby|group|end|tap|mas|platforms?|gemspec|plugin)\b/.test(line) || line.charAt(0) === '-') return;
      if ((m = /^([A-Za-z0-9][A-Za-z0-9._\-]*)\s*(?:\[[^\]]*\])?\s*(?:[=<>!~]=?|===|;|@|$)/.exec(line))) add('pypi', m[1]);
    });
    return out;
  }
  var scanOut = $('#scan-out'), scanStatus = $('#scan-status'), scanSend = $('#scan-send'), found = [];
  function drawScan() {
    scanOut.textContent = '';
    var known = {}; entries.forEach(function (e) { if (e.tier === 'featured') known[e.name.toLowerCase()] = e; });
    found.forEach(function (p, i) {
      var li = el('li'), id = 'scan-' + i, box = el('input'); box.type = 'checkbox'; box.id = id; box.value = String(i);
      var hit = known[p.name.toLowerCase()];
      var lab = el('label', null, p.name); lab.htmlFor = id; li.appendChild(box); li.appendChild(lab);
      li.appendChild(el('span', 'scan-eco', ECO[p.ecosystem]));
      if (hit) li.appendChild(el('span', 'pill s-open', 'In the catalog'));
      var a = el('a', 'cat-src', 'Registry'); a.href = REG[p.ecosystem] + encodeURIComponent(p.name).replace(/%2F/g, '/').replace(/%40/g, '@'); a.rel = 'noopener'; a.setAttribute('aria-label', p.name + ' on ' + ECO[p.ecosystem]); li.appendChild(a);
      box.addEventListener('change', function () { var n = $$('input:checked', scanOut).length; scanSend.disabled = !n || n > 30; scanSend.textContent = n ? 'Nominate ' + n + ' selected' : 'Nominate selected'; if (n > 30) say(scanStatus, 'Choose up to 30 at a time.', true); });
      scanOut.appendChild(li);
    });
    scanSend.disabled = true; scanSend.textContent = 'Nominate selected';
  }
  function runScan(text) {
    found = parseStack(text).slice(0, 400);
    if (!found.length) { say(scanStatus, 'No packages recognised. Supported: package.json, requirements.txt, Cargo.toml, go.mod, Gemfile, Brewfile.', true); drawScan(); return; }
    var by = {}; found.forEach(function (p) { by[ECO[p.ecosystem]] = (by[ECO[p.ecosystem]] || 0) + 1; });
    say(scanStatus, 'Found ' + found.length + ' packages (' + Object.keys(by).map(function (k) { return by[k] + ' ' + k; }).join(', ') + '). This list exists only in your browser. Tick the ones you rely on.');
    drawScan();
  }
  $('#scan-run').addEventListener('click', function () { runScan($('#scan-text').value); });
  $('#scan-file').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0]; if (!f) return;
    if (f.size > 2000000) { say(scanStatus, 'That file is over 2 MB. Paste the dependency section instead.', true); return; }
    var r = new FileReader(); r.onload = function () { $('#scan-text').value = String(r.result).slice(0, 200000); runScan(String(r.result)); }; r.readAsText(f);
  });
  scanSend.addEventListener('click', function () {
    var items = $$('input:checked', scanOut).map(function (b) { return found[+b.value]; }).slice(0, 30);
    if (!items.length) return;
    scanSend.disabled = true;
    post('/api/patron-nominate', { items: items, why: 'From a stack scan', website: '', source_page: location.pathname }).then(function (res) {
      say(scanStatus, res.ok ? 'Sent ' + items.length + ' package names for review. Nothing else from your file was sent.' : (res.status === 429 ? 'Too many tries. Please try again in an hour.' : 'That did not send. Please try again.'), !res.ok);
      if (res.ok) $$('input:checked', scanOut).forEach(function (b) { b.checked = false; b.disabled = true; });
      scanSend.textContent = 'Nominate selected';
    });
  });

  // ---- nominate -----------------------------------------------------------------
  var nomForm = $('#nominate-form'), nomStatus = $('#nominate-status');
  nomForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = nomForm.elements, name = f.name.value.trim(), link = f.url.value.trim(), email = f.email.value.trim();
    if (!name) { say(nomStatus, 'Give the project a name.', true); f.name.focus(); return; }
    if (!/^https:\/\/\S+\.\S+/.test(link)) { say(nomStatus, 'Add a link that starts with https://', true); f.url.focus(); return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/.test(email)) { say(nomStatus, 'Check the email address, or leave it blank.', true); f.email.focus(); return; }
    var btn = $('button[type="submit"]', nomForm); btn.disabled = true;
    post('/api/patron-nominate', { name: name, url: link, why: f.why.value.trim(), email: email, website: f.website.value, source_page: location.pathname }).then(function (res) {
      btn.disabled = false;
      if (res.ok) { nomForm.reset(); say(nomStatus, 'Thank you. ' + name + ' is in the review queue. It is not listed until someone has checked it.'); }
      else say(nomStatus, res.status === 429 ? 'Too many tries. Please try again in an hour.' : (res.status === 400 && res.error ? res.error : 'That did not send. Please try again.'), true);
    });
  });

  // ---- optional Ideaflow ID -----------------------------------------------------
  fetch('/api/patron-session').then(function (r) { return r.json(); }).then(function (s) {
    if (!s.enabled) return;
    var box = $('#signin'); box.hidden = false;
    if (s.signedIn) {
      $('#signin-text').textContent = 'Signed in with Ideaflow' + (s.email ? ' as ' + s.email : '') + '.';
      var out = $('#signin-btn'); out.textContent = 'Sign out'; out.removeAttribute('href'); out.setAttribute('role', 'button'); out.tabIndex = 0;
      var go = function (ev) { ev.preventDefault(); fetch('/auth/ideaflow/signout', { method: 'POST' }).then(function () { location.reload(); }); };
      out.addEventListener('click', go); out.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') go(ev); });
      core.prefillEmail(s.email);
    }
  }).catch(function () {});

  // ---- start ----------------------------------------------------------------------
  core.onReady(function (data) {
    entries = data.entries; lists = data.lists || [];
    entries.forEach(function (e) { byId[e.id] = e; });
    var dl = $('#pick-options'); entries.forEach(function (e) { if (e.tier === 'featured') { var o = el('option'); o.value = e.name; dl.appendChild(o); } });
    var box = $('#official-lists'); box.textContent = ''; lists.forEach(function (l) { box.appendChild(listCard(l, true)); });
    drawPicks(); drawMine(); readShared(); core.redraw();
  });
})();
