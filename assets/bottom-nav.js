(function () {
  try {
    var params = new URLSearchParams(location.search || '');
    var isEmbedParam = params.get('embed') === '1';

    var inIframe = (function () {
      try {
        return window.self !== window.top;
      } catch (e) {
        return true;
      }
    })();

    // If we're rendered inside an iframe (e.g. index.html shell), the parent may show
    // a fixed bottom nav that can cover the iframe's content. Mark this so CSS can
    // add a bottom spacer and lift fixed buttons.
    if (inIframe) {
      document.documentElement.classList.add('gm-in-iframe');
      return;
    }

    // If a page is opened with embed=1 outside an iframe, don't mount nav.
    if (isEmbedParam) return;
    if (document.querySelector('.gm-bottom-nav')) return;

    var ROUTE_ITEMS = [
      {
        key: 'gm-script',
        label: 'Скрипти',
        hash: '#gm-script',
        icon:
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h11a2 2 0 0 1 2 2v4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v17h11V5H4Zm15 6h-2v8h2v-8Zm-11 1h6v2H8v-2Zm0 4h6v2H8v-2Z"/></svg>'
      },
      {
        key: 'calc',
        label: 'Прайс',
        hash: '#calc',
        icon:
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 2v16h10V4H7Zm2 2h6v4H9V6Zm0 6h2v2H9v-2Zm4 0h2v2h-2v-2Zm-4 4h2v2H9v-2Zm4 0h2v2h-2v-2Z"/></svg>'
      },
      {
        key: 'plan',
        label: 'План',
        hash: '#plan',
        icon:
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v2h6V2h2v2h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3V2Zm14 8H3v10h18V10ZM4 8h16V6H4v2Zm6 5h2v2h-2v-2Zm-4 0h2v2H6v-2Zm8 0h2v2h-2v-2Z"/></svg>'
      },
      {
        key: 'anketa',
        label: 'Анкета',
        hash: '#anketa',
        icon:
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l5 5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V8h4.5L14 3.5ZM7 11h10v2H7v-2Zm0 4h10v2H7v-2Zm0 4h6v2H7v-2Z"/></svg>'
      },
      {
        key: 'education',
        label: 'Навчання',
        hash: '#education',
        icon:
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 1 9l11 6 9-4.91V17h2V9L12 3Zm0 14L4 13v4l8 4 8-4v-4l-8 4Z"/></svg>'
      }
    ];

    function isIndexShell() {
      return !!document.getElementById('pageFrame');
    }

    function getRouteFromContext() {
      var hash = (location.hash || '').replace(/^#/, '').trim();
      for (var i = 0; i < ROUTE_ITEMS.length; i++) {
        if (ROUTE_ITEMS[i].key === hash) return hash;
      }

      var file = (location.pathname || '').split('/').pop().toLowerCase();
      var map = {
        'gm-script.html': 'gm-script',
        'calc.html': 'calc',
        'dov.html': 'plan',
        'generator-ankety.html': 'anketa',
        'education.html': 'education'
      };
      return map[file] || 'gm-script';
    }

    function buildIndexUrl(hash) {
      var url = new URL(location.href);
      url.search = '';
      if (!/index\.html$/i.test(url.pathname)) {
        url.pathname = url.pathname.replace(/[^/]+$/i, 'index.html');
      }
      url.hash = hash;
      return url.toString();
    }

    function closeHamburgerMenus() {
      try {
        var nav = document.getElementById('nav');
        if (nav) {
          nav.classList.remove('active');
          nav.classList.remove('open');
        }
      } catch (e) {}
    }

    var navEl = document.createElement('nav');
    navEl.className = 'gm-bottom-nav';
    navEl.setAttribute('aria-label', 'Навігація');

    var inner = document.createElement('div');
    inner.className = 'gm-bottom-nav__inner';
    navEl.appendChild(inner);

    for (var idx = 0; idx < ROUTE_ITEMS.length; idx++) {
      (function (item) {
        var a = document.createElement('a');
        a.className = 'gm-bottom-nav__item';
        a.href = item.hash;
        a.setAttribute('aria-label', item.label);
        a.dataset.route = item.key;
        a.innerHTML =
          '<span class="gm-bottom-nav__icon">' +
          item.icon +
          '</span><span class="gm-bottom-nav__label">' +
          item.label +
          '</span>';

        a.addEventListener('click', function (e) {
          closeHamburgerMenus();

          if (!isIndexShell()) {
            e.preventDefault();
            location.href = buildIndexUrl(item.hash);
            return;
          }
        });

        inner.appendChild(a);
      })(ROUTE_ITEMS[idx]);
    }

    document.documentElement.classList.add('gm-bottom-nav-enabled');

    // Append after body exists.
    if (document.body) {
      document.body.appendChild(navEl);
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.appendChild(navEl);
      });
    }

    function syncActive() {
      var activeKey = getRouteFromContext();
      var nodes = navEl.querySelectorAll('.gm-bottom-nav__item[data-route]');
      for (var i = 0; i < nodes.length; i++) {
        var isActive = nodes[i].dataset.route === activeKey;
        if (isActive) {
          nodes[i].setAttribute('aria-current', 'page');
        } else {
          nodes[i].removeAttribute('aria-current');
        }
      }
    }

    window.addEventListener('hashchange', syncActive);
    syncActive();
  } catch (e) {
    // noop
  }
})();
