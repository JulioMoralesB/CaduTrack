import '@testing-library/jest-dom/vitest'

// jsdom does not implement matchMedia, and the theme code asks the system for
// its light/dark preference. Without this every component that renders the
// theme picker throws.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}
