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
    if (!document.hidden) { focusStage(); refocusSoon(); }
  });

  add('START hidden=' + document.hidden);
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
