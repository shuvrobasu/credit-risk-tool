// export default function CustomerDetail() {
//   return <div className="p-4"><h1 className="text-2xl font-bold">Customer Detail</h1><p className="text-slate-500 mt-1">Score history, invoices, dunning timeline</p></div>
// }
import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import axios from "axios"
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid
} from "recharts"

const BANDS   = { green: "#16a34a", amber: "#d97706", red: "#dc2626", black: "#1e1e1e" }
const DIM_LABELS = { DSI: "Delinquency Severity", TAR: "Terms Adherence", ISPV: "Size vs Velocity",
                     CUR: "Credit Utilization", CRH: "Collection History", TPC: "3P Collections" }

function fmt(n)   { if (!n) return "€0"; if (n >= 1e6) return `€${(n/1e6).toFixed(2)}M`; if (n >= 1e3) return `€${(n/1e3).toFixed(1)}K`; return `€${n.toFixed(0)}` }
function pct(n)   { return n != null ? `${(n*100).toFixed(1)}%` : "—" }
function badge(band, score) {
  return <span style={{ color: BANDS[band] || "#64748b" }} className="font-black text-2xl">{Math.round(score)}</span>
}

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">{title}</h2>
      {children}
    </div>
  )
}

export default function CustomerDetail() {
  const { id } = useParams()
  const nav    = useNavigate()
  const [score,    setScore]    = useState(null)
  const [history,  setHistory]  = useState([])
  const [invoices, setInvoices] = useState([])
  const [dunningLog, setDunningLog] = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [recomputing, setRecomputing] = useState(false)
  const [stepFilter, setStepFilter] = useState(null)
  const [statusFilter, setStatusFilter] = useState("")
  const [deliveryFilter, setDeliveryFilter] = useState("")
  const [dunningSteps, setDunningSteps] = useState({})
  const [invStatusFilter, setInvStatusFilter] = useState("")

  function load() {
    if (id === 'new') {
      setScore({
        customer: { customer_name: 'New Customer', customer_code: '', customer_category: 'standard' },
        dimensions: {},
        final_score: 500,
        risk_band: 'amber',
        open_ar_balance: 0,
        behavioral_score: 500
      })
      setHistory([])
      setInvoices([])
      setLoading(false)
      return
    }
    
    setLoading(true)
    Promise.all([
      axios.get(`/api/v1/scores/customer/${id}`),
      axios.get(`/api/v1/scores/history/${id}?months=12`),
      axios.get(`/api/v1/invoices?customer_id=${id}&limit=50`),
    ]).then(([s, h, inv]) => {
      setScore(s.data)
      setHistory((h.data.history || []).map(r => ({ ...r, date: r.score_date, score: Math.round(r.business_adjusted_score) })))
      setInvoices(inv.data.invoices || inv.data || [])
      setLoading(false)
    }).catch(() => setLoading(false))

    // fetch dunning log separately — non-blocking
    axios.get(`/api/v1/dunning/log/customer/${id}`)
      .then(dl => setDunningLog(dl.data))
      .catch(() => setDunningLog(null))

    // fetch dunning config step labels
    axios.get("/api/v1/dunning-config/active")
      .then(r => {
        const labels = {}
        const cfg = r.data
        if (cfg && cfg.ladders) {
          Object.values(cfg.ladders).forEach(stepsArr => {
            (stepsArr || []).forEach(s => {
              if (s.step_label) labels[s.step_number] = s.step_label
            })
          })
        }
        setDunningSteps(labels)
      })
      .catch(() => {})
  }

  useEffect(() => { load() }, [id])

  function recompute() {
    setRecomputing(true)
    axios.get(`/api/v1/scores/customer/${id}`)
      .then(() => { load(); setRecomputing(false) })
      .catch(() => setRecomputing(false))
  }

  if (loading) return <div className="p-8 text-slate-400">Loading...</div>
  if (!score)  return <div className="p-8 text-red-500">Failed to load customer score.</div>

  const dims = score.dimensions || {}
  const cust = score.customer   || {}

  return (
    <div className="p-6 space-y-5">
      {/* header */}
      <div className="flex items-start justify-between">
        <div>
          <button onClick={() => nav("/customers")} className="text-xs text-slate-400 hover:text-slate-600 mb-1">← All Customers</button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-800">{cust.customer_name || score.customer_name || "Customer"}</h1>
            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-mono rounded-md border border-slate-200 uppercase">{cust.customer_category || "Standard"}</span>
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm font-mono">
            <div className="text-blue-600 font-bold"><span className="text-slate-400 font-normal">ERP ID:</span> {score.customer_code || cust.customer_code || "N/A"}</div>
            {/* GUID hidden per user request */}
          </div>
        </div>
        <div className="text-right space-y-1">
          {badge(score.risk_band, score.final_score)}
          <div className="text-xs text-slate-400">Score date: {score.score_date}</div>
          <button onClick={recompute} disabled={recomputing}
            className="mt-1 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg disabled:opacity-50">
            {recomputing ? "Computing..." : "↻ Recompute"}
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ["Behavioral Score",  Math.round(score.behavioral_score)],
          ["Open AR",           fmt(score.open_ar_balance)],
          ["Credit Utilization",pct(score.credit_utilization_ratio)],
          ["Terms Adherence",   pct(score.terms_adherence_ratio)],
        ].map(([label, val]) => (
          <div key={label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <p className="text-xs text-slate-400 mb-1">{label}</p>
            <p className="text-xl font-bold text-slate-700">{val}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* dimension breakdown */}
        <Section title="Score Breakdown">
          <div className="space-y-3">
            {Object.entries(dims).map(([key, d]) => {
              if (!d || typeof d.score === "undefined") return null
              const pctW = (d.score / 10)
              return (
                <div key={key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600">{DIM_LABELS[key] || key}</span>
                    <span className="text-slate-500">{Math.round(d.score)} <span className="text-slate-400">× {d.weight} = {Math.round(d.contribution)}</span></span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full"
                      style={{ width: `${pctW}%`, backgroundColor: pctW > 75 ? "#16a34a" : pctW > 50 ? "#d97706" : "#dc2626" }} />
                  </div>
                </div>
              )
            })}
          </div>
          {score.top_risk_drivers?.length > 0 && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-700 mb-1">Top Risk Drivers</p>
              {score.top_risk_drivers.map((d, i) => <p key={i} className="text-xs text-amber-600">• {d}</p>)}
            </div>
          )}
        </Section>

        {/* --- Contact Information Section --- */}
        <Section title="Contact Person (Dunning Engine)">
          <div className="space-y-4">
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
               <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Master Contact (Read-Only)</label>
               <input 
                 readOnly 
                 value={cust.contact_person || "Not specified in master file"} 
                 className="w-full text-sm bg-transparent border-none outline-none font-medium text-slate-600"
               />
               <p className="text-[10px] text-blue-500 mt-1 italic">Note: Overwritten only if override enabled below</p>
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-100">
               <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-700">Manual Override</h3>
                    <p className="text-[10px] text-slate-400">Force dunning to a specific person</p>
                  </div>
                  <button 
                    onClick={() => {
                        const newVal = !cust.use_manual_contact;
                        setScore({...score, customer: {...cust, use_manual_contact: newVal}});
                    }}
                    className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${cust.use_manual_contact ? 'bg-blue-600' : 'bg-slate-200'}`}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${cust.use_manual_contact ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
               </div>

               <div className={`transition-all duration-300 ${cust.use_manual_contact ? 'opacity-100 max-h-40' : 'opacity-40 pointer-events-none max-h-40'}`}>
                  <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Override Contact/Email</label>
                  <input 
                    placeholder="Enter email or contact name..."
                    value={cust.contact_person_manual || ""}
                    onChange={(e) => setScore({...score, customer: {...cust, contact_person_manual: e.target.value}})}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white font-mono"
                  />
               </div>

            </div>

            <div className="space-y-3 pt-4 border-t border-slate-100">
               <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-700">Dunning Exclusion</h3>
                    <p className="text-[10px] text-slate-400 font-medium">For legal requirements or special cases</p>
                  </div>
                  <button 
                    onClick={() => {
                        const newVal = !cust.exclude_from_dunning;
                        setScore({...score, customer: {...cust, exclude_from_dunning: newVal}});
                    }}
                    className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${cust.exclude_from_dunning ? 'bg-rose-600' : 'bg-slate-200'}`}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${cust.exclude_from_dunning ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
               </div>
               {cust.exclude_from_dunning && (
                 <div className="bg-rose-50 border border-rose-100 rounded-lg p-2 flex items-center gap-2">
                   <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></div>
                   <p className="text-[9px] text-rose-600 font-bold uppercase tracking-tight">Automated dunning is disabled for this account</p>
                 </div>
               )}
            </div>

            <div className="space-y-3 pt-4 border-t border-slate-100">
               <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <span className="text-purple-600">★</span> Agentic AI Workflow
                    </h3>
                    <p className="text-[10px] text-slate-400 font-medium">Use AI to determine tone and timing</p>
                  </div>
                  <button 
                    onClick={() => {
                        const newVal = cust.dunning_mode === 'ai' ? 'fixed' : 'ai';
                        setScore({...score, customer: {...cust, dunning_mode: newVal}});
                    }}
                    className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${cust.dunning_mode === 'ai' ? 'bg-purple-600' : 'bg-slate-200'}`}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${cust.dunning_mode === 'ai' ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
               </div>
               {cust.dunning_mode === 'ai' && (
                 <div className="bg-purple-50 border border-purple-100 rounded-lg p-2 flex items-center gap-2">
                   <div className="w-1.5 h-1.5 rounded-full bg-purple-500"></div>
                   <p className="text-[9px] text-purple-600 font-bold uppercase tracking-tight italic">AI Agent is controlling this account's collections</p>
                 </div>
               )}
            </div>

            <div className="pt-2">
               <button 
                onClick={() => {
                    if (id === 'new') {
                        // Handle initial creation
                        axios.post(`/api/v1/customers`, score.customer)
                           .then(r => {
                               alert("Customer created successfully.")
                               nav(`/customers/${r.data.customer_id}`)
                           })
                           .catch(e => alert("Error creating customer: " + e.response?.data?.detail || e.message))
                        return
                    }
                    // Logic to save customer contact changes
                    axios.patch(`/api/v1/customers/${id}`, {
                        contact_person_manual: cust.contact_person_manual,
                        use_manual_contact: cust.use_manual_contact,
                        exclude_from_dunning: cust.exclude_from_dunning,
                        dunning_mode: cust.dunning_mode
                    }).then(() => {
                        alert("Customer settings updated successfully.")
                    }).catch(e => alert("Error saving settings: " + e.message))
                }}
                className="w-full bg-slate-800 text-white text-xs font-bold py-2.5 rounded-lg hover:bg-slate-700 transition-colors mt-2 shadow-sm"
               >
                 {id === 'new' ? 'Create Customer Profile' : 'Save Portfolio Settings'}
               </button>
            </div>
          </div>
        </Section>

        {/* score history chart */}
        <Section title="Score History (12 months)">
          {history.length === 0
            ? <p className="text-sm text-slate-400">No history available.</p>
            : <ResponsiveContainer width="100%" height={220}>
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 1000]} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <ReferenceLine y={750} stroke="#16a34a" strokeDasharray="4 2" label={{ value: "Green", fontSize: 10 }} />
                  <ReferenceLine y={500} stroke="#d97706" strokeDasharray="4 2" label={{ value: "Amber", fontSize: 10 }} />
                  <ReferenceLine y={250} stroke="#dc2626" strokeDasharray="4 2" label={{ value: "Red",   fontSize: 10 }} />
                  <Line type="monotone" dataKey="score" stroke="#3b82f6" dot={{ r: 3 }} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
          }
        </Section>
      </div>

      {/* Dunning Workflow */}
      <Section title="Dunning Workflow">
        {(!dunningLog || !dunningLog.timeline || dunningLog.timeline.length === 0) ? (
          <p className="text-sm text-slate-400">No dunning actions recorded for this customer.</p>
        ) : (() => {
          // flatten all steps from all invoices
          const allEntries = []
          const stepMap = {}
          let maxStep = 0
          dunningLog.timeline.forEach(inv => {
            (inv.steps || []).forEach(s => {
              const sn = s.dunning_step
              if (sn > maxStep) maxStep = sn
              stepMap[sn] = (stepMap[sn] || 0) + 1
              allEntries.push({
                invoice_number: inv.invoice_number,
                due_date: inv.due_date,
                status: inv.status,
                dunning_step: sn,
                delivery_status: s.delivery_status,
                sent_at: s.sent_at,
                days_past_due_at_send: s.days_past_due_at_send,
                template_name: s.template_name,
              })
            })
          })
          const totalSteps = Math.max(maxStep + 1, 6)
          const filtered = allEntries.filter(e => {
            if (stepFilter && e.dunning_step !== stepFilter) return false
            if (statusFilter && e.status !== statusFilter) return false
            if (deliveryFilter && e.delivery_status !== deliveryFilter) return false
            return true
          })

          return (
            <div className="space-y-4">
              {/* horizontal pipeline */}
              <div className="overflow-x-auto pb-2">
                <div className="flex items-center min-w-max px-4">
                  {Array.from({ length: totalSteps }, (_, i) => i + 1).map(stepNum => {
                    const count = stepMap[stepNum] || 0
                    const hasActivity = count > 0
                    const isActive = stepFilter === stepNum
                    const nodeColor = stepNum <= 2 ? "#3b82f6" :
                                      stepNum <= 4 ? "#d97706" :
                                      "#dc2626"

                    return (
                      <div key={stepNum} className="flex items-center">
                        {/* connector before (except first) */}
                        {stepNum > 1 && (
                          <div className="w-16 h-0.5" style={{ backgroundColor: nodeColor, opacity: 0.3 }}></div>
                        )}

                        {/* step node */}
                        <div className="flex flex-col items-center cursor-pointer"
                          onClick={() => setStepFilter(stepFilter === stepNum ? null : stepNum)}>
                          <div className="relative">
                            <div
                              className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-all hover:scale-110"
                              style={{
                                backgroundColor: hasActivity ? nodeColor : "transparent",
                                color: hasActivity ? "#fff" : nodeColor,
                                border: hasActivity ? "none" : `2.5px dashed ${nodeColor}`,
                                boxShadow: isActive ? `0 0 0 3px ${nodeColor}44, 0 0 16px ${nodeColor}40` : hasActivity ? `0 0 16px ${nodeColor}40` : "none",
                                transform: isActive ? "scale(1.15)" : undefined,
                              }}
                            >
                              {stepNum}
                            </div>
                            {/* count badge */}
                            {count > 0 && (
                              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white rounded-full px-1"
                                style={{ backgroundColor: nodeColor }}>
                                {count}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 mt-1.5 text-center leading-tight font-medium whitespace-nowrap">
                            {dunningSteps[stepNum] || `Step ${stepNum}`}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* filter indicator */}
              {stepFilter && (
                <div className="flex items-center gap-2 px-1">
                  <span className="text-xs text-slate-400">Filtered to Step {stepFilter}</span>
                  <button onClick={() => setStepFilter(null)}
                    className="text-xs text-blue-500 hover:underline">Show All</button>
                </div>
              )}

              {/* dunning entries table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase text-slate-400 bg-slate-50">
                      <th className="px-3 py-2 text-left">Invoice #</th>
                      <th className="px-3 py-2 text-left">Due Date</th>
                      <th className="px-3 py-2 text-left">
                        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                          className="text-xs uppercase bg-transparent border-none outline-none cursor-pointer text-slate-400 font-semibold">
                          <option value="">Status ▾</option>
                          <option value="open">Open</option>
                          <option value="partial">Partial</option>
                          <option value="paid">Paid</option>
                        </select>
                      </th>
                      <th className="px-3 py-2 text-left">Step</th>
                      <th className="px-3 py-2 text-left">Sent At</th>
                      <th className="px-3 py-2 text-left">DPD</th>
                      <th className="px-3 py-2 text-left">
                        <select value={deliveryFilter} onChange={e => setDeliveryFilter(e.target.value)}
                          className="text-xs uppercase bg-transparent border-none outline-none cursor-pointer text-slate-400 font-semibold">
                          <option value="">Delivery ▾</option>
                          <option value="delivered">Delivered</option>
                          <option value="sent">Sent</option>
                          <option value="mocked">Mocked</option>
                          <option value="failed">Failed</option>
                          <option value="bounced">Bounced</option>
                        </select>
                      </th>
                      <th className="px-3 py-2 text-left">Template</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((e, i) => {
                      const stepColor = e.dunning_step <= 2 ? "#3b82f6" :
                                        e.dunning_step <= 4 ? "#d97706" :
                                        "#dc2626"
                      const delivered = e.delivery_status === "sent" || e.delivery_status === "delivered" || e.delivery_status === "mocked"
                      return (
                        <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono text-xs font-medium text-slate-700">{e.invoice_number}</td>
                          <td className="px-3 py-2 text-xs text-slate-500">{e.due_date}</td>
                          <td className="px-3 py-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              e.status === "paid"    ? "bg-green-100 text-green-700" :
                              e.status === "partial" ? "bg-amber-100 text-amber-700" :
                              "bg-blue-100 text-blue-700"}`}>{e.status}</span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full text-white"
                              style={{ backgroundColor: stepColor }}>
                              Step {e.dunning_step}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-400">{e.sent_at?.slice(0, 10) || "—"}</td>
                          <td className="px-3 py-2 text-xs text-slate-600 font-semibold">{e.days_past_due_at_send ?? "—"}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${delivered ? "bg-green-500" : "bg-red-400"}`}></span>
                              <span className="text-xs text-slate-500 capitalize">{e.delivery_status}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-400 truncate max-w-[120px]">{e.template_name || "—"}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}
      </Section>

      {/* invoices */}
      <Section title="Invoices">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase text-slate-400 bg-slate-50">
                <th className="px-3 py-2 text-left">Invoice #</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Terms</th>
                <th className="px-3 py-2 text-left">Amount</th>
                <th className="px-3 py-2 text-left">Outstanding</th>
                <th className="px-3 py-2 text-left">
                  <select value={invStatusFilter} onChange={e => setInvStatusFilter(e.target.value)}
                    className="text-xs uppercase bg-transparent border-none outline-none cursor-pointer text-slate-400 font-semibold">
                    <option value="">Status ▾</option>
                    <option value="open">Open</option>
                    <option value="partial">Partial</option>
                    <option value="paid">Paid</option>
                    <option value="written_off">Written Off</option>
                  </select>
                </th>
                <th className="px-3 py-2 text-left">Days Late</th>
              </tr>
            </thead>
            <tbody>
              {invoices.filter(inv => !invStatusFilter || inv.status === invStatusFilter).map(inv => {
                const dpd = inv.days_past_due ?? null
                return (
                  <tr key={inv.invoice_id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{inv.invoice_number}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{inv.invoice_date}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{inv.payment_terms}</td>
                    <td className="px-3 py-2">{fmt(inv.invoice_amount)}</td>
                    <td className="px-3 py-2 font-medium bg-slate-50">{fmt(inv.outstanding_amount)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        inv.status === "paid"    ? "bg-green-100 text-green-700" :
                        inv.status === "partial" ? "bg-amber-100 text-amber-700" :
                        inv.status === "open"    ? "bg-blue-100 text-blue-700"   :
                        "bg-red-100 text-red-700"}`}>{inv.status}</span>
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold whitespace-nowrap"
                      style={{ color: (inv.status === 'written_off') ? "#cbd5e1" : (dpd > 30 ? "#dc2626" : dpd > 0 ? "#d97706" : "#16a34a") }}>
                      {inv.status === 'written_off' ? "—" : (dpd != null ? (
                        inv.status === 'paid' 
                          ? (dpd > 0 ? `Paid ${dpd} days late` : dpd === 0 ? "Paid on time" : `Paid ${Math.abs(dpd)} days early`)
                          : (dpd > 0 ? `${dpd} days late` : dpd === 0 ? "Due today" : `${Math.abs(dpd)} days early`)
                      ) : "—")}
                    </td>
                  </tr>
                )
              })}
              {invoices.filter(inv => !invStatusFilter || inv.status === invStatusFilter).length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No invoices found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}