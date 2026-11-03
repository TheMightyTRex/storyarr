// Snaglist (github.com/TheMightyTRex/snaglist), copied unchanged into snaglist.js: change it there, not here.
// It sets window.Snaglist when it loads.
export {};

declare global {
  interface Window {
    Snaglist?: {
      start(settings: Record<string, unknown>): boolean;
      open(type?: string): void;
      version: string;
    };
  }
}
