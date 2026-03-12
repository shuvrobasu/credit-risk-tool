// export default function CurrencyRates() {
//   return <div className="p-4"><h1 className="text-2xl font-bold">Currency Rates</h1><p className="text-slate-500 mt-1">Exchange rates table — coming next</p></div>
// }

import { useEffect, useState } from "react"
import axios from "axios"

const COMMON_PAIRS = [
  ["EUR","USD"],["EUR","GBP"],["EUR","CHF"],["EUR","JPY"],
  ["USD","EUR"],["USD","GBP"],["GBP","EUR"],["CHF","EUR"],
]

const SOURCES = ["manual", "erp", "feed"]

function Badge({ source }) {
  const colors = { manual: "bg-slate-100 text-slate-500", erp: "bg-blue-100 text-blue-600", feed: "bg-green-100 text-green-600" }
  return <span className={`text-xs px-2 py-0.5 rounded-full ${colors[source] || "bg-slate-100 text-slate-400"}`}>{source}</span>
}

const EMPTY_FORM = { from_currency: "EUR", to_currency: "USD", rate: "", effective_date: new Date().toISOString().slice(0,10), source: "manual" }

export default function CurrencyRates() {
  const [rates,    setRates]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [form,     setForm]     = useState(EMPTY_FORM)
  const [editing,  setEditing]  = useState(null)   // rate_id being edited
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)
  const [success,  setSuccess]  = useState(null)
  const [convert,  setConvert]  = useState({ amount: "", from: "USD", to: "EUR", date: "" })
  const [convResult,setConvResult] = useState(null)
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo,   setFilterTo]   = useState("")

  function load() {
    setLoading(true)
    axios.get("/api/v1/currency")
      .then(r => { setRates(r.data || []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function startEdit(r) {
    setEditing(r.rate_id)
    setForm({ from_currency: r.from_currency, to_currency: r.to_currency, rate: r.rate, effective_date: r.effective_date, source: r.source })
    setError(null); setSuccess(null)
  }

  function cancelEdit() { setEditing(null); setForm(EMPTY_FORM) }

  function save() {
    setError(null); setSuccess(null)
    if (!form.rate || !form.from_currency || !form.to_currency) { setError("All fields required"); return }
    if (form.from_currency.toUpperCase() === form.to_currency.toUpperCase()) { setError("From and To currencies must differ"); return }
    setSaving(true)
    const req = editing
      ? axios.patch(`/api/v1/currency/${editing}`, { rate: Number(form.rate), effective_date: form.effective_date, source: form.source })
      : axios.post("/api/v1/currency", { ...form, from_currency: form.from_currency.toUpperCase(), to_currency: form.to_currency.toUpperCase(), rate: Number(form.rate) })
    req.then(() => { setSuccess(editing ? "Rate updated." : "Rate added."); setEditing(null); setForm(EMPTY_FORM); load(); setSaving(false) })
       .catch(e => { setError(e.response?.data?.detail || "Save failed"); setSaving(false) })
  }

  function deleteRate(id) {
    if (!window.confirm("Delete this rate?")) return
    axios.delete(`/api/v1/currency/${id}`).then(() => { load(); setSuccess("Rate deleted.") })
  }

  function doConvert() {
    if (!convert.amount || !convert.from || !convert.to) return
    setConvResult(null)
    const params = `amount=${convert.amount}&from_currency=${convert.from}&to_currency=${convert.to}${convert.date ? `&as_of_date=${convert.date}` : ""}`
    axios.post(`/api/v1/currency/convert?${params}`)
      .then(r => setConvResult(r.data))
      .catch(e => setConvResult({ error: e.response?.data?.detail || "No rate found" }))
  }

  function setQuickPair(from, to) {
    setForm(f => ({ ...f, from_currency: from, to_currency: to }))
  }

  const filtered = rates.filter(r =>
    (!filterFrom || r.from_currency.includes(filterFrom.toUpperCase())) &&
    (!filterTo   || r.to_currency.includes(filterTo.toUpperCase()))
  )

  // group by pair for latest rate display
  const latestByPair = {}
  rates.forEach(r => {
    const key = `${r.from_currency}→${r.to_currency}`
    if (!latestByPair[key] || r.effective_date > latestByPair[key].effective_date)
      latestByPair[key] = r
  })

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-xl font-bold text-slate-800">Currency Rates</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* left — add/edit form + converter */}
        <div className="space-y-4">

          {/* add/edit form */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-600">{editing ? "Edit Rate" : "Add Rate"}</h2>

            {/* quick pairs */}
            <div>
              <p className="text-xs text-slate-400 mb-1">Quick pairs</p>
              <div className="flex flex-wrap gap-1">
                {COMMON_PAIRS.map(([f, t]) => (
                  <button key={`${f}${t}`} onClick={() => setQuickPair(f, t)}
                    className={`text-xs px-2 py-0.5 rounded border ${form.from_currency === f && form.to_currency === t ? "bg-blue-600 text-white border-blue-600" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                    {f}/{t}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-500">From</label>
                <input value={form.from_currency} onChange={e => set("from_currency", e.target.value.toUpperCase())}
                  maxLength={3} placeholder="EUR"
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1 uppercase focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <label className="text-xs text-slate-500">To</label>
                <input value={form.to_currency} onChange={e => set("to_currency", e.target.value.toUpperCase())}
                  maxLength={3} placeholder="USD"
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1 uppercase focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500">Rate (1 {form.from_currency} = ? {form.to_currency})</label>
              <input type="number" value={form.rate} onChange={e => set("rate", e.target.value)}
                step="0.0001" placeholder="1.0850"
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div>
              <label className="text-xs text-slate-500">Effective Date</label>
              <input type="date" value={form.effective_date} onChange={e => set("effective_date", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-slate-500">Source</label>
              <select value={form.source} onChange={e => set("source", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1 focus:outline-none">
                {SOURCES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>

            {error   && <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded">{error}</p>}
            {success && <p className="text-xs text-green-700 bg-green-50 px-2 py-1.5 rounded">{success}</p>}

            <div className="flex gap-2 pt-1">
              {editing && <button onClick={cancelEdit} className="flex-1 text-sm border border-slate-200 py-1.5 rounded-lg hover:bg-slate-50">Cancel</button>}
              <button onClick={save} disabled={saving}
                className="flex-1 text-sm bg-blue-600 text-white py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving..." : editing ? "Update" : "Add Rate"}
              </button>
            </div>
          </div>

          {/* converter */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-600">Quick Convert</h2>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-500">Amount</label>
                <input type="number" value={convert.amount} onChange={e => setConvert(c => ({ ...c, amount: e.target.value }))}
                  placeholder="10000"
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-slate-500">As of Date</label>
                <input type="date" value={convert.date} onChange={e => setConvert(c => ({ ...c, date: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-slate-500">From</label>
                <input value={convert.from} onChange={e => setConvert(c => ({ ...c, from: e.target.value.toUpperCase() }))}
                  maxLength={3} className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1 uppercase focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-slate-500">To</label>
                <input value={convert.to} onChange={e => setConvert(c => ({ ...c, to: e.target.value.toUpperCase() }))}
                  maxLength={3} className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mt-1 uppercase focus:outline-none" />
              </div>
            </div>
            <button onClick={doConvert}
              className="w-full text-sm bg-slate-700 text-white py-1.5 rounded-lg hover:bg-slate-800">
              Convert
            </button>
            {convResult && (
              convResult.error
                ? <p className="text-xs text-red-600">{convResult.error}</p>
                : <div className="bg-blue-50 rounded-lg px-3 py-2 text-sm">
                    <span className="text-slate-500">{convResult.amount.toLocaleString()} {convResult.from_currency} = </span>
                    <span className="font-bold text-blue-700">{convResult.converted_amount.toLocaleString()} {convResult.to_currency}</span>
                    <p className="text-xs text-slate-400 mt-0.5">Rate: {convResult.rate} · {convResult.effective_date}</p>
                  </div>
            )}
          </div>
        </div>

        {/* right — rates table */}
        <div className="lg:col-span-2 space-y-4">

          {/* latest rates summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(latestByPair).slice(0, 8).map(([pair, r]) => (
              <div key={pair} className="bg-white rounded-xl border border-slate-100 shadow-sm p-3 cursor-pointer hover:border-blue-200"
                onClick={() => startEdit(r)}>
                <p className="text-xs text-slate-400">{pair}</p>
                <p className="text-lg font-bold text-slate-700">{Number(r.rate).toFixed(4)}</p>
                <p className="text-xs text-slate-400">{r.effective_date}</p>
              </div>
            ))}
          </div>

          {/* filters */}
          <div className="flex gap-3">
            <input value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
              placeholder="Filter from (EUR)..."
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-40 focus:outline-none uppercase" />
            <input value={filterTo} onChange={e => setFilterTo(e.target.value)}
              placeholder="Filter to (USD)..."
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-40 focus:outline-none uppercase" />
          </div>

          {/* full table */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase text-slate-400">
                  {["From","To","Rate","Effective Date","Source",""].map(h => (
                    <th key={h} className="px-4 py-2 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading
                  ? <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
                  : filtered.map(r => (
                    <tr key={r.rate_id} className={`border-t border-slate-100 hover:bg-slate-50 ${editing === r.rate_id ? "bg-blue-50" : ""}`}>
                      <td className="px-4 py-2 font-mono font-medium text-slate-700">{r.from_currency}</td>
                      <td className="px-4 py-2 font-mono font-medium text-slate-700">{r.to_currency}</td>
                      <td className="px-4 py-2 font-semibold text-slate-800">{Number(r.rate).toFixed(4)}</td>
                      <td className="px-4 py-2 text-xs text-slate-500">{r.effective_date}</td>
                      <td className="px-4 py-2"><Badge source={r.source} /></td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => startEdit(r)} className="text-xs text-blue-500 hover:underline mr-3">Edit</button>
                        <button onClick={() => deleteRate(r.rate_id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
                      </td>
                    </tr>
                  ))
                }
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No rates found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}