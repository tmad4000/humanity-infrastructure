// Anonymous, cookieless analytics. Never pass form values or arbitrary URLs.
(function () {
  'use strict';
  const routes = new Set(['/', '/classic', '/v2', '/v3', '/v4', '/join']);
  const sources = new Set(['x', 'twitter', 'buzz', 'hi_newsletter', 'github', 'lastbook', 'x-interest']);
  function safeUrl(raw) {
    const url = new URL(raw || '/', location.origin);
    const path = routes.has(url.pathname.replace(/\/$/, '') || '/') ? (url.pathname.replace(/\/$/, '') || '/') : '/other';
    const query = new URLSearchParams();
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref']) {
      const value = url.searchParams.get(key) || '';
      const valid = key === 'utm_source' || key === 'ref' ? sources.has(value)
        : key === 'utm_medium' ? ['social', 'community', 'email', 'referral'].includes(value)
        : key === 'utm_campaign' ? /^hi_launch_\d{6}$/.test(value)
        : /^(reply_(farbood|kevinrose)_\d{2}|launch_post_\d{2}|issue_\d{8}_primary)$/.test(value);
      if (valid) query.set(key, value);
    }
    return path + (query.size ? '?' + query : '');
  }
  window.hiAnalyticsBeforeSend = function (type, payload) {
    if (navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes' || window.doNotTrack === '1') return null;
    // No tracking on private routes or previews; normal pageviews stay automatic.
    if (!['humanityinfrastructure.com', 'www.humanityinfrastructure.com', 'humanity3.earth'].includes(location.hostname)) return null;
    payload.url = safeUrl(payload.url);
    try { payload.referrer = payload.referrer ? new URL(payload.referrer, location.origin).origin : ''; }
    catch { payload.referrer = ''; }
    payload.title = 'Humanity Infrastructure';
    return payload;
  };
  const pending = [];
  window.hiTrack = function (name, properties = {}) {
    if (navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes') return;
    if (window.ideaflow) window.ideaflow.track(name, properties);
    else if (pending.length < 30) pending.push([name, properties]);
  };
  document.addEventListener('DOMContentLoaded', function () {
    if (window.ideaflow) pending.splice(0).forEach(([name, props]) => window.ideaflow.track(name, props));
  });
  document.addEventListener('click', function (event) {
    const target = event.target.closest('a[href], [data-signup-open]');
    if (!target || target.closest('#signal-thanks, #letter-context-links')) return;
    const placement = target.closest('footer') ? 'footer' : target.closest('header,nav') ? 'header' : 'body';
    if (target.matches('[data-signup-open]')) return window.hiTrack('newsletter_signup_start', {placement});
    const url = new URL(target.href, location.origin);
    const declared = target.dataset.analyticsEvent;
    if (['suggest_resource', 'pr_guide_open'].includes(declared)) return window.hiTrack(declared, {placement});
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === location.origin) return;
    const host = url.hostname.replace(/^www\./, '');
    const listing = target.dataset.analyticsListing || target.closest('.card[id]')?.id;
    const name = target.matches('.claim') ? 'quest_claim' : listing ? 'resource_outbound_click' : host === 'github.com' ? 'github_click' : ['x.com', 'twitter.com'].includes(host) ? 'x_outbound_click' : 'resource_outbound_click';
    const props = {placement, destination_host: host, elapsed_ms: Math.round(performance.now())};
    if (listing && /^[a-z0-9-]{1,80}$/.test(listing)) props.listing_id = listing;
    else if (host === 'lastbook.org') props.listing_id = 'lastbook';
    window.hiTrack(name, props);
  });
})();
