import type React from "react"
import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { withBasePath } from "@/lib/base-path"
import { THEME_BOOT_SCRIPT } from "@/lib/themes"
import "./globals.css"

export const metadata: Metadata = {
  title: "Devon Browser",
  description: "A web proxy browser",
  applicationName: "Devon Browser",
  icons: {
    icon: [
      { url: withBasePath("/favicon.ico"), sizes: "any" },
      { url: withBasePath("/icon.svg"), type: "image/svg+xml" },
      { url: withBasePath("/icon-192.png"), type: "image/png", sizes: "192x192" },
    ],
    apple: withBasePath("/apple-icon.png"),
  },
  manifest: withBasePath("/manifest.webmanifest"),
}

export const viewport: Viewport = {
  themeColor: "#15161b",
  colorScheme: "dark",
}

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Applies a saved theme before the first paint (lib/themes.ts) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={`font-sans antialiased ${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  )
}
