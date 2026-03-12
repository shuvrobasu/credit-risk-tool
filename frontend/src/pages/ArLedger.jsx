// export default function ArLedger() {
//   return <div className="p-4"><h1 className="text-2xl font-bold">AR Ledger</h1><p className="text-slate-500 mt-1">Account statement generator — coming next</p></div>
// }
import { useEffect, useState } from "react"
import axios from "axios"

const STATUS_COLORS = {
  open:    "bg-blue-100 text-blue-700",
  partial: "bg-amber-100 text-amber-700",
}

function fmt(n, ccy) {
  if (n == null) return "—"
  const sym = ccy === "EUR" ? "€" : ccy === "USD" ? "$" : ccy === "GBP" ? "£" : `${ccy} `
  if (n >= 1_000_000) return `${sym}${(n / 1e6).toFixed(2)}M`
  if (n >= 1_000)     return `${sym}${(n / 1e3).toFixed(1)}K`
  return `${sym}${Number(n).toFixed(2)}`
}

function DpdBadge({ dpd }) {
  if (!dpd) return <span className="text-slate-300 text-xs">Current</span>
  const color = dpd > 90 ? "#7f1d1d" : dpd > 60 ? "#dc2626" : dpd > 30 ? "#d97706" : "#f59e0b"
  const bg    = dpd > 90 ? "#fee2e2" : dpd > 60 ? "#fef2f2" : dpd > 30 ? "#fffbeb" : "#fefce8"
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ color, backgroundColor: bg }}>
      +{dpd}d
    </span>
  )
}

function AgingBar({ invoices }) {
  const buckets = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 }
  invoices.forEach(inv => {
    const d = inv.dpd
    if (!d)      buckets.current += inv.outstanding_amount
    else if (d <= 30)  buckets["1-30"]  += inv.outstanding_amount
    else if (d <= 60)  buckets["31-60"] += inv.outstanding_amount
    else if (d <= 90)  buckets["61-90"] += inv.outstanding_amount
    else               buckets["90+"]   += inv.outstanding_amount
  })
  const total = Object.values(buckets).reduce((a, b) => a + b, 0) || 1
  const colors = { current: "#3b82f6", "1-30": "#f59e0b", "31-60": "#f97316", "61-90": "#ef4444", "90+": "#7f1d1d" }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Aging Breakdown</p>
      <div className="flex h-3 rounded-full overflow-hidden w-full">
        {Object.entries(buckets).map(([k, v]) => v > 0 && (
          <div key={k} style={{ width: `${(v / total) * 100}%`, backgroundColor: colors[k] }}
            title={`${k}: ${fmt(v)}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {Object.entries(buckets).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5 text-xs text-slate-600">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colors[k] }} />
            <span>{k}</span>
            <span className="font-medium text-slate-700">{fmt(v)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ArLedger() {
  const [customers,   setCustomers]   = useState([])
  const [selected,    setSelected]    = useState("")
  const [reportCcy,   setReportCcy]   = useState("EUR")
  const [ledger,      setLedger]      = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [sending,     setSending]     = useState(false)
  const [sendTo,      setSendTo]      = useState("")
  const [sendCc,      setSendCc]      = useState("")
  const [sendResult,  setSendResult]  = useState(null)
  const [showSend,    setShowSend]    = useState(false)
  const [sortCol,     setSortCol]     = useState("due_date")
  const [sortDir,     setSortDir]     = useState("asc")

  useEffect(() => {
    axios.get("/api/v1/scores/portfolio")
      .then(r => setCustomers(r.data.customers || []))
  }, [])

  function load(id, ccy) {
    if (!id) return
    setLoading(true)
    setLedger(null)
    setSendResult(null)
    axios.get(`/api/v1/ar-ledger/customer/${id}?reporting_currency=${ccy || reportCcy}`)
      .then(r => { setLedger(r.data); setLoading(false) })
      .catch(() => setLoading(false))
  }

  function toggleSort(col) {
    setSortDir(d => sortCol === col ? (d === "asc" ? "desc" : "asc") : "asc")
    setSortCol(col)
  }
  function SortIcon({ col }) {
    if (sortCol !== col) return <span className="ml-1 text-slate-300">↕</span>
    return <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
  }

  function sendStatement() {
    if (!sendTo) return
    setSending(true)
    axios.post(`/api/v1/ar-ledger/customer/${selected}/send?to_addresses=${encodeURIComponent(sendTo)}&cc_addresses=${encodeURIComponent(sendCc)}&reporting_currency=${reportCcy}`)
      .then(r => { setSendResult({ ok: true, ...r.data }); setSending(false); setShowSend(false) })
      .catch(e => { setSendResult({ ok: false, error: e.response?.data?.detail || "Send failed" }); setSending(false) })
  }

  const sorted = ledger
    ? [...ledger.invoices].sort((a, b) => {
        const av = a[sortCol] ?? "", bv = b[sortCol] ?? ""
        const dir = sortDir === "asc" ? 1 : -1
        return av < bv ? -dir : av > bv ? dir : 0
      })
    : []

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold text-slate-800">AR Ledger / Account Statement</h1>

      {/* controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-slate-500 block mb-1">Customer</label>
          <select value={selected}
            onChange={e => { setSelected(e.target.value); load(e.target.value, reportCcy) }}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-72 focus:outline-none">
            <option value="">Select customer...</option>
            {customers.map(c => (
              <option key={c.customer_id} value={c.customer_id}>{c.customer_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Reporting Currency</label>
          <select value={reportCcy}
            onChange={e => { setReportCcy(e.target.value); if (selected) load(selected, e.target.value) }}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
            {["EUR", "USD", "GBP", "CHF", "JPY"].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        {ledger && (
          <>
            <button onClick={() => window.open(`/api/v1/ar-ledger/customer/${selected}/pdf?reporting_currency=${reportCcy}`, "_blank")}
              className="text-sm border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50">
              ↓ PDF
            </button>
            <button onClick={() => window.open(`/api/v1/ar-ledger/customer/${selected}/excel?reporting_currency=${reportCcy}`, "_blank")}
              className="text-sm border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50">
              ↓ Excel
            </button>
            <button onClick={() => setShowSend(s => !s)}
              className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">
              ✉ Send Statement
            </button>
          </>
        )}
      </div>

      {/* send panel */}
      {showSend && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-blue-800">Send AR Statement by Email</p>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="text-xs text-slate-500">To *</label>
              <input value={sendTo} onChange={e => setSendTo(e.target.value)}
                placeholder="email@example.com"
                className="block border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1 w-64" />
            </div>
            <div>
              <label className="text-xs text-slate-500">CC</label>
              <input value={sendCc} onChange={e => setSendCc(e.target.value)}
                placeholder="cc@example.com"
                className="block border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1 w-64" />
            </div>
            <div className="flex items-end">
              <button onClick={sendStatement} disabled={sending || !sendTo}
                className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {sendResult && (
        <div className={`rounded-lg px-4 py-2 text-sm ${sendResult.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {sendResult.ok ? `Statement sent to ${sendResult.sent_to}` : `Error: ${sendResult.error}`}
        </div>
      )}

      {loading && <div className="text-slate-400 py-8 text-center">Loading ledger...</div>}

      {ledger && (
        <div className="space-y-4">
          {/* header card */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800">{ledger.customer_name}</h2>
                <p className="text-xs text-slate-400">{ledger.customer_code} · Statement date: {ledger.statement_date}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-slate-800">
                  {fmt(ledger.total_reporting, ledger.reporting_currency)}
                </p>
                <p className="text-xs text-slate-400">Total outstanding ({ledger.reporting_currency})</p>
                {ledger.rate_missing && (
                  <p className="text-xs text-amber-600 mt-1">⚠ Some exchange rates missing</p>
                )}
              </div>
            </div>

            {/* per-currency totals */}
            {Object.keys(ledger.total_by_currency).length > 0 && (
              <div className="flex flex-wrap gap-3">
                {Object.entries(ledger.total_by_currency).map(([ccy, amt]) => (
                  <div key={ccy} className="bg-slate-50 rounded-lg px-3 py-2 text-sm">
                    <span className="text-slate-400 text-xs">{ccy} </span>
                    <span className="font-semibold text-slate-700">{fmt(amt, ccy)}</span>
                  </div>
                ))}
              </div>
            )}

            <AgingBar invoices={ledger.invoices} />
          </div>

          {/* invoice table */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase text-slate-400">
                  {[
                    ["invoice_number",    "Invoice #"],
                    ["invoice_date",      "Inv Date"],
                    ["due_date",          "Due Date"],
                    ["billing_currency",  "Ccy"],
                    ["outstanding_amount","Outstanding"],
                    ["reporting_amount",  `${ledger.reporting_currency} Equiv`],
                    ["dpd",               "DPD"],
                    ["status",            "Status"],
                    ["exchange_rate",     "Rate"],
                  ].map(([col, label]) => (
                    <th key={col} onClick={() => toggleSort(col)}
                      className="px-4 py-2 text-left cursor-pointer hover:text-slate-600 select-none whitespace-nowrap">
                      {label}<SortIcon col={col} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((inv, i) => (
                  <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{inv.invoice_number}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{inv.invoice_date}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{inv.due_date}</td>
                    <td className="px-4 py-2 text-xs text-slate-400">{inv.billing_currency}</td>
                    <td className="px-4 py-2 font-medium">{fmt(inv.outstanding_amount, inv.billing_currency)}</td>
                    <td className="px-4 py-2 text-slate-600">{fmt(inv.reporting_amount, ledger.reporting_currency)}</td>
                    <td className="px-4 py-2"><DpdBadge dpd={inv.dpd} /></td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[inv.status] || "bg-slate-100 text-slate-500"}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-400">
                      {inv.exchange_rate ? inv.exchange_rate.toFixed(4) : "—"}
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">No open invoices</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}