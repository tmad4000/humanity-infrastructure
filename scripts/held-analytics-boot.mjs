// Regression: with analytics.ideaflow.app held (never responds), the page must still
// fire DOMContentLoaded, run the deferred feature scripts (hearts UI, X embed loader) and
// auto-open the signup dialog for /join and /#letter (which must not wait for window.load).
// Usage: node scripts/held-analytics-boot.mjs <worker.js path> <playwright index.mjs path>
const [,, workerPath, pwPath] = process.argv;
const { chromium } = await import(pwPath);
const worker = (await import('file://' + workerPath)).default;
const env = { SIGNUPS: { prepare() { return { bind() { return this; }, async first() { return null; }, async all() { return { results: [] }; }, async run() { return {}; } }; }, async batch() { return []; } } };
const browser = await chromium.launch();
const results = [];
for (const path of ['/', '/classic', '/v2', '/v3', '/v4', '/join', '/#letter']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'analytics.ideaflow.app') return; // HELD: never fulfilled
    if (url.hostname === 'humanityinfrastructure.com') {
      const res = await worker.fetch(new Request(url.href, { method: route.request().method() }), env, { waitUntil() {} });
      return route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    }
    return route.abort(); // X, WIT API, fonts: blocked for determinism
  });
  const t0 = Date.now();
  await page.goto('https://humanityinfrastructure.com' + path, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const dclMs = Date.now() - t0;
  await page.waitForTimeout(800);
  const state = await page.evaluate(() => ({
    readyState: document.readyState,
    hearts: document.querySelectorAll('.resource-actions, [data-signal-item]').length,
    embedLoaderRan: !!document.querySelector('#conversation [data-theme], #conversation.tweet-rendered, #conversation [data-theme]'),
    hasConversation: !!document.querySelector('#conversation'),
    hiTrack: typeof window.hiTrack === 'function',
    signupOpen: !!document.querySelector('dialog[open]'),
  }));
  results.push({ path, dclMs, ...state, errors });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
const home = results.find(r => r.path === '/');
const ok = results.every(r => r.dclMs < 10000 && r.errors.length === 0 && r.hiTrack) && home.hearts > 0 && (!home.hasConversation || home.embedLoaderRan)
  && results.filter(r => r.path === '/join' || r.path === '/#letter').every(r => r.signupOpen);
console.log(ok ? 'HELD-ANALYTICS BOOT: PASS' : 'HELD-ANALYTICS BOOT: FAIL'); process.exit(ok ? 0 : 1);
