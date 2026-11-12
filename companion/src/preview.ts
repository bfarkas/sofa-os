// The TV preview, the other half of Companion's editor. It runs inside /preview.html, which the build makes from Sofa Home's
// own tv/app/index.html (same markup and stylesheet), and it draws with Sofa Home's own code: shell.ts decides what each tab
// shows, view.ts and cards.ts draw it into that markup, shared/ holds the tokens. Only the network, keys and Tizen are left
// out. The editor (editor.ts) puts this page in a 1920x1080 iframe and scales it down.
import { dayFootInk, dayImage, dayInk, periodAt, SCHEME_PROPS, schemeVars, textOn, tokensCss, type Layout, type WidgetsResponse } from '@sofa/shared';
import { cardOptions, setWidgetsState } from '../../tv/src/cards.ts';
import { forestFor } from '../../tv/src/kids.ts';
import { createShell, type Tab } from '../../tv/src/shell.ts';
import { initView, redrawCards, render, setFocus } from '../../tv/src/view.ts';
import { emptyState, parseWidgets } from '../../tv/src/widgets.ts';

export interface PreviewState {
  layout: Layout;
  widgets: WidgetsResponse; // what GET /api/widgets would say (the editor builds it with previewWidgets)
  screen: 'household' | 'kids';
  tab: Tab;
  focus: string | null; // a focus id like app:<id> or widget:<id> to ring, or none
}
export interface PreviewApi {
  update(state: PreviewState): void;
}

// The tokens go in as custom properties on the root: the Server's CSP allows that, but no inline <style> that tokensCss() would make.
for (const decl of tokensCss().slice(6, -1).split(';')) {
  const i = decl.indexOf(':');
  document.documentElement.style.setProperty(decl.slice(0, i), decl.slice(i + 1));
}
initView();
const stage = document.getElementById('stage')!;
const shell = createShell({ onView: render, onFocus: setFocus });
shell.setMode('home');
cardOptions.server = ''; // photo paths are on this Server

// What main.ts's paintBackground does: the layout's colour or day picture (text follows it), or the forest in Kids Mode.
function paint(s: PreviewState): void {
  const kids = s.screen === 'kids';
  const color = s.layout.background.kind === 'color' ? s.layout.background.color : '';
  document.body.className = kids ? 'kids' : '';
  // The colour scheme goes on the stage as properties (an inline <style> would break the CSP); never in Kids Mode.
  const scheme = kids ? {} : schemeVars(s.layout.scheme);
  for (const k of SCHEME_PROPS) (scheme as Record<string, string>)[k] ? stage.style.setProperty(k, (scheme as Record<string, string>)[k]) : stage.style.removeProperty(k);
  const period = !kids && s.layout.background.kind === 'daycycle' ? periodAt(new Date().getHours()) : null; // the preview shows the picture of the hour, no fade
  document.body.style.background = kids ? '#26331f url(img/kids-forest-' + forestFor(new Date()) + '.jpg) center / cover no-repeat' : period ? '#1f241e url(' + dayImage(period) + ') center / cover no-repeat' : color;
  if (period) stage.style.setProperty('--on-bg', dayInk(period));
  else if (!kids && color) stage.style.setProperty('--on-bg', textOn(color));
  else stage.style.removeProperty('--on-bg');
  if (period) stage.style.setProperty('--on-foot', dayFootInk(period));
  else stage.style.removeProperty('--on-foot');
}

(window as unknown as { sofaPreview: PreviewApi }).sofaPreview = {
  update(s) {
    shell.setScreen(s.screen);
    paint(s);
    setWidgetsState(parseWidgets(s.widgets, Date.now()) ?? emptyState());
    shell.setLayout(s.layout);
    redrawCards();
    shell.focus.focus('tab:' + s.tab); // shows that tab
    if (!s.focus || !shell.focus.focus(s.focus)) setFocus(null);
  },
};
