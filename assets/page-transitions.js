(function () {
  try {
    var root = document.documentElement;

    // If some page didn't opt into pagefx, do nothing.
    if (!root.classList.contains('pagefx')) return;

    var markReady = function () {
      try {
        root.classList.add('pagefx-ready');
      } catch (e) {}
    };

    // Make sure the page becomes visible even if other scripts fail.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        window.setTimeout(markReady, 0);
      });
    } else {
      window.setTimeout(markReady, 0);
    }
  } catch (e) {}
})();
