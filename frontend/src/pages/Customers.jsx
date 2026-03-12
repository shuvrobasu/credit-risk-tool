// export default function Customers() {
//   return <div className="p-4"><h1 className="text-2xl font-bold">Customers</h1><p className="text-slate-500 mt-1">Customer list — coming next</p></div>
// }

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Upload, History } from "lucide-react"
import axios from "axios"

const BANDS = { green: "#16a34a", amber: "#d97706", red: "#dc2626", black: "#1e1e1e" }

function ScoreBadge({ band, score }) {
  return (
    <span style={{ color: BANDS[band] || "#64748b" }} className="font-bold text-base">
      {score}
    </span>
  )
}

function fmt(n) {
  if (n == null) return "—"
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `€${(n / 1_000).toFixed(1)}K`
  return `€${n.toFixed(0)}`
}

const CATS = ["all", "strategic", "preferred", "standard", "at_risk"]
const BAND_FILTERS = ["all", "green", "amber", "red", "black"]

export default function Customers() {
  const nav = useNavigate()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [search, setSearch]   = useState("")
  const [cat, setCat]         = useState("all")
  const [band, setBand]       = useState("all")
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [sort, setSort]       = useState({ col: "final_score", dir: "asc" })

  const [mappings, setMappings] = useState([])

  useEffect(() => {
    axios.get("/api/v1/scores/portfolio")
      .then(r => { setRows(r.data.customers); setLoading(false) })
      .catch(() => { setError("Failed to load customers"); setLoading(false) })
    
    axios.get("/api/v1/ui-mapping").then(res => setMappings(res.data))
  }, [])

  const getLabel = (field, def) => {
    const m = mappings.find(map => map.page === 'customers' && map.field === field);
    return m ? m.label : def;
  }

  function toggleSort(col) {
    setSort(s => ({ col, dir: s.col === col && s.dir === "asc" ? "desc" : "asc" }))
  }

  function SortIcon({ col }) {
    if (sort.col !== col) return <span className="ml-1 text-slate-300">↕</span>
    return <span className="ml-1">{sort.dir === "asc" ? "↑" : "↓"}</span>
  }

  const filtered = rows
    .filter(r => {
      const q = search.toLowerCase()
      const matchSearch = (!q || r.customer_name.toLowerCase().includes(q) || r.customer_code.toLowerCase().includes(q))
      const matchCat = (cat  === "all" || r.customer_category === cat)
      const matchBand = (band === "all" || r.risk_band === band)
      const matchOverdue = overdueOnly ? r.overdue_balance > 0 : true
      return matchSearch && matchCat && matchBand && matchOverdue
    })
    .sort((a, b) => {
      const v = (x) => x[sort.col] ?? ""
      const asc = sort.dir === "asc" ? 1 : -1
      return v(a) < v(b) ? -asc : v(a) > v(b) ? asc : 0
    })

  if (loading) return <div className="p-8 text-slate-400">Loading...</div>
  if (error)   return <div className="p-8 text-red-500">{error}</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Customers
          <span className="ml-2 text-sm font-normal text-slate-400">{filtered.length} of {rows.length}</span>
        </h1>
        <div className="flex gap-2">
            <button
              onClick={() => nav("/import")}
              className="bg-slate-800 hover:bg-black text-white text-sm px-4 py-1.5 rounded-lg flex items-center gap-2"
            >
              <Upload size={14} /> Import Customers
            </button>
            <button
              onClick={() => nav("/import")}
              className="border border-slate-200 hover:bg-slate-50 text-slate-600 text-sm px-4 py-1.5 rounded-lg"
            >
              View Import History
            </button>
        </div>
      </div>

      {/* filters */}
      <div className="flex flex-wrap gap-3">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name or code..."
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        <select value={cat} onChange={e => setCat(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
          {CATS.map(c => <option key={c} value={c}>{c === "all" ? "All categories" : c}</option>)}
        </select>
        <select value={band} onChange={e => setBand(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
          {BAND_FILTERS.map(b => <option key={b} value={b}>{b === "all" ? "All bands" : b}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600 font-medium cursor-pointer ml-3">
          <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} className="rounded text-blue-600 w-4 h-4 focus:ring-blue-500" />
          Show Overdue Only
        </label>
      </div>

      {/* table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
              {[
                ["customer_code",     getLabel("customer_code", "ERP ID")],
                ["customer_name",     getLabel("customer_name", "Customer")],
                ["customer_category", getLabel("customer_category", "Category")],
                ["final_score",       getLabel("final_score", "Score")],
                ["cur",               getLabel("cur", "Utilization")],
                ["open_ar_balance",   getLabel("open_ar_balance", "Open AR")],
                ["credit_limit",      getLabel("credit_limit", "Credit Limit")],
                ["score_date",        getLabel("score_date", "Score Date")],
              ].map(([col, label]) => (
                <th key={col} onClick={() => toggleSort(col)}
                  className="px-4 py-2 text-left cursor-pointer hover:text-slate-700 select-none whitespace-nowrap">
                  {label}<SortIcon col={col} />
                </th>
              ))}
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.customer_id}
                className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                onClick={() => nav(`/customers/${c.customer_id}`)}>
                <td className="px-4 py-3 font-mono text-sm font-bold text-blue-600 whitespace-nowrap">{c.customer_code}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{c.customer_name}</div>
                </td>
                <td className="px-4 py-2 capitalize text-slate-500 text-xs">{c.customer_category}</td>
                <td className="px-4 py-2"><ScoreBadge band={c.risk_band} score={Math.round(c.final_score)} /></td>
                <td className="px-4 py-2 text-slate-600"
                  style={{ color: c.cur > 1 ? "#dc2626" : c.cur > 0.75 ? "#d97706" : undefined }}>
                  {(c.cur * 100).toFixed(1)}%
                </td>
                <td className="px-4 py-2 text-slate-600">{fmt(c.open_ar_balance)}</td>
                <td className="px-4 py-2 text-slate-600">{fmt(c.credit_limit)}</td>
                <td className="px-4 py-2 text-slate-400 text-xs">{c.score_date}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={e => { e.stopPropagation(); nav(`/customers/${c.customer_id}`) }}
                    className="text-blue-500 hover:underline text-xs">View</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">No customers match filters</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}