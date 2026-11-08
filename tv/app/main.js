// Session 01 skeleton: logs keys and lifecycle events on screen. ES5 only (Chromium M56).
(function () {
  var KEY = 'sofahome.events';
  var MAX = 18;
  var stage = document.getElementById('stage');
  var logEl = document.getElementById('log');
  var events = [];
  try { events = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { events = []; }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function add(text) {
    var d = new Date();
    events.push(pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + text);
    events = events.slice(-MAX);
    try { localStorage.setItem(KEY, JSON.stringify(events)); } catch (e) { /* storage full or off */ }
    logEl.textContent = events.join('\n');
    send(events[events.length - 1]);
  }

  // Fire-and-forget to tv/tools/recv.py on the Mac; SOFA_LOG_URL comes from build.sh (empty = off).
  function send(line) {
    if (!window.SOFA_LOG_URL) return;
    try {
      var x = new XMLHttpRequest();
      x.open('POST', window.SOFA_LOG_URL);
      x.send(line);
    } catch (e) { /* receiver not running */ }
  }

  // Colour and media keys only reach the page after registration; log whether each registers.
  var EXTRA = ['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'MediaPlayPause', 'MediaPlay', 'MediaPause',
    'MediaStop', 'MediaRewind', 'MediaFastForward', 'MediaTrackPrevious', 'MediaTrackNext', 'Info', 'Menu', 'Guide', 'Exit', 'ChannelUp', 'ChannelDown', 'VolumeUp', 'VolumeDown', 'VolumeMute'];

  function focusStage() { stage.focus(); }

  // Tizen resumes the web view before input focus settles, so refocus a few times.
  function refocusSoon() { [250, 900, 1800].forEach(function (ms) { setTimeout(focusStage, ms); }); }


  // Session 02: Fetch over HTTPS and a WSS echo with reconnect, to learn what M56 accepts.
  var BASE = 'sofa.familie-farkas.de';
  var ws = null, wsOpenedAt = 0, retryMs = 1000, seq = 0, pinger = null;

  function fetchTest() {
    var t0 = new Date().getTime();
    var timer = setTimeout(function () { add('fetch TIMEOUT 8s'); }, 8000);
    try {
      fetch('https://' + BASE + '/ping', { cache: 'no-store' }).then(function (r) {
        return r.text().then(function (body) {
          clearTimeout(timer);
          add('fetch ' + r.status + ' "' + body + '" ' + (new Date().getTime() - t0) + 'ms');
        });
      }).catch(function (e) { clearTimeout(timer); add('fetch FAIL ' + e); });
    } catch (e) { clearTimeout(timer); add('fetch THROW ' + e); }
  }


  // no-cors resolves on any completed TLS+HTTP exchange and rejects on DNS, TLS or connect failure.
  function probe(url) {
    var t0 = new Date().getTime();
    fetch(url, { mode: 'no-cors', cache: 'no-store' }).then(function () {
      add('probe OK   ' + url + ' ' + (new Date().getTime() - t0) + 'ms');
    }).catch(function (e) { add('probe FAIL ' + url + ' ' + (new Date().getTime() - t0) + 'ms'); });
  }
  function probes() {
    ['https://sofa.familie-farkas.de/ping', 'https://wolke.familie-farkas.de/', 'https://valid-isrgrootx1.letsencrypt.org/',
      'https://www.google.com/generate_204', 'http://sofa.familie-farkas.de/ping'].forEach(probe);
  }


  function xhrTest() {
    var t0 = new Date().getTime(), x = new XMLHttpRequest();
    x.open('GET', 'https://' + BASE + '/ping');
    x.timeout = 8000;
    x.onload = function () { add('xhr ' + x.status + ' "' + x.responseText + '" ' + (new Date().getTime() - t0) + 'ms'); };
    x.onerror = function () { add('xhr ERROR ' + (new Date().getTime() - t0) + 'ms'); };
    x.ontimeout = function () { add('xhr TIMEOUT'); };
    x.send();
  }

  function wsConnect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    var t0 = new Date().getTime();
    try { ws = new WebSocket('wss://' + BASE + '/echo'); } catch (e) { add('wss THROW ' + e); return; }
    var mine = ws;
    mine.onopen = function () {
      wsOpenedAt = new Date().getTime(); retryMs = 1000;
      add('wss OPEN ' + (wsOpenedAt - t0) + 'ms');
      clearInterval(pinger);
      pinger = setInterval(function () { if (mine.readyState === 1) mine.send('ping ' + (++seq)); }, 5000);
    };
    mine.onmessage = function (m) { add('wss echo ' + m.data); };
    mine.onerror = function () { add('wss ERROR'); };
    mine.onclose = function (e) {
      add('wss CLOSE code=' + e.code + ' clean=' + e.wasClean + ' up=' + (wsOpenedAt ? Math.round((new Date().getTime() - wsOpenedAt) / 1000) + 's' : 'never'));
      clearInterval(pinger);
      if (mine !== ws) return;
      setTimeout(wsConnect, retryMs);
      retryMs = Math.min(retryMs * 2, 30000);
    };
  }

  var down = {};
  document.addEventListener('keydown', function (e) {
    if (down[e.keyCode]) return;
    down[e.keyCode] = new Date().getTime();
    add('down ' + e.keyCode + ' key=' + e.key);
    e.preventDefault();
  });
  document.addEventListener('keyup', function (e) {
    var held = down[e.keyCode] ? new Date().getTime() - down[e.keyCode] : 0;
    delete down[e.keyCode];
    add('up   ' + e.keyCode + ' held=' + held + 'ms');
  });

  window.addEventListener('blur', function () { down = {}; });
  window.addEventListener('focus', function () { focusStage(); refocusSoon(); });
  document.addEventListener('visibilitychange', function () {
    down = {};
    add(document.hidden ? 'HIDDEN' : 'VISIBLE');
    if (!document.hidden) {
      focusStage(); refocusSoon();
      if (window.SOFA_NET_TEST) add('wss state=' + (ws ? ws.readyState : 'none') + ' on resume');
      if (window.SOFA_NET_TEST) { fetchTest(); xhrTest(); wsConnect(); }
    }
  });

  add('START hidden=' + document.hidden);
  if (window.SOFA_NET_TEST) { fetchTest(); xhrTest(); wsConnect(); probes(); }
  var ok = [], bad = [];
  EXTRA.forEach(function (k) {
    try { tizen.tvinputdevice.registerKey(k); ok.push(k); } catch (e) { bad.push(k); }
  });
  add('registered ' + ok.length + ' failed: ' + (bad.join(',') || 'none'));
  try {
    add('supported: ' + tizen.tvinputdevice.getSupportedKeys().map(function (k) { return k.name + '=' + k.code; }).join(' '));
  } catch (e) { add('getSupportedKeys failed'); }
  focusStage();
  refocusSoon();
})();
