"use client"

// Devon's settings: the proxy server, plus the features ported from
// Abyss-Web — search engine, themes, tab cloak, about:blank and the panic key.

import type React from "react"
import { useEffect, useState } from "react"
import { AppWindow, Check, Keyboard, Palette, Search, Server, Settings, VenetianMask } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  CLOAK_PRESETS,
  applyTabCloak,
  describeKeys,
  normalizeKey,
  normalizeUrl,
  openAboutBlank,
  readCloak,
  setRecordingPanicKey,
  writeCloak,
  type CloakSettings,
} from "@/lib/cloak"
import { CHOOSABLE_ENGINES, readEnginePref, writeEnginePref } from "@/lib/search-engines"
import { THEMES, applyTheme, readTheme } from "@/lib/themes"
import {
  DEFAULT_PROXY_SERVER,
  getConfiguredServer,
  getDetectedBackend,
  getProxyServer,
  getSavedProxyServer,
  getWispTransport,
  proxyKind,
  proxyServerProblem,
  setProxyServer,
  setWispTransport,
  type WispTransport,
} from "@/lib/uv"
import { cn } from "@/lib/utils"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The proxy server changed: reload whatever page is showing through it */
  onProxyChanged: () => void
  /** Short confirmations and errors */
  notify: (message: string, kind?: "success" | "error") => void
}

const inputClass =
  "h-9 min-w-0 flex-1 rounded-full bg-omnibox px-4 text-sm ring-1 ring-border outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/60 select-text"

function Section({ icon, title, children, hint }: { icon: React.ReactNode; title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b border-border px-5 py-4 last:border-b-0">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium [&_svg]:size-4 [&_svg]:text-primary">
          {icon}
          {title}
        </h3>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

export function SettingsDialog({ open, onOpenChange, onProxyChanged, notify }: SettingsDialogProps) {
  const [proxyInput, setProxyInput] = useState("")
  const [transport, setTransport] = useState<WispTransport>("libcurl")
  const [engine, setEngine] = useState("auto")
  const [theme, setTheme] = useState("devon")
  const [cloak, setCloak] = useState<CloakSettings>(() => readCloak())
  const [titleInput, setTitleInput] = useState("")
  const [iconInput, setIconInput] = useState("")
  const [panicUrlInput, setPanicUrlInput] = useState("")
  const [recording, setRecording] = useState(false)

  // Fresh from storage every time it opens
  useEffect(() => {
    if (!open) return
    const c = readCloak()
    setCloak(c)
    setProxyInput(getSavedProxyServer() ?? "")
    setTransport(getWispTransport())
    setEngine(readEnginePref()?.id ?? "auto")
    setTheme(readTheme())
    setTitleInput(c.title ?? "")
    setIconInput(c.icon ?? "")
    setPanicUrlInput(c.panicUrl)
  }, [open])

  // Recording a panic key: every key pressed in the next moment joins the combo
  useEffect(() => {
    if (!recording) return
    setRecordingPanicKey(true)
    const keys: string[] = []
    let timer: ReturnType<typeof setTimeout> | null = null
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const key = normalizeKey(event.key)
      if (!keys.includes(key)) keys.push(key)
      timer ??= setTimeout(() => {
        setCloak(writeCloak({ panicKeys: [...keys] }))
        setRecording(false)
        notify(`Panic key: ${describeKeys(keys)}`, "success")
      }, 700)
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      if (timer) clearTimeout(timer)
      setRecordingPanicKey(false)
    }
  }, [recording, notify])

  const saveProxy = async (value: string | null) => {
    try {
      await setProxyServer(value)
      setProxyInput(value?.trim() ?? "")
      notify(`Proxy server: ${getProxyServer()}`, "success")
      onProxyChanged()
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error")
    }
  }

  const changeTransport = async (next: WispTransport) => {
    setTransport(next)
    try {
      await setWispTransport(next)
      notify(next === "epoxy" ? "Transport: Epoxy" : "Transport: libcurl", "success")
      onProxyChanged()
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error")
    }
  }

  const proxyProblem = proxyInput.trim() ? proxyServerProblem(proxyInput.trim()) : null
  const detected = getDetectedBackend()
  const configured = getConfiguredServer()
  const saved = getSavedProxyServer()

  const updateCloak = (patch: Partial<CloakSettings>) => {
    const next = writeCloak(patch)
    setCloak(next)
    applyTabCloak()
    return next
  }

  const applyCustomCloak = () => {
    const icon = iconInput.trim() ? normalizeUrl(iconInput) : null
    if (iconInput.trim() && !icon) {
      notify("The icon needs to be a web address, like https://example.com/favicon.ico", "error")
      return
    }
    updateCloak({ title: titleInput.trim() || null, icon })
    setIconInput(icon ?? "")
    notify("Tab cloak applied", "success")
  }

  const savePanicUrl = () => {
    const url = normalizeUrl(panicUrlInput)
    if (!url) {
      notify("Enter a web address, like classroom.google.com", "error")
      return
    }
    setPanicUrlInput(url)
    updateCloak({ panicUrl: url })
    notify("Panic URL saved", "success")
  }

  const activePreset = CLOAK_PRESETS.find((p) => p.title === cloak.title && p.icon === cloak.icon)?.id

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setRecording(false)
        onOpenChange(next)
      }}
    >
      <DialogContent className="flex max-h-[min(760px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden rounded-2xl border-border bg-toolbar p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings className="size-4 text-primary" /> Settings
          </DialogTitle>
          <DialogDescription className="text-xs">Saved in this browser.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <Section
            icon={<Server />}
            title="Proxy server"
            hint={
              <>
                Pages travel through this server. A Wisp server (<code>wss://…</code>) is fastest and only relays encrypted
                traffic; a Bare server (<code>https://…/bare/</code>) is what Abyss runs, so any Abyss site works too.
                Devon&apos;s own backend (<code>server/</code> in the repo) runs both.
              </>
            }
          >
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!proxyProblem) void saveProxy(proxyInput)
              }}
            >
              <input
                value={proxyInput}
                onChange={(e) => setProxyInput(e.target.value)}
                placeholder={detected ?? configured ?? DEFAULT_PROXY_SERVER}
                className={inputClass}
                spellCheck={false}
                autoComplete="off"
              />
              <Button type="submit" className="h-9 rounded-full px-4" disabled={Boolean(proxyProblem) || proxyInput.trim() === (saved ?? "")}>
                Save
              </Button>
            </form>
            <p className={cn("text-xs", proxyProblem ? "text-destructive" : "text-muted-foreground")}>
              {proxyProblem ??
                (saved
                  ? `Using ${proxyKind(saved) === "bare" ? "the Bare server" : "the Wisp server"} you chose.`
                  : detected
                    ? "Automatic: this site's own backend."
                    : configured
                      ? `Automatic: this site's server (${configured}).`
                      : "Automatic: Mercury Workshop's public demo server, which is rate-limited.")}
              {saved && !proxyProblem && (
                <button type="button" className="ml-1 text-primary underline-offset-2 hover:underline" onClick={() => void saveProxy(null)}>
                  Back to automatic
                </button>
              )}
            </p>
            {proxyKind(getProxyServer()) === "wisp" && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-sm">Transport</span>
                <Select value={transport} onValueChange={(value) => void changeTransport(value as WispTransport)}>
                  <SelectTrigger className="h-8 min-w-40 flex-1 rounded-full bg-omnibox">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="libcurl">libcurl (recommended)</SelectItem>
                    <SelectItem value="epoxy">Epoxy</SelectItem>
                  </SelectContent>
                </Select>
                {transport === "epoxy" && (
                  <p className="w-full text-xs text-muted-foreground">
                    Epoxy can&apos;t open sites that send very large headers over HTTP/2, like YouTube.
                  </p>
                )}
              </div>
            )}
          </Section>

          <Section icon={<Search />} title="Search engine">
            <Select
              value={engine}
              onValueChange={(id) => {
                setEngine(id)
                writeEnginePref(id === "auto" ? null : id)
              }}
            >
              <SelectTrigger className="w-full rounded-full bg-omnibox">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automatic (DuckDuckGo)</SelectItem>
                {CHOOSABLE_ENGINES.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Section>

          <Section icon={<Palette />} title="Theme">
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    applyTheme(t.id)
                    setTheme(t.id)
                  }}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-xl p-2 text-[11px] text-muted-foreground ring-1 ring-transparent hover:bg-white/[0.04]",
                    theme === t.id && "text-foreground ring-primary/60",
                  )}
                  title={t.name}
                >
                  <span className="grid size-8 place-items-center rounded-full ring-1 ring-white/15" style={{ background: t.swatch }}>
                    {theme === t.id && <Check className="size-4 text-white" />}
                  </span>
                  {t.name}
                </button>
              ))}
            </div>
          </Section>

          <Section
            icon={<VenetianMask />}
            title="Tab cloak"
            hint="Shows a different title and icon on Devon's tab."
          >
            <div className="flex flex-wrap gap-1.5">
              {CLOAK_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    updateCloak({ title: p.title, icon: p.icon })
                    setTitleInput(p.title)
                    setIconInput(p.icon)
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1.5 text-xs ring-1 ring-border hover:bg-white/[0.09]",
                    activePreset === p.id && "ring-primary/70",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.icon} alt="" className="size-3.5 object-contain" />
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input value={titleInput} onChange={(e) => setTitleInput(e.target.value)} placeholder="Title" className={inputClass} />
              <input
                value={iconInput}
                onChange={(e) => setIconInput(e.target.value)}
                placeholder="Icon URL"
                className={inputClass}
                spellCheck={false}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="rounded-full px-4" onClick={applyCustomCloak}>
                Apply
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full px-4"
                disabled={!cloak.title && !cloak.icon}
                onClick={() => {
                  updateCloak({ title: null, icon: null })
                  setTitleInput("")
                  setIconInput("")
                }}
              >
                Reset
              </Button>
            </div>
          </Section>

          <Section
            icon={<AppWindow />}
            title="about:blank"
            hint="Opens Devon inside a new about:blank tab, so its address never shows in the address bar or history. This tab then goes to the panic URL."
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                size="sm"
                className="rounded-full px-4"
                onClick={() => {
                  if (!openAboutBlank()) notify("Your browser blocked the new tab. Allow pop-ups for this site and try again.", "error")
                }}
              >
                Open in about:blank
              </Button>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Switch checked={cloak.autoBlank} onCheckedChange={(on) => updateCloak({ autoBlank: on })} />
                Open this way every visit
              </label>
            </div>
          </Section>

          <Section
            icon={<Keyboard />}
            title="Panic key"
            hint="Press it — even while on a page — and the whole tab goes to the panic URL."
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate rounded-full bg-omnibox px-4 py-2 text-sm ring-1 ring-border">
                {recording ? (
                  <span className="text-primary">Press the key or keys now…</span>
                ) : cloak.panicKeys ? (
                  describeKeys(cloak.panicKeys)
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )}
              </span>
              <Button size="sm" className="rounded-full px-4" onClick={() => setRecording((r) => !r)}>
                {recording ? "Cancel" : cloak.panicKeys ? "Change" : "Set key"}
              </Button>
              {cloak.panicKeys && !recording && (
                <Button size="sm" variant="ghost" className="rounded-full px-4" onClick={() => updateCloak({ panicKeys: null })}>
                  Clear
                </Button>
              )}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                savePanicUrl()
              }}
            >
              <input
                value={panicUrlInput}
                onChange={(e) => setPanicUrlInput(e.target.value)}
                placeholder="Panic URL"
                className={inputClass}
                spellCheck={false}
              />
              <Button type="submit" size="sm" className="h-9 rounded-full px-4" disabled={panicUrlInput.trim() === cloak.panicUrl}>
                Save
              </Button>
            </form>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
