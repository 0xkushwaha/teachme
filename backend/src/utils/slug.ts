export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const HONORIFICS = /^(dr|mr|mrs|ms|mx|prof|sir|shri|smt)\.?$/i;

/** First name for greetings, skipping honorifics ("Dr. Meera Iyer" → "Meera"). */
export function firstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.find((p) => !HONORIFICS.test(p)) ?? parts[0] ?? '';
}
