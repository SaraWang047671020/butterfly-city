// Story_Panel and Persona picker (story-layer Requirement 5). The view is built by main.ts from the story layer;
// this component only renders it. Text comes from citizens.json and the UI_Strings_Module.
import { setText } from '../component.ts';
import { fillTemplate, UI_STRINGS, quarterLabel } from '../strings.ts';

export type StoryPanelView =
  | { readonly kind: 'error'; readonly error: string }
  | { readonly kind: 'picker'; readonly personas: readonly { readonly id: string; readonly picker: string; readonly name: string }[] }
  | {
      readonly kind: 'story';
      readonly name: string;
      readonly intro: string;
      /** Filled lines of the Displayed_Quarter; empty before the first quarter is computed. */
      readonly lines: readonly string[];
      readonly quarter: string | null;
      /** Filled ending lines once 2025Q4 is computed (Requirement 5.5); empty otherwise. */
      readonly ending: readonly string[];
    };

export interface StoryPanelActions {
  choose(personaId: string): void;
  change(): void;
}

export interface StoryPanel {
  readonly root: HTMLElement;
  update(view: StoryPanelView): void;
}

const T = UI_STRINGS.story;

export function createStoryPanel(doc: Document, actions: StoryPanelActions): StoryPanel {
  const root = doc.createElement('div');
  root.className = 'story-panel';
  const message = doc.createElement('p');
  message.className = 'story-panel__message';
  const picker = doc.createElement('div');
  picker.className = 'story-panel__picker';
  const pickerHeading = doc.createElement('p');
  pickerHeading.className = 'story-panel__heading';
  pickerHeading.textContent = T.pickerHeading;
  const pickerList = doc.createElement('ul');
  pickerList.className = 'story-panel__choices';
  picker.append(pickerHeading, pickerList);

  const story = doc.createElement('div');
  story.className = 'story-panel__story';
  const name = doc.createElement('h3');
  name.className = 'story-panel__name';
  const intro = doc.createElement('p');
  intro.className = 'story-panel__intro';
  const quarter = doc.createElement('p');
  quarter.className = 'story-panel__quarter';
  // One polite announcement per update of the lines (Requirement 5.6).
  const lines = doc.createElement('div');
  lines.className = 'story-panel__lines';
  lines.setAttribute('aria-live', 'polite');
  const ending = doc.createElement('div');
  ending.className = 'story-panel__ending';
  const change = doc.createElement('button');
  change.type = 'button';
  change.className = 'story-panel__change';
  change.textContent = T.change;
  change.addEventListener('click', () => actions.change());
  story.append(name, intro, quarter, lines, ending, change);
  root.append(message, picker, story);

  let shownLines = '';
  let pickerKey = '';
  const paragraphs = (host: HTMLElement, texts: readonly string[]) =>
    host.replaceChildren(
      ...texts.map((t) => {
        const p = doc.createElement('p');
        p.textContent = t;
        return p;
      }),
    );

  return {
    root,
    update(view) {
      message.hidden = view.kind !== 'error';
      picker.hidden = view.kind !== 'picker';
      story.hidden = view.kind !== 'story';
      if (view.kind === 'error') {
        setText(message, fillTemplate(T.loadError, { error: view.error }));
        return;
      }
      if (view.kind === 'picker') {
        const key = view.personas.map((p) => p.id).join(',');
        if (key !== pickerKey) {
          pickerKey = key;
          pickerList.replaceChildren(
            ...view.personas.map((p) => {
              const li = doc.createElement('li');
              const b = doc.createElement('button');
              b.type = 'button';
              b.className = 'story-panel__choice';
              const strong = doc.createElement('strong');
              strong.textContent = p.name;
              b.append(strong, doc.createTextNode(` · ${p.picker}`));
              b.addEventListener('click', () => actions.choose(p.id));
              li.appendChild(b);
              return li;
            }),
          );
        }
        return;
      }
      setText(name, view.name);
      setText(intro, view.intro);
      setText(quarter, view.quarter === null ? T.noQuarter : fillTemplate(T.quarter, { quarter: quarterLabel(view.quarter) }));
      const text = view.lines.join('\n');
      if (text !== shownLines) {
        shownLines = text;
        paragraphs(lines, view.lines);
      }
      ending.hidden = view.ending.length === 0;
      if (view.ending.length > 0) paragraphs(ending, [T.endingHeading, ...view.ending]);
    },
  };
}
