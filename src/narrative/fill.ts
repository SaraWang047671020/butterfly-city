// Template_Filler (story-layer Requirement 3). Pure: formats no number and reads no file.

export class FillError extends Error {
  readonly templateId: string;
  readonly placeholder: string;
  constructor(templateId: string, placeholder: string) {
    super(`${templateId}: no value for {${placeholder}}`);
    this.templateId = templateId;
    this.placeholder = placeholder;
  }
}

const PLACEHOLDER = /\{([A-Za-z0-9_.]+)\}/g;

/** Distinct Placeholder names of a Template, in order of first occurrence. */
export function placeholdersOf(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** The Template with every Placeholder replaced; throws FillError for the first Placeholder without a value. */
export function fillTemplate(templateId: string, template: string, values: Readonly<Record<string, string>>): string {
  for (const name of placeholdersOf(template)) {
    if (!Object.hasOwn(values, name)) throw new FillError(templateId, name);
  }
  return template.replace(PLACEHOLDER, (_, name: string) => values[name]!);
}
