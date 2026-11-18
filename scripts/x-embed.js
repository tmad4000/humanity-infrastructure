// X is contacted only once this standalone slot approaches the viewport.
(() => {
  const slot = document.getElementById('lastbook-conversation');
  if (!slot) return;
  const figure = slot.querySelector('figure');
  const fallback = figure.innerHTML;
  let started = false;
  let theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const prepare = () => {
    figure.innerHTML = fallback;
    figure.querySelector('blockquote').dataset.theme = theme;
    slot.classList.remove('tweet-rendered');
  };
  prepare();
  const load = () => {
    if (started) return;
    started = true;
    // Official ready queue: bind before the widget scans its blockquote.
    window.twttr = window.twttr || { _e: [], ready(fn) { this._e.push(fn); } };
    window.twttr.ready(t => {
      t.events.bind('rendered', event => {
        if (slot.contains(event.target)) slot.classList.add('tweet-rendered');
      });
      t.widgets.load(slot);
    });
    const script = document.createElement('script');
    script.id = 'twitter-wjs';
    script.async = true;
    script.src = 'https://platform.twitter.com/widgets.js';
    script.referrerPolicy = 'no-referrer';
    document.head.append(script);
  };
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
    }, { rootMargin: '200px 0px' });
    observer.observe(slot);
  }
  // Without IntersectionObserver, preserve the static quote rather than eager-load X.
  new MutationObserver(() => {
    const next = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    if (next === theme) return;
    theme = next;
    prepare();
    if (started && window.twttr.widgets) window.twttr.widgets.load(slot);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
