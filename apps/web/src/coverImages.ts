/** Cover addresses the page may show: web addresses, the app's own paths and inline images. */
function safeCover(url: string) {
  return /^(https?:\/\/|\/(?!\/)|data:image\/)/i.test(url) ? url : "";
}
/** Small, durable variants for cards; detail and export callers retain the original. */
export function coverImage(url: string, size: 320 | 640 | 1200 = 320) {
  return url.startsWith("https://")
    ? `/api/catalog/cover-image?size=${size}&url=${encodeURIComponent(url)}`
    : safeCover(url);
}
export function coverImageSet(url: string) {
  return url.startsWith("https://")
    ? `${coverImage(url, 320)} 1x, ${coverImage(url, 640)} 2x`
    : undefined;
}
