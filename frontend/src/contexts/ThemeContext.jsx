import { createContext, useContext, useEffect, useState } from "react"

const ThemeContext = createContext({})

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(null)

  useEffect(() => {
    fetch("/api/v1/app-settings/theme")
      .then(r => r.json())
      .then(t => {
        // If API returns empty or object without appName, fallback
        if (!t || !t.appName) throw new Error("Empty theme")
        setTheme(t)
        applyTheme(t)
      })
      .catch(() => {
        // fallback defaults
        const defaults = {
          appName: "CreditTool",
          tagline: "Credit Risk & AR Management",
          primaryColor: "#2563eb",
          primaryHover: "#1d4ed8",
          accentColor: "#3b82f6",
          sidebarBg: "#0f172a",
          sidebarText: "#94a3b8",
          sidebarActiveText: "#ffffff",
          sidebarActiveBg: "#1e293b",
          headerBg: "#ffffff",
          bodyBg: "#f8fafc",
          cardBg: "#ffffff",
          cardBorder: "#e2e8f0",
          textPrimary: "#1e293b",
          textSecondary: "#64748b",
          fontFamily: "Inter, system-ui, sans-serif",
          baseFontSize: "14px",
          baseFontColor: "#1e293b",
          borderRadius: "0.5rem", // Sharper default
          greenBand: "#16a34a",
          amberBand: "#d97706",
          redBand: "#dc2626",
        }
        setTheme(defaults)
        applyTheme(defaults)
      })
  }, [])

  function applyTheme(t) {
    if (!t) return
    const root = document.documentElement
    root.style.setProperty("--primary", t.primaryColor || "#2563eb")
    root.style.setProperty("--primary-hover", t.primaryHover || "#1d4ed8")
    root.style.setProperty("--accent", t.accentColor || "#3b82f6")
    root.style.setProperty("--sidebar-bg", t.sidebarBg || "#0f172a")
    root.style.setProperty("--sidebar-text", t.sidebarText || "#94a3b8")
    root.style.setProperty("--sidebar-active-text", t.sidebarActiveText || "#ffffff")
    root.style.setProperty("--sidebar-active-bg", t.sidebarActiveBg || "#1e293b")
    root.style.setProperty("--header-bg", t.headerBg || "#ffffff")
    root.style.setProperty("--body-bg", t.bodyBg || "#f8fafc")
    root.style.setProperty("--card-bg", t.cardBg || "#ffffff")
    root.style.setProperty("--card-border", t.cardBorder || "#e2e8f0")
    root.style.setProperty("--text-primary", t.baseFontColor || t.textPrimary || "#1e293b")
    root.style.setProperty("--text-secondary", t.textSecondary || "#64748b")
    root.style.setProperty("--font-family", t.fontFamily || "Inter, sans-serif")
    root.style.setProperty("--font-size-base", t.baseFontSize || "14px")
    root.style.setProperty("--radius", t.borderRadius || "0.5rem")
    root.style.setProperty("--green-band", t.greenBand)
    root.style.setProperty("--amber-band", t.amberBand)
    root.style.setProperty("--red-band", t.redBand)

    if (t.appName) {
      // Optional: Update document title
      document.title = t.appName + (t.tagline ? ` - ${t.tagline}` : '')
    }

    if (t.fontFamily) {
      document.body.style.fontFamily = t.fontFamily
    }
    if (t.baseFontSize) {
      document.body.style.fontSize = t.baseFontSize
    }
    if (t.baseFontColor) {
       document.body.style.color = t.baseFontColor
    }
  }

  if (!theme) {
    return null
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme: (t) => { setTheme(t); applyTheme(t) } }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
