import type { TurnBarView, UiActions } from '../../types/view.ts';
import { setAttr, setText } from '../component.ts';
import type { Component, ComponentFactory } from '../component.ts';
import { buildEngineErrorText, fillTemplate, UI_STRINGS, quarterLabel } from '../strings.ts';
import '../../styles/turn-bar.css';

const T = UI_STRINGS.turnBar;

/** A paragraph that is shown only while it has text. */
function optionalLine(doc: Document, className: string): HTMLElement {
  const el = doc.createElement('p');
  el.className = className;
  el.hidden = true;
  return el;
}

function setOptional(el: HTMLElement, text: string | null): void {
  el.hidden = text === null;
  setText(el, text ?? '');
}

function makeButton(doc: Document, className: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  // Enter and Space activate a native button as a click.
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Turn_Bar: Disclosure_Text, quarter display, Next_Quarter_Action, Fast_Forward_Action and save controls.
 * It is an independent block. The outer container decides where it goes (see mountComponent).
 */
export const createTurnBar: ComponentFactory<TurnBarView> = (doc: Document, actions: UiActions): Component<TurnBarView> => {
  const root = doc.createElement('section');
  root.className = 'turn-bar';
  root.setAttribute('aria-label', UI_STRINGS.app.title);

  const disclosure = doc.createElement('p');
  disclosure.className = 'turn-bar__disclosure';
  disclosure.textContent = UI_STRINGS.app.disclosure;

  const demo = optionalLine(doc, 'turn-bar__demo');
  const planning = optionalLine(doc, 'turn-bar__planning');
  const displayed = doc.createElement('p');
  displayed.className = 'turn-bar__displayed';
  const turn = doc.createElement('p');
  turn.className = 'turn-bar__turn';
  const complete = optionalLine(doc, 'turn-bar__complete');

  const controls = doc.createElement('div');
  controls.className = 'turn-bar__controls';
  const next = makeButton(doc, 'turn-bar__button', T.nextQuarter, () => actions.nextQuarter());
  // One primary action per step (play-loop Requirement 4.2): Fast-forward is secondary.
  const fast = makeButton(doc, 'turn-bar__button turn-bar__button--secondary', T.fastForward, () => actions.fastForward());
  const busy = doc.createElement('span');
  busy.className = 'turn-bar__busy';
  busy.setAttribute('role', 'status');
  controls.append(next, fast, busy);

  const engineError = optionalLine(doc, 'turn-bar__engine-error');
  const storage = optionalLine(doc, 'turn-bar__warning');
  const version = optionalLine(doc, 'turn-bar__warning');

  const save = doc.createElement('div');
  save.className = 'turn-bar__save';
  const exportButton = makeButton(doc, 'turn-bar__button', T.exportSaveCode, () => actions.exportSaveCode());
  const importButton = makeButton(doc, 'turn-bar__button', T.importSaveCode, () => actions.openImport());
  save.append(exportButton, importButton);

  root.append(disclosure, demo, planning, displayed, turn, complete, controls, engineError, storage, version, save);

  function update(view: TurnBarView): void {
    setOptional(demo, view.demo ? T.demoLabel : null);
    setOptional(planning, view.planning === null ? null : `${T.planningQuarter}: ${quarterLabel(view.planning)}`);
    setText(
      displayed,
      view.displayed === null ? T.noQuarterComputed : `${T.displayedQuarter}: ${quarterLabel(view.displayed)}`,
    );
    setText(turn, fillTemplate(T.turnNumber, { n: String(view.turn) }));
    setOptional(complete, view.complete ? T.complete : null);

    next.disabled = !view.nextEnabled || view.busy || view.complete;
    fast.disabled = !view.fastForwardEnabled || view.busy || view.complete;
    setAttr(root, 'aria-busy', view.busy ? 'true' : null);
    setText(busy, view.busy ? T.busy : '');

    setOptional(
      engineError,
      view.engineError === null
        ? null
        : buildEngineErrorText(view.engineError.error.code, view.engineError.error.details),
    );
    setOptional(storage, view.storageWarning ? UI_STRINGS.storage.notStored : null);
    setOptional(
      version,
      view.versionNotice === null
        ? null
        : fillTemplate(UI_STRINGS.importMessages.engineVersionNotice, {
            saved: view.versionNotice.saved,
            current: view.versionNotice.current,
          }),
    );
  }

  return { root, update };
};
