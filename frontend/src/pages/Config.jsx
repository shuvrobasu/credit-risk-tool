// export default function Config() {
//   return <div className="p-4"><h1 className="text-2xl font-bold">Scoring Config</h1><p className="text-slate-500 mt-1">Weights, bands, ladder mode — coming next</p></div>
// }
import { useEffect, useState } from "react"
import axios from "axios"

const DIM_LABELS = {
  weight_dsi:  "Delinquency Severity (DSI)",
  weight_tar:  "Terms Adherence (TAR)",
  weight_ispv: "Invoice Size vs Velocity (ISPV)",
  weight_cur:  "Credit Utilization (CUR)",
  weight_crh:  "Collection History (CRH)",
  weight_3pc:  "3P Collections (3PC)",
}
const WEIGHT_KEYS = Object.keys(DIM_LABELS)

const DEFAULTS = {
  config_name: "",
  weight_dsi: 0.25, weight_tar: 0.20, weight_ispv: 0.10,
  weight_cur: 0.20, weight_crh: 0.15, weight_3pc:  0.10,
  weight_dnb: 0.15,
  dnb_decay_months: 12, threepc_decay_months: 24,
  default_new_customer_score: 650, min_invoice_threshold: 5,
  crh_rolling_months: 12,
  band_green_floor: 750, band_amber_floor: 500, band_red_floor: 250,
  ladder_assignment_mode: "payment_terms",
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
      {hint && <p className="text-xs text-slate-400 mb-1">{hint}</p>}
      {children}
    </div>
  )
}

function NumInput({ value, onChange, min = 0, max, step = 0.01 }) {
  return (
    <input type="number" value={value} onChange={e => onChange(Number(e.target.value))}
      min={min} max={max} step={step}
      className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
  )
}

export default function Config() {
  const [configs,   setConfigs]   = useState([])
  const [active,    setActive]    = useState(null)
  const [form,      setForm]      = useState(DEFAULTS)
  const [saving,    setSaving]    = useState(false)
  const [activating,setActivating]= useState(false)
  const [error,     setError]     = useState(null)
  const [success,   setSuccess]   = useState(null)
  const [tab,       setTab]       = useState("weights")

  function load() {
    Promise.all([
      axios.get("/api/v1/dunning-config"),
      axios.get("/api/v1/dunning-config/active").catch(() => ({ data: null })),
    ]).then(([all, act]) => {
      setConfigs(all.data || [])
      setActive(act.data)
      if (act.data) setForm({ ...DEFAULTS, ...act.data, config_name: act.data.config_name + " (copy)" })
    })
  }

  useEffect(() => { load() }, [])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  const wSum = Math.round(WEIGHT_KEYS.reduce((s, k) => s + Number(form[k] || 0), 0) * 10000) / 10000
  const wOk  = wSum === 1.0

  function save() {
    setError(null); setSuccess(null)
    if (!form.config_name.trim()) { setError("Config name is required"); return }
    if (!wOk) { setError(`Behavioral weights must sum to 1.0 (currently ${wSum})`); return }
    setSaving(true)
    axios.post("/api/v1/dunning-config", { ...form, ladders: [] })
      .then(() => { setSuccess("Config saved."); load(); setSaving(false) })
      .catch(e  => { setError(e.response?.data?.detail || "Save failed"); setSaving(false) })
  }

  function activate(id) {
    setActivating(true)
    axios.post(`/api/v1/dunning-config/${id}/activate`)
      .then(() => { load(); setActivating(false); setSuccess("Config activated.") })
      .catch(() => setActivating(false))
  }

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-xl font-bold text-slate-800">Scoring Config</h1>

      {/* active config banner */}
      {active && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-green-800">Active: {active.config_name}</p>
            <p className="text-xs text-green-600">Config ID {active.config_id} · Created {active.created_at?.slice(0,10)}</p>
          </div>
          <span className="text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded-full font-medium">ACTIVE</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* editor */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-4">
          <div className="flex gap-1 border-b border-slate-100 pb-3">
            {[["weights","Scoring Weights"],["bands","Risk Bands"],["params","Parameters"]].map(([k,l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-4 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                  tab === k ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
                {l}
              </button>
            ))}
          </div>

          <Field label="Config Name *">
            <input value={form.config_name} onChange={e => set("config_name", e.target.value)}
              placeholder="e.g. Standard v2 — March 2026"
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </Field>

          {tab === "weights" && (
            <div className="space-y-4">
              <p className="text-xs text-slate-400">Behavioral weights must sum to exactly 1.0. D&B weight is separate (blended after).</p>
              {WEIGHT_KEYS.map(k => (
                <div key={k}>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-medium text-slate-600">{DIM_LABELS[k]}</label>
                    <span className="text-xs text-slate-500">{(Number(form[k]) * 100).toFixed(0)}%</span>
                  </div>
                  <input type="range" min={0} max={1} step={0.01}
                    value={form[k]}
                    onChange={e => set(k, Number(e.target.value))}
                    className="w-full accent-blue-600" />
                </div>
              ))}
              <div className={`flex items-center justify-between text-sm font-medium px-3 py-2 rounded-lg ${wOk ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                <span>Behavioral weight sum</span>
                <span>{wSum.toFixed(4)} {wOk ? "✓" : "✗ must equal 1.0"}</span>
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-medium text-slate-600">D&B Blend Weight (DNB)</label>
                  <span className="text-xs text-slate-500">{(Number(form.weight_dnb) * 100).toFixed(0)}%</span>
                </div>
                <input type="range" min={0} max={0.5} step={0.01}
                  value={form.weight_dnb}
                  onChange={e => set("weight_dnb", Number(e.target.value))}
                  className="w-full accent-purple-600" />
                <p className="text-xs text-slate-400 mt-1">Applied after behavioral score. Internal data = {((1 - form.weight_dnb) * 100).toFixed(0)}% of composite.</p>
              </div>
            </div>
          )}

          {tab === "bands" && (
            <div className="space-y-4">
              <p className="text-xs text-slate-400">Floor thresholds for each risk band (0–1000 scale).</p>
              {[
                ["band_green_floor", "GREEN floor", "#16a34a", "≥ this → Green (auto-approve)"],
                ["band_amber_floor", "AMBER floor", "#d97706", "≥ this → Amber (monitor)"],
                ["band_red_floor",   "RED floor",   "#dc2626", "≥ this → Red (restrict)"],
              ].map(([k, label, color, hint]) => (
                <div key={k}>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-medium" style={{ color }}>{label}</label>
                    <span className="text-sm font-bold" style={{ color }}>{form[k]}</span>
                  </div>
                  <input type="range" min={0} max={1000} step={10}
                    value={form[k]} onChange={e => set(k, Number(e.target.value))}
                    style={{ accentColor: color }} className="w-full" />
                  <p className="text-xs text-slate-400">{hint}</p>
                </div>
              ))}
              {/* visual band bar */}
              <div className="mt-2">
                <div className="flex h-4 rounded-full overflow-hidden w-full text-xs">
                  <div style={{ width: `${(1000 - form.band_green_floor) / 10}%`, backgroundColor: "#f1f5f9" }} />
                  <div style={{ width: `${(form.band_green_floor - form.band_amber_floor) / 10}%`, backgroundColor: "#16a34a" }}
                    className="flex items-center justify-center text-white font-bold text-[10px]">G</div>
                  <div style={{ width: `${(form.band_amber_floor - form.band_red_floor) / 10}%`, backgroundColor: "#d97706" }}
                    className="flex items-center justify-center text-white font-bold text-[10px]">A</div>
                  <div style={{ width: `${(form.band_red_floor) / 10}%`, backgroundColor: "#dc2626" }}
                    className="flex items-center justify-center text-white font-bold text-[10px]">R/B</div>
                </div>
                <div className="flex justify-between text-xs text-slate-400 mt-1">
                  <span>0</span><span>{form.band_red_floor}</span><span>{form.band_amber_floor}</span>
                  <span>{form.band_green_floor}</span><span>1000</span>
                </div>
              </div>
            </div>
          )}

          {tab === "params" && (
            <div className="grid grid-cols-2 gap-4">
              {[
                ["dnb_decay_months",           "D&B Decay Months",         1, 60,  1],
                ["threepc_decay_months",        "3PC Decay Months",         1, 60,  1],
                ["default_new_customer_score",  "New Customer Default Score",0,1000,10],
                ["min_invoice_threshold",       "Min Invoices for Full CRH",1, 50,  1],
                ["crh_rolling_months",          "CRH Rolling Window (months)",1,36, 1],
              ].map(([k, label, min, max, step]) => (
                <Field key={k} label={label}>
                  <NumInput value={form[k]} onChange={v => set(k, v)} min={min} max={max} step={step} />
                </Field>
              ))}
              <Field label="Ladder Assignment Mode">
                <select value={form.ladder_assignment_mode}
                  onChange={e => set("ladder_assignment_mode", e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                  {["payment_terms","customer_category","risk_band","custom"].map(m =>
                    <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            </div>
          )}

          {error   && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          {success && <p className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">{success}</p>}

          <div className="flex justify-end pt-2">
            <button onClick={save} disabled={saving || !wOk}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-5 py-2 rounded-lg disabled:opacity-50">
              {saving ? "Saving..." : "Save New Version"}
            </button>
          </div>
        </div>

        {/* version history */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Version History</h2>
          {configs.length === 0 && <p className="text-xs text-slate-400">No configs yet.</p>}
          {configs.map(cfg => (
            <div key={cfg.config_id}
              className={`rounded-lg border p-3 space-y-1 ${cfg.is_active ? "border-green-300 bg-green-50" : "border-slate-100"}`}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700 truncate">{cfg.config_name}</p>
                {cfg.is_active
                  ? <span className="text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded-full">Active</span>
                  : <button onClick={() => activate(cfg.config_id)} disabled={activating}
                      className="text-xs text-blue-500 hover:underline disabled:opacity-50">Activate</button>
                }
              </div>
              <p className="text-xs text-slate-400">ID {cfg.config_id} · {cfg.created_at?.slice(0,10)}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {WEIGHT_KEYS.map(k => (
                  <span key={k} className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                    {k.replace("weight_","").toUpperCase()} {(cfg[k]*100).toFixed(0)}%
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}