// export default function Invoices() {
//   return <div className="p-4"><h1 className="text-2xl font-bold">Invoices</h1><p className="text-slate-500 mt-1">Invoice list — coming next</p></div>
// }

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"

const STATUS_COLORS = {
  open:          "bg-blue-100 text-blue-700",
  partial:       "bg-amber-100 text-amber-700",
  paid:          "bg-green-100 text-green-700",
  written_off:   "bg-slate-100 text-slate-500",
  in_collections:"bg-red-100 text-red-700",
  disputed:      "bg-red-50 text-red-600 border border-red-100",
}

function fmt(n) {
  if (n == null) return "—"
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `€${(n / 1_000).toFixed(1)}K`
  return `€${Number(n).toFixed(0)}`
}

function DpdBadge({ dpd, status }) {
  if (status === "written_off") return <span className="text-slate-300">—</span>
  if (status === "disputed") return <span className="text-red-500 font-bold text-xs whitespace-nowrap">In Dispute</span>
  if (dpd == null) return <span className="text-slate-300">—</span>
  const color = dpd > 60 ? "#dc2626" : dpd > 30 ? "#d97706" : dpd > 0 ? "#f59e0b" : "#16a34a"
  
  let label = ""
  if (status === "paid") {
    label = dpd > 0 ? `Paid ${dpd} days late` : dpd === 0 ? "Paid on time" : `Paid ${Math.abs(dpd)} days early`
  } else {
    label = dpd > 0 ? `${dpd} days late` : dpd === 0 ? "Due today" : `${Math.abs(dpd)} days early`
  }
  
  return <span style={{ color }} className="font-semibold text-xs whitespace-nowrap">{label}</span>
}

const STATUSES = ["all", "open", "partial", "paid", "written_off", "in_collections", "disputed"]
const TERMS    = ["all", "Net30", "Net60", "Net90"]
const PAGE_SIZE = 50

export default function Invoices() {
  const nav = useNavigate()
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [search,  setSearch]  = useState("")
  const [status,  setStatus]  = useState("all")
  const [terms,   setTerms]   = useState("all")
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [page,    setPage]    = useState(1)
  const [sort,    setSort]    = useState({ col: "due_date", dir: "asc" })

  const [mappings, setMappings] = useState([])

  useEffect(() => {
    axios.get("/api/v1/invoices?limit=1000")
      .then(r => { setRows(r.data.invoices || r.data || []); setLoading(false) })
      .catch(() => { setError("Failed to load invoices"); setLoading(false) })

    axios.get("/api/v1/ui-mapping").then(res => setMappings(res.data))
  }, [])

  const getLabel = (field, def) => {
    const m = mappings.find(map => map.page === 'invoices' && map.field === field);
    return m ? m.label : def;
  }

  function toggleSort(col) {
    setSort(s => ({ col, dir: s.col === col && s.dir === "asc" ? "desc" : "asc" }))
  }
  function SortIcon({ col }) {
    if (sort.col !== col) return <span className="ml-1 text-slate-300">↕</span>
    return <span className="ml-1">{sort.dir === "asc" ? "↑" : "↓"}</span>
  }

  const today = new Date().toISOString().slice(0, 10)

  const filtered = rows
    .filter(r => {
      const q = search.toLowerCase()
      return (
        (!q || r.invoice_number?.toLowerCase().includes(q) || r.customer_name?.toLowerCase().includes(q) || r.customer_code?.toLowerCase().includes(q)) &&
        (status === "all" || r.status === status) &&
        (terms  === "all" || r.payment_terms === terms) &&
        (!overdueOnly || (r.status !== "paid" && r.due_date < today))
      )
    })
    .sort((a, b) => {
      const av = a[sort.col] ?? "", bv = b[sort.col] ?? ""
      const dir = sort.dir === "asc" ? 1 : -1
      return av < bv ? -dir : av > bv ? dir : 0
    })

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged      = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // summary stats
  const openRows    = rows.filter(r => ["open","partial"].includes(r.status))
  const overdueRows = rows.filter(r => r.status !== "paid" && r.due_date < today)
  const totalOpen   = openRows.reduce((s, r) => s + Number(r.outstanding_amount || 0), 0)
  const totalOverdue= overdueRows.reduce((s, r) => s + Number(r.outstanding_amount || 0), 0)

  if (loading) return <div className="p-8 text-slate-400">Loading...</div>
  if (error)   return <div className="p-8 text-red-500">{error}</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Invoices
          <span className="ml-2 text-sm font-normal text-slate-400">{filtered.length} of {rows.length}</span>
        </h1>
      </div>

      {/* summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ["Total Invoices",   rows.length,             "text-slate-700"],
          ["Open / Partial",   openRows.length,          "text-blue-600"],
          ["Overdue",          overdueRows.length,       "text-red-600"],
          ["Total Open AR",    fmt(totalOpen),           "text-slate-700"],
        ].map(([label, val, cls]) => (
          <div key={label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <p className="text-xs text-slate-400 mb-1">{label}</p>
            <p className={`text-xl font-bold ${cls}`}>{val}</p>
          </div>
        ))}
      </div>

      {/* filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Invoice #, customer name or code..."
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
          {STATUSES.map(s => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}
        </select>
        <select value={terms} onChange={e => { setTerms(e.target.value); setPage(1) }}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
          {TERMS.map(t => <option key={t} value={t}>{t === "all" ? "All terms" : t}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={overdueOnly} onChange={e => { setOverdueOnly(e.target.checked); setPage(1) }}
            className="rounded" />
          Overdue only
        </label>
      </div>

      {/* table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
              {[
                ["invoice_number",  getLabel("invoice_number", "Invoice #")],
                ["customer_name",   getLabel("customer_name", "Customer")],
                ["invoice_date",    getLabel("invoice_date", "Inv Date")],
                ["payment_terms",   getLabel("payment_terms", "Terms")],
                ["invoice_amount",  getLabel("invoice_amount", "Amount")],
                ["outstanding_amount", getLabel("outstanding_amount", "Outstanding")],
                ["status",          getLabel("status", "Status")],
                ["days_past_due",   getLabel("days_past_due", "Days Late")],
              ].map(([col, label]) => (
                <th key={col} onClick={() => toggleSort(col)}
                  className="px-4 py-2 text-left cursor-pointer hover:text-slate-700 select-none whitespace-nowrap">
                  {label}<SortIcon col={col} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map(inv => (
              <tr key={inv.invoice_id}
                className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                onClick={() => nav(`/customers/${inv.customer_id}`)}>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{inv.invoice_number}</td>
                <td className="px-4 py-2 font-medium text-slate-800">{inv.customer_name || inv.customer_code}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{inv.invoice_date}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{inv.payment_terms}</td>
                <td className="px-4 py-2">{fmt(inv.invoice_amount)}</td>
                <td className="px-4 py-2 font-medium bg-slate-50">{fmt(inv.outstanding_amount)}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[inv.status] || "bg-slate-100 text-slate-500"}`}>
                    {inv.status}
                  </span>
                </td>
                <td className="px-4 py-2"><DpdBadge dpd={inv.days_past_due} status={inv.status} /></td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No invoices match filters</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Page {page} of {totalPages} — {filtered.length} results</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
              className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">← Prev</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
              className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">Next →</button>
          </div>
        </div>
      )}
    </div>
  )
}