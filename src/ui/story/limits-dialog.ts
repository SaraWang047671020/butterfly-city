// Limits_Dialog body (story-layer Requirement 6). The texts come from model-limits.json, already filled by the caller;
// the dialog itself is the game-ui dialog manager (focus in, focus trap, Escape, focus return).

export interface LimitsView {
  readonly intro: string;
  readonly disclosure: string;
  readonly sourcesLink: string;
  readonly sections: readonly { readonly title: string; readonly items: readonly { readonly title: string; readonly text: string }[] }[];
}

export function buildLimitsBody(doc: Document, view: LimitsView): HTMLElement {
  const root = doc.createElement('div');
  root.className = 'limits';
  const p = (text: string, className: string) => {
    const e = doc.createElement('p');
    e.className = className;
    e.textContent = text;
    return e;
  };
  root.append(p(view.intro, 'limits__intro'), p(view.disclosure, 'limits__disclosure'));
  for (const s of view.sections) {
    const section = doc.createElement('section');
    section.className = 'limits__section';
    const h = doc.createElement('h3');
    h.textContent = s.title;
    section.appendChild(h);
    const dl = doc.createElement('dl');
    for (const it of s.items) {
      const dt = doc.createElement('dt');
      dt.textContent = it.title;
      const dd = doc.createElement('dd');
      dd.textContent = it.text;
      dl.append(dt, dd);
    }
    section.appendChild(dl);
    root.appendChild(section);
  }
  root.appendChild(p(view.sourcesLink, 'limits__sources'));
  return root;
}
