/**
 * The address's query as it is right now. Every filter, sort or toggle change starts from this,
 * not from the copy taken at the last render (`useSearchParams`, or React Router's
 * `setSearchParams(previous => …)`, which hands over that same copy). Otherwise two quick
 * changes in a row lose the first: choose Audiobooks, then change Sort before the page redraws,
 * and Audiobooks is gone.
 */
export function currentParams() {
  return new URLSearchParams(window.location.search);
}
