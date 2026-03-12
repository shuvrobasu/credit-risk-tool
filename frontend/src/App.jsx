import { useState, useEffect } from 'react'
import axios from 'axios'
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation, Link } from 'react-router-dom'
import {
  LayoutDashboard, Users, FileText, CreditCard, Bell,
  Settings, List, Mail, DollarSign, Upload, BookOpen, ChevronRight, Send, Palette,
  CheckCircle2, XCircle, Clock, Brain, PieChart
} from 'lucide-react'
import { ThemeProvider, useTheme } from './contexts/ThemeContext.jsx'

import Dashboard from './pages/Dashboard.jsx'
import Customers from './pages/Customers.jsx'
import CustomerDetail from './pages/CustomerDetail.jsx'
import Invoices from './pages/Invoices.jsx'
import Collections from './pages/Collections.jsx'
import Dunning from './pages/Dunning.jsx'
import Config from './pages/Config.jsx'
import LadderEditor from './pages/LadderEditor.jsx'
import TemplateDesigner from './pages/TemplateDesigner.jsx'
import EmailConfig from './pages/EmailConfig.jsx'
import CurrencyRates from './pages/CurrencyRates.jsx'
import ImportMapping from './pages/ImportMapping.jsx'
import ArLedger from './pages/ArLedger.jsx'
import AiChatAssistant from './components/AiChatAssistant.jsx'
import SentEmails from './pages/SentEmails.jsx'
import AppSettings from './pages/AppSettings.jsx'
import Reports from './pages/Reports'

const NAV = [
  { label: '─── Dashboard ───', divider: true },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/reports', label: 'Reports', icon: PieChart },
  { label: '─── Customer ───', divider: true },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/invoices', label: 'Invoices', icon: FileText },
  { to: '/collections', label: 'Collections', icon: CreditCard },
  { to: '/dunning', label: 'Dunning Log', icon: List },
  { to: '/worklist', label: 'AI Worklist', icon: Brain },
  { to: '/ar-ledger', label: 'AR Ledger', icon: BookOpen },
  { label: '─── Email ───', divider: true },
  { to: '/sent-emails', label: 'Sent Emails', icon: Send },
  { label: '─── Dunning ───', divider: true },
  { to: '/ladder', label: 'Ladder Editor', icon: List },
  { to: '/templates', label: 'Templates', icon: FileText },
  { label: '─── Config ───', divider: true },
  { to: '/email', label: 'Email Config', icon: Mail },
  { to: '/currency', label: 'Currency Rates', icon: DollarSign },
  { to: '/import', label: 'Import Mapping', icon: Upload },
  { to: '/config', label: 'Scoring Config', icon: Settings },
  { label: '─── Application ───', divider: true },

  { to: '/settings', label: 'App Settings', icon: Palette },
]

function Sidebar() {
  const { theme } = useTheme()
  const [health, setHealth] = useState([])

  useEffect(() => {
    const fetchHealth = () => {
      axios.get('/api/v1/system-health')
        .then(r => setHealth(r.data))
        .catch(() => { })
    }
    fetchHealth()
    const ival = setInterval(fetchHealth, 10000)
    return () => clearInterval(ival)
  }, [])

  const lastImport = health.find(h => h.key === 'last_import')
  const watcher = health.find(h => h.key === 'folder_watcher')

  return (
    <aside className="w-56 h-screen flex flex-col shrink-0" style={{ background: 'var(--sidebar-bg)', color: 'var(--sidebar-text)' }}>
      <div className="px-5 py-4 border-b border-slate-700">
        <p className="text-xs uppercase tracking-widest" style={{ color: 'var(--sidebar-text)' }}>{theme?.tagline || 'Credit Risk'}</p>
        <p className="text-base font-bold mt-0.5" style={{ color: 'var(--sidebar-active-text)' }}>{theme?.appName || 'CreditTool'}</p>
      </div>
      <nav className="flex-1 overflow-y-auto py-3">
        {NAV.map((item, i) =>
          item.divider ? (
            <p key={i} className="px-5 pt-4 pb-1 text-xs text-slate-500 uppercase tracking-widest">
              {item.label.replace(/─+\s*/g, '').replace(/\s*─+/g, '').trim()}
            </p>
          ) : (
            <NavLink
              key={i}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-5 py-2 text-sm transition-colors ${isActive
                  ? 'bg-blue-600 text-white font-medium'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <item.icon size={15} />
              {item.label}
            </NavLink>
          )
        )}
      </nav>

      {/* System Status Panel */}
      <div className="px-5 py-4 border-t border-slate-700 space-y-3 bg-slate-900/40">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5 flex items-center gap-1.5">
            <Clock size={10} /> System Sync
          </p>
          <div className="flex items-center justify-between group">
            <span className="text-[10px] text-slate-400">Last Import:</span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-mono text-slate-300">
                {lastImport ? new Date(lastImport.last_updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
              </span>
              {lastImport?.status === 'success' ? (
                <CheckCircle2 size={10} className="text-emerald-500" />
              ) : (
                <XCircle size={10} className="text-rose-500" />
              )}
            </div>
          </div>
          {lastImport && (
            <p className="text-[9px] text-slate-500 mt-1 truncate italic" title={lastImport.value}>
              {lastImport.value}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-400">Folder Polling:</span>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${watcher?.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
            {watcher?.status || 'Off'}
          </span>
        </div>
      </div>

      <div className="px-5 py-3 border-t border-slate-700 text-[10px] text-slate-600 font-mono">
        v2.1 — AGENTIC
      </div>
    </aside>
  )
}

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()

  const presets = [
    { label: 'Default', primary: '#2563eb', bg: '#0f172a' },
    { label: 'Slate', primary: '#475569', bg: '#1e293b' },
    { label: 'Emerald', primary: '#059669', bg: '#064e3b' },
    { label: 'Crimson', primary: '#e11d48', bg: '#4c0519' },
  ]

  const applyPreset = (p) => {
    const next = {
      ...theme,
      primaryColor: p.primary,
      sidebarBg: p.bg,
      primaryHover: p.primary + 'ee',
      accentColor: p.primary
    }
    setTheme(next)
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-400 uppercase font-bold mr-1">Theme</span>
      {presets.map(p => (
        <button
          key={p.label}
          onClick={() => applyPreset(p)}
          title={p.label}
          className={`w-4 h-4 rounded-full border-2 transition-transform hover:scale-125 ${theme.primaryColor === p.primary ? 'border-white ring-2 ring-blue-400' : 'border-slate-200'
            }`}
          style={{ backgroundColor: p.primary }}
        />
      ))}
    </div>
  )
}

function Breadcrumbs() {
  const location = useLocation()
  const pathnames = location.pathname.split('/').filter((x) => x)
  const [breadcrumbLabels, setBreadcrumbLabels] = useState({})

  useEffect(() => {
    // If we're on a customer detail page, try to resolve the name/code
    const customerId = pathnames[pathnames.indexOf('customers') + 1]
    if (customerId && customerId !== 'new' && !breadcrumbLabels[customerId]) {
      axios.get(`/api/v1/scores/customer/${customerId}`)
        .then(r => {
          const label = r.data.customer_code || r.data.customer_name || customerId.slice(0, 8)
          setBreadcrumbLabels(prev => ({ ...prev, [customerId]: label }))
        })
        .catch(() => { })
    }
  }, [location.pathname])

  return (
    <nav className="flex items-center gap-2 overflow-x-auto no-scrollbar">
      <Link to="/" className="text-xs font-medium text-slate-400 hover:text-blue-600 transition-colors">Workspace</Link>
      {pathnames.map((name, index) => {
        const routeTo = `/${pathnames.slice(0, index + 1).join('/')}`
        const isLast = index === pathnames.length - 1

        // Resolve label: check breadcrumbLabels first, then format the raw name
        const label = breadcrumbLabels[name] || (name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' '))

        return (
          <div key={name} className="flex items-center gap-2 shrink-0">
            <ChevronRight size={14} className="text-slate-300" />
            {isLast ? (
              <span className="text-xs font-bold text-slate-700 truncate max-w-[200px]">{label}</span>
            ) : (
              <Link to={routeTo} className="text-xs font-medium text-slate-400 hover:text-blue-600 transition-colors uppercase tracking-tight">
                {label}
              </Link>
            )}
          </div>
        )
      })}
    </nav>
  )
}

function Layout({ children }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 bg-white border-b border-slate-100 flex items-center justify-between px-6 shrink-0">
          <Breadcrumbs />
          <ThemeSwitcher />
        </header>
        <main className="flex-1 overflow-auto p-6 relative bg-slate-50/50">
          {children}
          <AiChatAssistant />
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/:id" element={<CustomerDetail />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/collections" element={<Collections />} />
            <Route path="/dunning" element={<Dunning defaultTab="log" />} />
            <Route path="/worklist" element={<Dunning defaultTab="worklist" />} />
            <Route path="/ar-ledger" element={<ArLedger />} />
            <Route path="/config" element={<Config />} />
            <Route path="/ladder" element={<LadderEditor />} />
            <Route path="/templates" element={<TemplateDesigner />} />
            <Route path="/email" element={<EmailConfig />} />
            <Route path="/currency" element={<CurrencyRates />} />
            <Route path="/import" element={<ImportMapping />} />
            <Route path="/sent-emails" element={<SentEmails />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<AppSettings />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </ThemeProvider>
  )
}