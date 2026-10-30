export type AudibleStore =
  "us" | "uk" | "au" | "ca" | "de" | "es" | "fr" | "in" | "it" | "jp";
export const audibleStores: [AudibleStore, string][] = [
  ["us", "United States"],
  ["uk", "United Kingdom"],
  ["au", "Australia"],
  ["ca", "Canada"],
  ["de", "Germany"],
  ["es", "Spain"],
  ["fr", "France"],
  ["in", "India"],
  ["it", "Italy"],
  ["jp", "Japan"],
];
const countryStores: Record<string, AudibleStore> = {
  US: "us",
  GB: "uk",
  AU: "au",
  CA: "ca",
  DE: "de",
  ES: "es",
  FR: "fr",
  IN: "in",
  IT: "it",
  JP: "jp",
};
const languageStores: Record<string, AudibleStore> = {
  de: "de",
  es: "es",
  fr: "fr",
  it: "it",
  ja: "jp",
};

/** The Audible store for this browser's country, such as United Kingdom for en-GB. */
export function suggestedAudibleStore(
  languages: readonly string[] = globalThis.navigator?.languages ?? [],
): AudibleStore {
  for (const tag of languages) {
    const [language, country] = tag.split("-");
    if (country && countryStores[country.toUpperCase()])
      return countryStores[country.toUpperCase()];
    if (languageStores[language.toLowerCase()])
      return languageStores[language.toLowerCase()];
  }
  return "us";
}
