(function () {
  var params = new URLSearchParams(window.location.search);
  var embedded = window.self !== window.top || params.get('embed') === '1';

  if (!embedded) return;

  document.documentElement.classList.add('embed-mode');

  window.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('embed-mode');
  });
})();
