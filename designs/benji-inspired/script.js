// Prototype only. The letter form does not submit anywhere.
(function () {
  var form = document.getElementById('letter-form');
  var note = document.getElementById('letter-note');
  var input = document.getElementById('letter-email');
  if (!form || !note || !input) return;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = input.value.trim();
    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      note.textContent = 'Please enter an email address like you@example.org.';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    note.textContent = 'Noted, thank you. This is a static prototype, so nothing was sent.';
  });
})();
