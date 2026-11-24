// District_List (Requirement 4.6, task 16.4): the keyboard-accessible alternative to the map.
// Independent block: mount `root` into a host (src/ui/component.ts). No page layout and no visual values here;
// class names are styled in src/styles. Native buttons give pointer, Enter and Space activation.
import type { DistrictCode } from '../../types/data-files.ts';
import type { DistrictListView, UiActions } from '../../types/view.ts';
import { reconcileKeyed, setAttr, setText, type Component } from '../component.ts';
import { fillTemplate, UI_STRINGS, cityLabel } from '../strings.ts';

const D = UI_STRINGS.districtPanel;

interface GroupParts {
  readonly root: HTMLElement;
  readonly heading: HTMLElement;
  readonly list: HTMLElement;
  readonly items: Map<string, HTMLElement>;
  readonly buttons: Map<string, HTMLButtonElement>;
}

export function createDistrictList(doc: Document, actions: UiActions): Component<DistrictListView> {
  const root = doc.createElement('section');
  root.className = 'ui-district-list';
  const heading = doc.createElement('h2');
  heading.className = 'ui-district-list-heading';
  heading.textContent = D.listHeading;
  root.appendChild(heading);
  const groupsHost = doc.createElement('div');
  groupsHost.className = 'ui-district-list-groups';
  root.appendChild(groupsHost);

  const groupCache = new Map<string, GroupParts>();
  const groupEls = new Map<string, HTMLElement>();
  let groupIdCounter = 0;

  const createGroup = (city: string): HTMLElement => {
    const groupRoot = doc.createElement('div');
    groupRoot.className = 'ui-district-group';
    groupRoot.setAttribute('role', 'group');
    const h = doc.createElement('h3');
    h.className = 'ui-district-group-heading';
    h.id = `ui-district-group-${(groupIdCounter += 1)}`;
    h.textContent = fillTemplate(D.cityHeading, { city: cityLabel(city) });
    groupRoot.setAttribute('aria-labelledby', h.id);
    const list = doc.createElement('ul');
    list.className = 'ui-district-items';
    groupRoot.append(h, list);
    groupCache.set(city, {
      root: groupRoot,
      heading: h,
      list,
      items: new Map(),
      buttons: new Map(),
    });
    return groupRoot;
  };

  return {
    root,
    update(view: DistrictListView): void {
      reconcileKeyed(
        groupsHost,
        groupEls,
        view.groups.map((g) => g.city),
        createGroup,
      );
      for (const group of view.groups) {
        const parts = groupCache.get(group.city);
        if (parts === undefined) continue;
        const sorted = [...group.districts].sort((a, b) => a.name.localeCompare(b.name, 'en'));
        const byCode = new Map<string, { code: DistrictCode; name: string }>();
        for (const d of sorted) byCode.set(d.code, d);
        reconcileKeyed(
          parts.list,
          parts.items,
          sorted.map((d) => d.code),
          (code) => {
            const li = doc.createElement('li');
            li.className = 'ui-district-item';
            const button = doc.createElement('button');
            button.type = 'button';
            button.className = 'ui-district-button';
            button.addEventListener('click', () => {
              actions.selectDistrict(code as DistrictCode);
            });
            li.appendChild(button);
            parts.buttons.set(code, button);
            return li;
          },
        );
        for (const [code, button] of parts.buttons) {
          const d = byCode.get(code);
          if (d === undefined) continue;
          setText(button, d.name);
          const selected = view.selected === d.code;
          setAttr(button, 'aria-pressed', selected ? 'true' : 'false');
          setAttr(button, 'data-code', code);
        }
        for (const code of [...parts.buttons.keys()]) {
          if (!parts.items.has(code)) parts.buttons.delete(code);
        }
      }
    },
  };
}
