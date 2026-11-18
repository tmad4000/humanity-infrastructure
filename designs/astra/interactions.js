const form = document.querySelector('#newsletter');
form.addEventListener('submit', event => event.preventDefault());
document.querySelector('#preview').addEventListener('click', () => {
  document.querySelector('#newsletter-status').textContent = 'Newsletter signup is coming soon. This preview does not send or save your email.';
});
