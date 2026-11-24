// Character chip (play-loop Requirement 7.1, approved main screen 2026-11-23): the player's Character in the top
// left with the Character_Numbers of the shown quarter (rent burden, commute). Hidden without a Character.
import type { CharacterView } from '../../game/life/controller.ts';
import type { Component } from '../component.ts';
import { setText } from '../component.ts';
import { formatNumber } from '../format/number.ts';
import { fillTemplate, UI_STRINGS } from '../strings.ts';

const U = UI_STRINGS.characterUi;

export interface ChipProps {
  readonly view: CharacterView | null;
  readonly occupationName: (id: string | null) => string;
  readonly districtName: (code: string) => string;
}

export function createCharacterChip(doc: Document): Component<ChipProps> & { readonly root: HTMLElement } {
  const root = doc.createElement('section');
  root.className = 'ui-character-chip';
  root.hidden = true;
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('class', 'ui-character-chip__avatar');
  svg.setAttribute('aria-hidden', 'true');
  const head = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
  head.setAttribute('cx', '20');
  head.setAttribute('cy', '13');
  head.setAttribute('r', '7');
  head.setAttribute('class', 'ui-creation__skin');
  const bodyShape = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bodyShape.setAttribute('x', '10');
  bodyShape.setAttribute('y', '22');
  bodyShape.setAttribute('width', '20');
  bodyShape.setAttribute('height', '16');
  bodyShape.setAttribute('rx', '8');
  svg.append(head, bodyShape);
  const words = doc.createElement('div');
  const name = doc.createElement('p');
  name.className = 'ui-character-chip__name';
  const where = doc.createElement('p');
  where.className = 'ui-character-chip__where';
  words.append(name, where);
  const stat = (label: string) => {
    const p = doc.createElement('p');
    p.className = 'ui-character-chip__stat';
    const l = doc.createElement('span');
    l.className = 'ui-character-chip__stat-label';
    l.textContent = label;
    const v = doc.createElement('span');
    v.className = 'ui-character-chip__stat-value';
    p.append(l, v);
    return { p, v };
  };
  const rent = stat(U.chipRent);
  const commute = stat(U.chipCommute);
  root.append(svg, words, rent.p, commute.p);

  return {
    root,
    update({ view, occupationName, districtName }) {
      root.hidden = view === null;
      if (view === null) return;
      const me = view.life.members.find((m) => m.kind === 'self');
      root.setAttribute('aria-label', fillTemplate(U.chipLabel, { name: view.character.name }));
      bodyShape.setAttribute('class', `ui-look--${me?.look.colour ?? 'teal'}`);
      setText(name, view.character.name);
      setText(
        where,
        fillTemplate(U.chipWhere, {
          occupation: occupationName(me?.occupation ?? null),
          tenure: view.life.tenure === 'family' ? U.family : U.renting,
          district: districtName(view.life.home),
        }),
      );
      const n = view.numbers.player;
      setText(rent.v, n.rentBurden === null ? U.noValue : `${formatNumber(n.rentBurden, 1)}%`);
      setText(commute.v, n.commuteMinutes === null ? '—' : `${formatNumber(n.commuteMinutes, 0)}′`);
    },
  };
}
