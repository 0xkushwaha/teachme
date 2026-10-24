/**
 * Minimal, safe template renderer for admin-editable notification templates.
 *   {{var}}            HTML-escaped value (dot paths allowed: {{booking.subject}})
 *   {{#if var}}..{{/if}}  section rendered when value is truthy
 * There is intentionally no raw/unescaped interpolation, so admins cannot inject markup via data.
 */
export function render(template: string, data: Record<string, unknown>, escape = true): string {
  const withSections = template.replace(/\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, path: string, inner: string) =>
    lookup(data, path) ? inner : '',
  );
  return withSections.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const v = lookup(data, path);
    const s = v === undefined || v === null ? '' : String(v);
    return escape ? escapeHtml(s) : s;
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function lookup(data: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), data);
}

/** Variables referenced by a template — used to validate admin edits. */
export function referencedVariables(template: string): string[] {
  const vars = new Set<string>();
  for (const m of template.matchAll(/\{\{(?:#if\s+)?\s*([\w.]+)\s*\}\}/g)) vars.add(m[1]);
  return [...vars];
}
