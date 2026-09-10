export const nameKey = (name: string) => name.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");
export function suggestNames(name: string, candidates: string[]) {
  const key = nameKey(name);
  if (!key) return [];
  return [...new Set(candidates)].filter(candidate => candidate !== name && nameKey(candidate) && (nameKey(candidate) === key || (key.length >= 4 && (nameKey(candidate).includes(key) || key.includes(nameKey(candidate)))))).slice(0, 5);
}
