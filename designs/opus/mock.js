// Non-submitting mock forms. Nothing leaves the page.
document.querySelectorAll('form.mock').forEach(function (form) {
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var status = form.querySelector('.status');
    if (!status) return;
    status.textContent = form.id === 'letter-form'
      ? 'Prototype only: no address was sent or stored.'
      : 'Prototype only: nothing was sent. Use the GitHub suggestion form linked above.';
  });
});
