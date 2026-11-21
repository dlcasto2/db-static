// Colour themes, ported from Abyss-Web (static/assets/themes/*.css). Each
// Abyss theme is one background colour; here Devon's surfaces are all mixed
// from it (see the [data-devon-theme] rules in app/globals.css), so the tab
// strip, toolbar, menus and pages stay distinct from each other.

export interface DevonTheme {
  id: string
  name: string
  /** Its background colour, for the picker */
  swatch: string
}

export const THEMES: DevonTheme[] = [
  { id: "devon", name: "Devon", swatch: "#15161b" },
  { id: "moon", name: "Black", swatch: "#000000" },
  { id: "grey", name: "Grey", swatch: "#1f1f1f" },
  { id: "mocha", name: "Mocha", swatch: "#1e1e2e" },
  { id: "macchiato", name: "Macchiato", swatch: "#24273a" },
  { id: "frappe", name: "Frappé", swatch: "#303446" },
  { id: "cappuccino", name: "Cappuccino", swatch: "#a18d68" },
]

const STORAGE_KEY = "devon-theme"
const DEFAULT_THEME = "devon"

export function readTheme(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && THEMES.some((t) => t.id === saved)) return saved
  } catch {
    // storage blocked
  }
  return DEFAULT_THEME
}

export function applyTheme(id: string) {
  const theme = THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME
  if (theme === DEFAULT_THEME) delete document.documentElement.dataset.devonTheme
  else document.documentElement.dataset.devonTheme = theme
  try {
    if (theme === DEFAULT_THEME) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // storage blocked: still applies for this visit
  }
}

/** Runs in <head> before the first paint (see app/layout.tsx), so a saved theme never flashes in late */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(${JSON.stringify(
  THEMES.filter((t) => t.id !== DEFAULT_THEME).map((t) => t.id),
)}.indexOf(t)>-1)document.documentElement.dataset.devonTheme=t}catch(e){}`
