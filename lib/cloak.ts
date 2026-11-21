// Cloaking, ported from Abyss-Web (static/index.js): disguising Devon's tab
// (title and icon), opening Devon inside an about:blank tab so its address
// never shows in the address bar or history, and a panic key that swaps the
// whole tab for an ordinary site.

export interface CloakPreset {
  id: string
  label: string
  title: string
  icon: string
}

/** Abyss's tab-cloak presets */
export const CLOAK_PRESETS: CloakPreset[] = [
  { id: "classroom", label: "Google Classroom", title: "Home", icon: "https://ssl.gstatic.com/classroom/ic_product_classroom_144.png" },
  { id: "drive", label: "Google Drive", title: "Home - Google Drive", icon: "https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png" },
  { id: "docs", label: "Google Docs", title: "Google Docs", icon: "https://ssl.gstatic.com/docs/documents/images/kix-favicon-2023q4.ico" },
  { id: "google", label: "Google", title: "Google", icon: "https://www.google.com/favicon.ico" },
  {
    id: "schoology",
    label: "Schoology",
    title: "Home | Schoology",
    icon: "https://asset-cdn.schoology.com/sites/all/themes/schoology_theme/favicon.ico",
  },
  {
    id: "mathspace",
    label: "Mathspace",
    title: "Mathspace",
    icon: "https://mathspace-production-static.mathspace.co/static/cache/ea9ab2022ffbb8b29669acc8bd75e6a3b2187553/website/favicons/android-chrome-192x192.png",
  },
  { id: "khan", label: "Khan Academy", title: "Khan Academy | Free Online Courses", icon: "https://www.khanacademy.org/favicon.ico" },
  { id: "ixl", label: "IXL", title: "IXL", icon: "https://www.ixl.com/favicon.ico" },
]

export const DEFAULT_PANIC_URL = "https://www.google.com/"
/** What an about:blank tab looks like when no tab cloak is set (Abyss's default) */
const BLANK_DEFAULT = CLOAK_PRESETS[1]

export interface CloakSettings {
  /** Title shown on Devon's tab instead of its own; null = Devon's */
  title: string | null
  /** Icon shown on Devon's tab instead of its own; null = Devon's */
  icon: string | null
  /** Keys that trigger the panic redirect when pressed within a second of each other */
  panicKeys: string[] | null
  /** Where the panic key goes; also where the original tab goes after opening about:blank */
  panicUrl: string
  /** Reopen Devon in an about:blank tab on every visit */
  autoBlank: boolean
}

const STORAGE_KEY = "devon-cloak"
const DEFAULTS: CloakSettings = { title: null, icon: null, panicKeys: null, panicUrl: DEFAULT_PANIC_URL, autoBlank: false }
let current: CloakSettings | null = null

export function readCloak(): CloakSettings {
  if (current) return current
  let saved: Partial<CloakSettings> = {}
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") ?? {}
  } catch {
    saved = {}
  }
  current = {
    title: typeof saved.title === "string" && saved.title.trim() ? saved.title : null,
    icon: typeof saved.icon === "string" && normalizeUrl(saved.icon) ? saved.icon : null,
    panicKeys:
      Array.isArray(saved.panicKeys) && saved.panicKeys.length && saved.panicKeys.every((k) => typeof k === "string")
        ? saved.panicKeys
        : null,
    panicUrl: typeof saved.panicUrl === "string" && normalizeUrl(saved.panicUrl) ? saved.panicUrl : DEFAULT_PANIC_URL,
    autoBlank: saved.autoBlank === true,
  }
  return current
}

export function writeCloak(patch: Partial<CloakSettings>): CloakSettings {
  current = { ...readCloak(), ...patch }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // storage blocked: still applies for this visit
  }
  return current
}

/** "classroom.google.com" → "https://classroom.google.com/"; null if it isn't a web address */
export function normalizeUrl(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    if (!url.hostname.includes(".") && url.hostname !== "localhost") return null
    return url.href
  } catch {
    return null
  }
}

/** Devon is running inside something — an about:blank tab, or another page */
export function isFramed(): boolean {
  try {
    return window.top !== window
  } catch {
    return true
  }
}

/** The about:blank tab Devon was opened in, if it's in one (it's same-origin, so it can be cloaked too) */
function blankWrapper(): Document | null {
  try {
    if (window.top && window.top !== window && window.top.location.href === "about:blank") return window.top.document
  } catch {
    // a cross-origin parent
  }
  return null
}

// ── Tab cloak ────────────────────────────────────────────────────────────

let devonTitle: string | null = null
let titleObserver: MutationObserver | null = null

function setIcons(doc: Document, icon: string | null) {
  const links = [...doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')]
  for (const link of links) {
    // Remember Devon's own icons so they can come back
    if (link.dataset.devonHref === undefined) {
      link.dataset.devonHref = link.getAttribute("href") ?? ""
      link.dataset.devonType = link.getAttribute("type") ?? ""
    }
    if (icon) {
      link.href = icon
      link.removeAttribute("type") // an .ico in a link typed image/svg+xml would be ignored
    } else {
      link.setAttribute("href", link.dataset.devonHref)
      if (link.dataset.devonType) link.type = link.dataset.devonType
    }
  }
  if (icon && !links.length) {
    const link = doc.createElement("link")
    link.rel = "icon"
    link.href = icon
    doc.head.appendChild(link)
  }
}

/** Shows the saved tab cloak on Devon's tab (or takes it off), and keeps it there */
export function applyTabCloak() {
  const { title, icon } = readCloak()
  devonTitle ??= document.title
  document.title = title ?? devonTitle
  setIcons(document, icon)

  const wrapper = blankWrapper()
  if (wrapper) {
    wrapper.title = title ?? BLANK_DEFAULT.title
    setIcons(wrapper, icon ?? BLANK_DEFAULT.icon)
  }

  // Devon's own pages (and Next) can set the title again; put the cloak back
  if (!titleObserver && typeof MutationObserver !== "undefined") {
    titleObserver = new MutationObserver(() => {
      const cloak = readCloak().title
      if (cloak && document.title !== cloak) document.title = cloak
    })
    titleObserver.observe(document.head, { subtree: true, childList: true, characterData: true })
  }
}

// ── about:blank ──────────────────────────────────────────────────────────

/**
 * Opens Devon inside a new about:blank tab, then sends this tab to the panic
 * URL — so the address bar shows about:blank and Devon's address never
 * reaches the history. Returns false when the browser blocked the popup.
 */
export function openAboutBlank(): boolean {
  const popup = window.open("about:blank", "_blank")
  if (!popup || popup.closed) return false
  const { title, icon, panicUrl } = readCloak()
  const doc = popup.document
  doc.title = title ?? BLANK_DEFAULT.title
  const link = doc.createElement("link")
  link.rel = "icon"
  link.href = icon ?? BLANK_DEFAULT.icon
  doc.head.appendChild(link)

  const frame = doc.createElement("iframe")
  frame.src = location.href
  frame.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
  frame.setAttribute("allowfullscreen", "")
  frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:none;outline:none;margin:0;padding:0"
  doc.body.style.margin = "0"
  doc.body.appendChild(frame)

  // Ask before the tab closes, so a stray Ctrl+W doesn't lose it. Runs in the
  // new tab itself: this tab is about to navigate away.
  const script = doc.createElement("script")
  script.textContent = `addEventListener("beforeunload", function (e) { e.preventDefault(); e.returnValue = "" })`
  doc.head.appendChild(script)

  location.replace(panicUrl)
  return true
}

// ── Panic key ────────────────────────────────────────────────────────────

/** "a" and "A" are the same key here; "Control", "Shift" etc. stay as they are */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

export function describeKeys(keys: string[]): string {
  const names: Record<string, string> = { " ": "Space", Control: "Ctrl", Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" }
  return keys.map((k) => names[k] ?? (k.length === 1 ? k.toUpperCase() : k)).join(" + ")
}

/** Leaves for the panic URL, taking the about:blank tab along if Devon is in one */
export function panic() {
  const url = readCloak().panicUrl
  try {
    window.top!.location.replace(url)
  } catch {
    location.replace(url)
  }
}

let recording = false
/** While Settings records a new panic key, pressing the old one does nothing */
export function setRecordingPanicKey(on: boolean) {
  recording = on
}

let pressed: string[] = []
let resetTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Listens on Devon's window and on every proxied page (keys pressed inside a
 * frame never reach Devon's window). Like Abyss: the keys count when they're
 * all pressed within a second, in any order.
 */
export function handlePanicKey(event: KeyboardEvent) {
  const keys = readCloak().panicKeys
  if (!keys?.length || recording || event.repeat) return
  if (!resetTimer) {
    resetTimer = setTimeout(() => {
      pressed = []
      resetTimer = null
    }, 1000)
  }
  pressed.push(normalizeKey(event.key))
  if (keys.every((k) => pressed.includes(k))) {
    pressed = []
    event.preventDefault()
    panic()
  }
}
