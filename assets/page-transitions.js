(() => {
  const docEl = document.documentElement;

  const closeHeaderMenu = () => {
    try {
      document.querySelectorAll('.nav.open').forEach((el) => el.classList.remove('open'));
      document.querySelectorAll('.nav.active').forEach((el) => el.classList.remove('active'));
      document.querySelectorAll('.hamburger.open').forEach((el) => el.classList.remove('open'));
    } catch {}
  };

  const markReady = () => {
    docEl.classList.add('pagefx-ready');
    docEl.classList.remove('pagefx-exit');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', markReady, { once: true });
  } else {
    markReady();
  }

  // Back/forward cache restores can keep the exit class.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) markReady();
  });

  const isModifiedClick = (event) =>
    event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

  const shouldAnimateLink = (anchor, event) => {
    if (!anchor) return false;
    if (event.defaultPrevented) return false;
    if (event.button !== 0) return false;
    if (isModifiedClick(event)) return false;

    if (anchor.hasAttribute('download')) return false;
    if (anchor.getAttribute('target') && anchor.getAttribute('target') !== '_self') return false;
    if (anchor.dataset.noTransition === '1') return false;
    if (anchor.classList.contains('no-transition')) return false;

    const rawHref = anchor.getAttribute('href');
    if (!rawHref) return false;
    if (rawHref.startsWith('#')) return false;
    if (rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) return false;
    if (rawHref.startsWith('javascript:')) return false;

    let url;
    try {
      url = new URL(anchor.href, window.location.href);
    } catch {
      return false;
    }

    if (url.origin !== window.location.origin) return false;

    const exactSameUrl =
      url.pathname === window.location.pathname &&
      url.search === window.location.search &&
      url.hash === window.location.hash;
    if (exactSameUrl) return false;

    const sameDoc =
      url.pathname === window.location.pathname &&
      url.search === window.location.search &&
      url.hash !== window.location.hash;
    if (sameDoc) return false;

    return true;
  };

  document.addEventListener(
    'click',
    (event) => {
      // The request is specifically about header navigation.
      const anchor = event.target?.closest?.('.header a');
      if (!anchor) return;

      // Close hamburger menu instantly (mobile UX).
      closeHeaderMenu();

      if (!shouldAnimateLink(anchor, event)) return;

      let url;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      event.preventDefault();

      docEl.classList.add('pagefx-exit');

      const navigate = () => {
        window.location.href = url.href;
      };

      const onAnimEnd = (e) => {
        if (e.animationName === 'pagefx-out') navigate();
      };

      document.body?.addEventListener('animationend', onAnimEnd, { once: true });
      window.setTimeout(navigate, 220);
    },
    true
  );
})();
