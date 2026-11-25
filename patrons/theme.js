// Same theme key and behaviour as humanityinfrastructure.com, applied before styles paint.
(function () {
  var choice = 'auto';
  try { choice = localStorage.getItem('h3-theme') || 'auto'; } catch (e) {}
  if (['light', 'dark', 'auto'].indexOf(choice) < 0) choice = 'auto';
  var system = matchMedia('(prefers-color-scheme: dark)');
  function apply() {
    var theme = choice === 'auto' ? (system.matches ? 'dark' : 'light') : choice;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }
  window.hiTheme = {
    get: function () { return choice; },
    set: function (value) { choice = value; try { localStorage.setItem('h3-theme', value); } catch (e) {} apply(); }
  };
  system.addEventListener('change', apply);
  apply();
})();
