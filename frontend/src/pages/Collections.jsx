// export default function Collections() {
//   return <div className="p-4"><h1 className="text-2xl font-bold">Collections</h1><p className="text-slate-500 mt-1">Collections history — coming next</p></div>
// }
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"

const ACTION_COLORS = {
  internal_reminder: "bg-blue-100 text-blue-700",
  formal_notice:     "bg-amber-100 text-amber-700",
  legal_demand:      "bg-orange-100 text-orange-700",
  "3p_collections":  "bg-red-100 text-red-700",
  written_off:       "bg-slate-100 text-slate-500",
}
const OUTCOME_COLORS = {
  recovered: "text-green-600",
  partial:   "text-amber-600",
  written_off:"text-slate-400",
  pending:   "text-blue-500",
}

function fmt(n) {
  if (n == null) return "—"
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `€${(n / 1_000).toFixed(1)}K`
  return `€${Number(n).toFixed(0)}`
}

const ACTION_TYPES = ["all", "internal_reminder", "formal_notice", "legal_demand", "3p_collections", "written_off"]
const OUTCOMES     = ["all", "recovered", "partial", "written_off", "pending"]
const PAGE_SIZE    = 50

// ── Add Action Modal ───────────────────────────────────────────────────────
function AddActionModal({ onClose, onSaved, customers }) {
  const [form, setForm] = useState({
    customer_id: "", invoice_id: "", action_type: "internal_reminder",
    action_date: new Date().toISOString().slice(0, 10),
    action_by: "system", amount_at_risk: "", amount_recovered: "",
    sent_to_3p: false, third_party_agency: "", outcome: "pending", notes: "",
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function save() {
    if (!form.customer_id) { setErr("Customer is required"); return }
    setSaving(true)
    const payload = {
      ...form,
      amount_at_risk:    form.amount_at_risk    ? Number(form.amount_at_risk)    : null,
      amount_recovered:  form.amount_recovered  ? Number(form.amount_recovered)  : null,
      invoice_id:        form.invoice_id || null,
      third_party_agency:form.sent_to_3p ? form.third_party_agency : null,
    }
    axios.post("/api/v1/collections", payload)
      .then(() => { onSaved(); onClose() })
      .catch(e  => { setErr(e.response?.data?.detail || "Save failed"); setSaving(false) })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4">
        <h2 className="text-lg font-bold text-slate-800">Log Collections Action</h2>
        {err && <p className="text-red-500 text-sm">{err}</p>}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-slate-500">Customer *</label>
            <select value={form.customer_id} onChange={e => set("customer_id", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1">
              <option value="">Select customer...</option>
              {customers.map(c => <option key={c.customer_id} value={c.customer_id}>{c.customer_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Action Type</label>
            <select value={form.action_type} onChange={e => set("action_type", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1">
              {ACTION_TYPES.filter(a => a !== "all").map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Action Date</label>
            <input type="date" value={form.action_date} onChange={e => set("action_date", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-slate-500">Amount at Risk (€)</label>
            <input type="number" value={form.amount_at_risk} onChange={e => set("amount_at_risk", e.target.value)}
              placeholder="0.00" className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-slate-500">Amount Recovered (€)</label>
            <input type="number" value={form.amount_recovered} onChange={e => set("amount_recovered", e.target.value)}
              placeholder="0.00" className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-slate-500">Outcome</label>
            <select value={form.outcome} onChange={e => set("outcome", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1">
              {OUTCOMES.filter(o => o !== "all").map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Action By</label>
            <input value={form.action_by} onChange={e => set("action_by", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1" />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={form.sent_to_3p} onChange={e => set("sent_to_3p", e.target.checked)}
              id="3p" className="rounded" />
            <label htmlFor="3p" className="text-sm text-slate-600">Sent to 3P Collections</label>
          </div>
          {form.sent_to_3p && (
            <div className="col-span-2">
              <label className="text-xs text-slate-500">Agency Name</label>
              <input value={form.third_party_agency} onChange={e => set("third_party_agency", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1" />
            </div>
          )}
          <div className="col-span-2">
            <label className="text-xs text-slate-500">Notes</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1 resize-none" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function Collections() {
  const nav = useNavigate()
  const [rows,      setRows]      = useState([])
  const [customers, setCustomers] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [search,    setSearch]    = useState("")
  const [actionFilter, setActionFilter] = useState("all")
  const [outcomeFilter,setOutcomeFilter]= useState("all")
  const [page,      setPage]      = useState(1)
  const [sort,      setSort]      = useState({ col: "action_date", dir: "desc" })

  function load() {
    setLoading(true)
    Promise.all([
      axios.get("/api/v1/collections?limit=500"),
      axios.get("/api/v1/scores/portfolio"),
    ]).then(([col, port]) => {
      setRows(col.data.records || col.data || [])
      setCustomers(port.data.customers || [])
      setLoading(false)
    }).catch(() => { setError("Failed to load collections"); setLoading(false) })
  }

  useEffect(() => { load() }, [])

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
      return (
        (!q || r.customer_name?.toLowerCase().includes(q) || r.action_type?.toLowerCase().includes(q)) &&
        (actionFilter  === "all" || r.action_type === actionFilter) &&
        (outcomeFilter === "all" || r.outcome     === outcomeFilter)
      )
    })
    .sort((a, b) => {
      const av = a[sort.col] ?? "", bv = b[sort.col] ?? ""
      const dir = sort.dir === "asc" ? 1 : -1
      return av < bv ? -dir : av > bv ? dir : 0
    })

  const totalPages   = Math.ceil(filtered.length / PAGE_SIZE)
  const paged        = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalAtRisk  = rows.reduce((s, r) => s + Number(r.amount_at_risk  || 0), 0)
  const totalRecov   = rows.reduce((s, r) => s + Number(r.amount_recovered|| 0), 0)
  const pending3p    = rows.filter(r => r.sent_to_3p && r.outcome === "pending").length

  if (loading) return <div className="p-8 text-slate-400">Loading...</div>
  if (error)   return <div className="p-8 text-red-500">{error}</div>

  return (
    <div className="p-6 space-y-4">
      {showModal && <AddActionModal onClose={() => setShowModal(false)} onSaved={load} customers={customers} />}

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Collections
          <span className="ml-2 text-sm font-normal text-slate-400">{filtered.length} records</span>
        </h1>
        <button onClick={() => setShowModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-1.5 rounded-lg">
          + Log Action
        </button>
      </div>

      {/* summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ["Total Actions",     rows.length,      "text-slate-700"],
          ["Total at Risk",     fmt(totalAtRisk),  "text-red-600"],
          ["Total Recovered",   fmt(totalRecov),   "text-green-600"],
          ["Pending 3P",        pending3p,         "text-orange-600"],
        ].map(([label, val, cls]) => (
          <div key={label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <p className="text-xs text-slate-400 mb-1">{label}</p>
            <p className={`text-xl font-bold ${cls}`}>{val}</p>
          </div>
        ))}
      </div>

      {/* filters */}
      <div className="flex flex-wrap gap-3">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search customer or action..."
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <select value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(1) }}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
          {ACTION_TYPES.map(a => <option key={a} value={a}>{a === "all" ? "All action types" : a}</option>)}
        </select>
        <select value={outcomeFilter} onChange={e => { setOutcomeFilter(e.target.value); setPage(1) }}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
          {OUTCOMES.map(o => <option key={o} value={o}>{o === "all" ? "All outcomes" : o}</option>)}
        </select>
      </div>

      {/* table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
              {[
                ["action_date",   "Date"],
                ["customer_name", "Customer"],
                ["action_type",   "Action"],
                ["amount_at_risk","At Risk"],
                ["amount_recovered","Recovered"],
                ["outcome",       "Outcome"],
                ["sent_to_3p",    "3P"],
                ["action_by",     "By"],
              ].map(([col, label]) => (
                <th key={col} onClick={() => toggleSort(col)}
                  className="px-4 py-2 text-left cursor-pointer hover:text-slate-700 select-none whitespace-nowrap">
                  {label}<SortIcon col={col} />
                </th>
              ))}
              <th className="px-4 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {paged.map(r => (
              <tr key={r.collection_id}
                className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                onClick={() => nav(`/customers/${r.customer_id}`)}>
                <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">{r.action_date}</td>
                <td className="px-4 py-2 font-medium text-slate-800">{r.customer_name}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${ACTION_COLORS[r.action_type] || "bg-slate-100 text-slate-500"}`}>
                    {r.action_type}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-600">{fmt(r.amount_at_risk)}</td>
                <td className="px-4 py-2 text-slate-600">{fmt(r.amount_recovered)}</td>
                <td className={`px-4 py-2 text-xs font-medium capitalize ${OUTCOME_COLORS[r.outcome] || "text-slate-500"}`}>
                  {r.outcome}
                </td>
                <td className="px-4 py-2 text-center">
                  {r.sent_to_3p
                    ? <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Yes</span>
                    : <span className="text-slate-300 text-xs">—</span>}
                </td>
                <td className="px-4 py-2 text-xs text-slate-400">{r.action_by}</td>
                <td className="px-4 py-2 text-xs text-slate-400 max-w-xs truncate">{r.notes || "—"}</td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">No collections records found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">← Prev</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">Next →</button>
          </div>
        </div>
      )}
    </div>
  )
}