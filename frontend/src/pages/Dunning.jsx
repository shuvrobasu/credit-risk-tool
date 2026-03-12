// export default function Dunning() {
//   return <div className="p-4"><h1 className="text-2xl font-bold">Dunning</h1><p className="text-slate-500 mt-1">Dunning log + evaluate — coming next</p></div>
// }
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Brain, Check, X, AlertOctagon, Info } from "lucide-react"
import axios from "axios"

const STEP_COLORS = {
  1: "bg-blue-50 text-blue-600 border-blue-200",
  2: "bg-blue-50 text-blue-600 border-blue-200",
  3: "bg-blue-50 text-blue-600 border-blue-200",
  4: "bg-amber-50 text-amber-600 border-amber-200",
  5: "bg-amber-50 text-amber-700 border-amber-300",
  6: "bg-orange-50 text-orange-700 border-orange-300",
  7: "bg-red-50 text-red-600 border-red-200",
  8: "bg-red-100 text-red-700 border-red-300",
}
const DELIVERY_COLORS = {
  sent:      "text-blue-500",
  delivered: "text-green-600",
  failed:    "text-red-500",
  bounced:   "text-orange-500",
}
const STATUS_COLORS = {
  open:          "bg-blue-100 text-blue-700",
  partial:       "bg-amber-100 text-amber-700",
  paid:          "bg-green-100 text-green-700",
  in_collections:"bg-red-100 text-red-700",
}

function fmt(n) {
  if (n >= 1_000_000) return `€${(n/1e6).toFixed(2)}M`
  if (n >= 1_000)     return `€${(n/1e3).toFixed(1)}K`
  return `€${Number(n).toFixed(0)}`
}

// ── Portfolio Log Tab ──────────────────────────────────────────────────────
function PortfolioLog({ logs, loading, onEvaluate, evaluating }) {
  const nav = useNavigate()
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">{logs.length} recent dunning actions</p>
        <div className="flex gap-2">
          <button onClick={() => onEvaluate(true)}
            className="text-sm border border-blue-300 text-blue-600 px-3 py-1.5 hover:bg-blue-50 disabled:opacity-50"
            disabled={evaluating}>
            {evaluating ? "Running..." : "Dry Run"}
          </button>
          <button onClick={() => onEvaluate(false)}
            className="text-sm bg-blue-600 text-white px-3 py-1.5 hover:bg-blue-700 disabled:opacity-50"
            disabled={evaluating}>
            {evaluating ? "Running..." : "▶ Run Portfolio Dunning"}
          </button>
        </div>
      </div>

      {loading ? <div className="text-slate-400 py-8 text-center">Loading...</div> : (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase text-slate-400">
                {["Sent At", "Customer", "Invoice", "Step", "Via", "DPD at Send", "Delivery", "Template"].map(h => (
                  <th key={h} className="px-4 py-2 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map(r => (
                <tr key={r.dunning_id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => nav(`/customers/${r.customer_id}`)}>
                  <td className="px-4 py-2 text-xs text-slate-400 whitespace-nowrap">{r.sent_at?.slice(0,16).replace("T"," ")}</td>
                  <td className="px-4 py-2 font-medium text-slate-700">{r.customer_name || r.customer_id?.slice(0,8)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{r.invoice_number || r.invoice_id?.slice(0,8)}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STEP_COLORS[r.dunning_step] || "bg-slate-100 text-slate-500"}`}>
                      Step {r.dunning_step}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500 capitalize">{r.sent_via}</td>
                  <td className="px-4 py-2 text-xs font-medium"
                    style={{ color: r.days_past_due_at_send > 30 ? "#dc2626" : r.days_past_due_at_send > 0 ? "#d97706" : "#64748b" }}>
                    {r.days_past_due_at_send != null ? `${r.days_past_due_at_send}d` : "—"}
                  </td>
                  <td className={`px-4 py-2 text-xs font-medium capitalize ${DELIVERY_COLORS[r.delivery_status] || "text-slate-400"}`}>
                    {r.delivery_status}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-400">{r.template_name || "—"}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No dunning actions logged yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Customer Timeline Tab ──────────────────────────────────────────────────
function CustomerTimeline({ customers }) {
  const [selected, setSelected] = useState("")
  const [timeline, setTimeline] = useState(null)
  const [loading,  setLoading]  = useState(false)

  function load(id) {
    if (!id) return
    setLoading(true)
    axios.get(`/api/v1/dunning/log/customer/${id}`)
      .then(r => { setTimeline(r.data); setLoading(false) })
      .catch(() => setLoading(false))
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <select value={selected} onChange={e => { setSelected(e.target.value); load(e.target.value) }}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-72 focus:outline-none">
          <option value="">Select customer...</option>
          {customers.map(c => <option key={c.customer_id} value={c.customer_id}>{c.customer_name}</option>)}
        </select>
        {selected && (
          <button onClick={() => load(selected)}
            className="text-sm text-blue-500 hover:underline">↻ Refresh</button>
        )}
      </div>

      {loading && <div className="text-slate-400 py-4">Loading...</div>}

      {timeline && !loading && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">{timeline.total_entries} dunning entries for <span className="font-medium text-slate-700">{timeline.customer_name}</span></p>
          {timeline.timeline.length === 0
            ? <p className="text-slate-400 text-sm">No dunning history for this customer.</p>
            : timeline.timeline.map(inv => (
              <div key={inv.invoice_id} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="font-mono text-sm font-medium text-slate-700">{inv.invoice_number}</span>
                    <span className="ml-3 text-xs text-slate-400">Due: {inv.due_date}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[inv.status] || "bg-slate-100 text-slate-500"}`}>
                    {inv.status}
                  </span>
                </div>
                {/* step timeline */}
                <div className="flex flex-wrap gap-2">
                  {inv.steps.map((step, i) => (
                    <div key={i} className={`text-xs px-3 py-1.5 rounded-lg border ${STEP_COLORS[step.dunning_step] || "bg-slate-50"}`}>
                      <div className="font-semibold">Step {step.dunning_step}</div>
                      <div className="text-slate-400">{step.sent_at?.slice(0,10)}</div>
                      {step.days_past_due_at_send != null && (
                        <div>{step.days_past_due_at_send}d DPD</div>
                      )}
                      {step.template_name && <div className="truncate max-w-[120px]">{step.template_name}</div>}
                      <div className={`capitalize ${DELIVERY_COLORS[step.delivery_status] || ""}`}>{step.delivery_status}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          }
        </div>
      )}
    </div>
  )
}

function AiWorklist() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const nav = useNavigate()

  function load() {
    setLoading(true)
    axios.get("/api/v1/worklist?status=pending")
      .then(r => { setItems(r.data); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function takeAction(id, action) {
    axios.post(`/api/v1/worklist/${id}/action?action=${action}`)
      .then(() => load())
      .catch(e => alert("Action failed"))
  }

  function clearWorklist() {
    if (!window.confirm("Purge all pending AI strategies? This cannot be undone.")) return
    axios.delete("/api/v1/worklist/clear")
      .then(() => load())
      .catch(() => alert("Clear failed"))
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-purple-50 p-4 rounded-xl border border-purple-100">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white rounded-lg shadow-sm">
            <Brain size={20} className="text-purple-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">AI Strategy Verification</h3>
            <p className="text-xs text-slate-500">The agentic engine has identified these invoices for action. Review and approve to execute.</p>
          </div>
        </div>
        <div className="flex gap-4">
            <button onClick={clearWorklist} className="text-xs font-bold text-rose-500 hover:underline">CLEAR ALL</button>
            <button onClick={load} className="text-xs font-bold text-purple-600 hover:underline">REFRESH WORKLIST</button>
        </div>
      </div>

      {loading ? <div className="text-slate-400 py-8 text-center">Scanning portfolio...</div> : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.work_id} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex items-center justify-between group hover:border-purple-200 transition-all">
              <div className="flex items-center gap-6">
                 <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 font-bold text-xs border border-slate-100">
                    {item.customer_name?.slice(0,2).toUpperCase()}
                 </div>
                 <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-slate-800 cursor-pointer hover:text-blue-600" onClick={() => nav(`/customers/${item.customer_id}`)}>
                        {item.customer_name}
                      </span>
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono uppercase">{item.customer_code}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                       <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase flex items-center gap-1 ${
                          item.suggested_tone === 'urgent' ? 'bg-rose-50 text-rose-600' :
                          item.suggested_tone === 'firm' ? 'bg-orange-50 text-orange-600' :
                          item.suggested_tone === 'collaborative' ? 'bg-emerald-50 text-emerald-600' :
                          'bg-blue-50 text-blue-600'
                       }`}>
                         {item.suggested_tone} Tone
                       </span>
                       <span className="text-[11px] text-slate-400 flex items-center gap-1">
                          <Info size={10} /> {item.reason}
                       </span>
                    </div>
                 </div>
              </div>
              
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                 <button onClick={() => takeAction(item.work_id, 'approve')}
                   className="p-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition-colors" title='Approve & Send'>
                   <Check size={18} />
                 </button>
                 <button onClick={() => takeAction(item.work_id, 'reject')}
                   className="p-2 bg-slate-50 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors" title='Reject Action'>
                   <X size={18} />
                 </button>
                 <button onClick={() => takeAction(item.work_id, 'stop')}
                   className="p-2 bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white transition-colors" title='Stop AI for this Customer'>
                   <AlertOctagon size={18} />
                 </button>
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div className="text-center py-16 border-2 border-dashed border-slate-100 rounded-2xl">
              <Brain size={40} className="mx-auto text-slate-100 mb-3" />
              <p className="text-slate-400 text-sm">No pending AI strategies to review.</p>
              <p className="text-[10px] text-slate-300 uppercase tracking-widest mt-1">Agent is monitoring in background</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function Dunning({ defaultTab = "log" }) {
  const [tab,        setTab]        = useState(defaultTab)
  const [logs,       setLogs]       = useState([])
  const [customers,  setCustomers]  = useState([])
  const [loading,    setLoading]    = useState(true)
  const [evaluating, setEvaluating] = useState(false)
  const [runResult,  setRunResult]  = useState(null)

  // summary stats
  const totalSent     = logs.length
  const failedCount   = logs.filter(l => l.delivery_status === "failed").length
  const step6Plus     = logs.filter(l => l.dunning_step >= 6).length
  const last24h       = logs.filter(l => {
    if (!l.sent_at) return false
    return new Date(l.sent_at) > new Date(Date.now() - 86400000)
  }).length

  useEffect(() => {
    Promise.all([
      axios.get("/api/v1/dunning/log/portfolio?limit=200"),
      axios.get("/api/v1/scores/portfolio"),
    ]).then(([dl, port]) => {
      setLogs(dl.data.entries || [])
      setCustomers(port.data.customers || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  function evaluate(dryRun) {
    setEvaluating(true)
    setRunResult(null)
    axios.post(`/api/v1/dunning/evaluate/portfolio?dry_run=${dryRun}`)
      .then(r => {
        setRunResult({ dry_run: dryRun, ...r.data })
        if (!dryRun) {
          // reload log after real run
          axios.get("/api/v1/dunning/log/portfolio?limit=200")
            .then(r2 => setLogs(r2.data.entries || []))
        }
        setEvaluating(false)
      })
      .catch(e => {
        setRunResult({ error: e.response?.data?.detail || "Run failed" })
        setEvaluating(false)
      })
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold text-slate-800">Dunning</h1>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ["Total Sent",      totalSent,   "text-slate-700"],
          ["Last 24h",        last24h,     "text-blue-600"],
          ["Step 6+",         step6Plus,   "text-red-600"],
          ["Failed Delivery", failedCount, "text-orange-600"],
        ].map(([label, val, cls]) => (
          <div key={label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <p className="text-xs text-slate-400 mb-1">{label}</p>
            <p className={`text-xl font-bold ${cls}`}>{val}</p>
          </div>
        ))}
      </div>

      {/* run result banner */}
      {runResult && (
        <div className={`rounded-lg px-4 py-3 text-sm ${runResult.error ? "bg-red-50 text-red-700 border border-red-200" : "bg-green-50 text-green-700 border border-green-200"}`}>
          {runResult.error
            ? `Error: ${runResult.error}`
            : `${runResult.dry_run ? "Dry run" : "Run"} complete — ${runResult.invoices_evaluated ?? 0} invoices evaluated, ${runResult.actions_taken ?? runResult.actions_logged ?? 0} actions ${runResult.dry_run ? "would be" : ""} logged.`
          }
        </div>
      )}

      {/* tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {[
          ["log", "Portfolio Log"], 
          ["worklist", <span><Brain size={14} className="inline mr-1.5" /> AI Strategy Worklist</span>],
          ["timeline", "Customer Timeline"]
        ].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center ${
              tab === key ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "log"      && <PortfolioLog logs={logs} loading={loading} onEvaluate={evaluate} evaluating={evaluating} />}
      {tab === "worklist" && <AiWorklist />}
      {tab === "timeline" && <CustomerTimeline customers={customers} />}
    </div>
  )
}