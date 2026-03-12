// export default function LadderEditor() {
//   return <div className="p-4"><h1 className="text-2xl font-bold">Ladder Editor</h1><p className="text-slate-500 mt-1">Step ladder GUI — coming next</p></div>
// }
import { useEffect, useState } from "react"
import axios from "axios"

const STEP_TYPES = ["pre_due", "post_due", "escalation", "collections"]
const TYPE_COLORS = {
  pre_due:     "bg-blue-100 text-blue-700",
  post_due:    "bg-amber-100 text-amber-700",
  escalation:  "bg-orange-100 text-orange-700",
  collections: "bg-red-100 text-red-700",
}

const DEFAULT_LADDER = [
  { step_number: 1, trigger_offset: -5, step_label: "Pre-reminder 1",    step_type: "pre_due",    penalty_weight: 0.05, template_id: null },
  { step_number: 2, trigger_offset: -3, step_label: "Pre-reminder 2",    step_type: "pre_due",    penalty_weight: 0.05, template_id: null },
  { step_number: 3, trigger_offset: -1, step_label: "Final pre-reminder",step_type: "pre_due",    penalty_weight: 0.05, template_id: null },
  { step_number: 4, trigger_offset:  1, step_label: "Post-due 1",        step_type: "post_due",   penalty_weight: 0.15, template_id: null },
  { step_number: 5, trigger_offset:  7, step_label: "Post-due 2",        step_type: "post_due",   penalty_weight: 0.20, template_id: null },
  { step_number: 6, trigger_offset: 15, step_label: "Formal notice",     step_type: "post_due",   penalty_weight: 0.25, template_id: null },
  { step_number: 7, trigger_offset: 30, step_label: "Final demand",      step_type: "escalation", penalty_weight: 0.15, template_id: null },
  { step_number: 8, trigger_offset: 45, step_label: "3P collections ref",step_type: "collections",penalty_weight: 0.10, template_id: null },
]

function StepRow({ step, idx, templates, onChange, onDelete }) {
  function set(k, v) { onChange(idx, { ...step, [k]: v }) }
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50">
      <td className="px-3 py-2 text-xs text-slate-400 font-mono w-8">{step.step_number}</td>
      <td className="px-3 py-2">
        <input value={step.step_label} onChange={e => set("step_label", e.target.value)}
          className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300" />
      </td>
      <td className="px-3 py-2">
        <input type="number" value={step.trigger_offset} onChange={e => set("trigger_offset", Number(e.target.value))}
          className="w-20 border border-slate-200 rounded px-2 py-1 text-sm text-center focus:outline-none" />
      </td>
      <td className="px-3 py-2">
        <select value={step.step_type} onChange={e => set("step_type", e.target.value)}
          className="border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none">
          {STEP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td className="px-3 py-2">
        <input type="number" value={step.penalty_weight} onChange={e => set("penalty_weight", Number(e.target.value))}
          min={0} max={1} step={0.01}
          className="w-20 border border-slate-200 rounded px-2 py-1 text-sm text-center focus:outline-none" />
      </td>
      <td className="px-3 py-2">
        <select value={step.template_id || ""} onChange={e => set("template_id", e.target.value || null)}
          className="border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none w-40">
          <option value="">— none —</option>
          {templates.map(t => <option key={t.template_id} value={t.template_id}>{t.template_name}</option>)}
        </select>
      </td>
      <td className="px-3 py-2 text-center">
        <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[step.step_type] || ""}`}>
          {step.trigger_offset >= 0 ? `+${step.trigger_offset}d` : `${step.trigger_offset}d`}
        </span>
      </td>
      <td className="px-3 py-2 text-center">
        <button onClick={() => onDelete(idx)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
      </td>
    </tr>
  )
}

export default function LadderEditor() {
  const [configs,    setConfigs]    = useState([])
  const [configId,   setConfigId]   = useState("")
  const [ladderKey,  setLadderKey]  = useState("Net30")
  const [steps,      setSteps]      = useState(DEFAULT_LADDER)
  const [templates,  setTemplates]  = useState([])
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState(null)
  const [success,    setSuccess]    = useState(null)
  const [existingKeys, setExistingKeys] = useState([])

  useEffect(() => {
    Promise.all([
      axios.get("/api/v1/dunning-config"),
      axios.get("/api/v1/templates"),
    ]).then(([cfg, tmpl]) => {
      setConfigs(cfg.data || [])
      setTemplates(tmpl.data?.templates || tmpl.data || [])
      // default to active config
      const active = (cfg.data || []).find(c => c.is_active)
      if (active) {
        setConfigId(active.config_id)
        const keys = Object.keys(active.ladders || {})
        setExistingKeys(keys)
        if (keys.length > 0) {
          setLadderKey(keys[0])
          setSteps(active.ladders[keys[0]])
        }
      }
    })
  }, [])

  function loadLadder(cfgId, key) {
    const cfg = configs.find(c => c.config_id === Number(cfgId))
    if (!cfg) return
    const keys = Object.keys(cfg.ladders || {})
    setExistingKeys(keys)
    if (cfg.ladders[key]) {
      setSteps(cfg.ladders[key].map((s, i) => ({ ...s, step_number: i + 1 })))
    } else {
      setSteps(DEFAULT_LADDER)
    }
  }

  function onChange(idx, updated) {
    setSteps(s => s.map((r, i) => i === idx ? updated : r))
  }

  function addStep() {
    const last = steps[steps.length - 1]
    setSteps(s => [...s, {
      step_number:    s.length + 1,
      trigger_offset: (last?.trigger_offset || 0) + 7,
      step_label:     `Step ${s.length + 1}`,
      step_type:      "post_due",
      penalty_weight: 0.0,
      template_id:    null,
    }])
  }

  function deleteStep(idx) {
    setSteps(s => s.filter((_, i) => i !== idx).map((r, i) => ({ ...r, step_number: i + 1 })))
  }

  function resetDefault() { setSteps(DEFAULT_LADDER) }

  const wSum   = Math.round(steps.reduce((s, r) => s + Number(r.penalty_weight || 0), 0) * 10000) / 10000
  const wOk    = wSum === 1.0

  function save() {
    setError(null); setSuccess(null)
    if (!configId) { setError("Select a config first"); return }
    if (!ladderKey.trim()) { setError("Ladder key is required"); return }
    if (!wOk) { setError(`Penalty weights must sum to 1.0 (currently ${wSum})`); return }

    setSaving(true)
    const payload = {
      ladder_key: ladderKey,
      steps: steps.map((s, i) => ({ ...s, ladder_key: ladderKey, step_number: i + 1 })),
    }
    axios.post(`/api/v1/dunning-config/${configId}/ladders`, payload)
      .then(() => {
        setSuccess(`Ladder "${ladderKey}" saved to config ${configId}.`)
        setSaving(false)
        // refresh configs
        axios.get("/api/v1/dunning-config").then(r => {
          setConfigs(r.data || [])
          const updated = (r.data || []).find(c => c.config_id === Number(configId))
          if (updated) setExistingKeys(Object.keys(updated.ladders || {}))
        })
      })
      .catch(e => { setError(e.response?.data?.detail || "Save failed"); setSaving(false) })
  }

  function deleteLadder(key) {
    if (!window.confirm(`Delete ladder "${key}"?`)) return
    axios.delete(`/api/v1/dunning-config/${configId}/ladders/${key}`)
      .then(() => {
        setExistingKeys(k => k.filter(x => x !== key))
        if (ladderKey === key) { setLadderKey("Net30"); setSteps(DEFAULT_LADDER) }
        setSuccess(`Ladder "${key}" deleted.`)
      })
  }

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-xl font-bold text-slate-800">Ladder Editor</h1>

      {/* controls row */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-slate-500 block mb-1">Config Version</label>
          <select value={configId}
            onChange={e => { setConfigId(e.target.value); loadLadder(e.target.value, ladderKey) }}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none w-56">
            <option value="">Select config...</option>
            {configs.map(c => (
              <option key={c.config_id} value={c.config_id}>
                {c.config_name} {c.is_active ? "✓" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Ladder Key</label>
          <input value={ladderKey} onChange={e => setLadderKey(e.target.value)}
            placeholder="e.g. Net30, strategic, red..."
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none w-40" />
        </div>
        {existingKeys.length > 0 && (
          <div>
            <label className="text-xs text-slate-500 block mb-1">Load Existing</label>
            <div className="flex gap-1 flex-wrap">
              {existingKeys.map(k => (
                <div key={k} className="flex items-center gap-1">
                  <button onClick={() => { setLadderKey(k); loadLadder(configId, k) }}
                    className={`text-xs px-2 py-1 rounded-lg border ${ladderKey === k ? "bg-blue-600 text-white border-blue-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    {k}
                  </button>
                  <button onClick={() => deleteLadder(k)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* weight sum indicator */}
      <div className={`flex items-center justify-between text-sm font-medium px-4 py-2 rounded-lg ${wOk ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
        <span>Penalty weight sum</span>
        <span>{wSum.toFixed(4)} {wOk ? "✓" : "✗ must equal 1.0"}</span>
      </div>

      {/* step table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs uppercase text-slate-400">
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Label</th>
              <th className="px-3 py-2 text-left">Offset (days)</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Penalty Wt</th>
              <th className="px-3 py-2 text-left">Template</th>
              <th className="px-3 py-2 text-left">Timing</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s, i) => (
              <StepRow key={i} step={s} idx={i} templates={templates}
                onChange={onChange} onDelete={deleteStep} />
            ))}
          </tbody>
        </table>
      </div>

      {/* visual timeline */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
        <p className="text-xs text-slate-400 uppercase font-semibold mb-3">Step Timeline (relative to due date)</p>
        <div className="flex items-center gap-0 overflow-x-auto pb-2">
          <div className="text-xs text-slate-400 whitespace-nowrap mr-2">Due date →</div>
          {[...steps].sort((a, b) => a.trigger_offset - b.trigger_offset).map((s, i) => (
            <div key={i} className="flex flex-col items-center mx-2 min-w-[60px]">
              <span className={`text-xs px-2 py-1 rounded-lg font-medium mb-1 ${TYPE_COLORS[s.step_type] || "bg-slate-100"}`}>
                {s.trigger_offset >= 0 ? `+${s.trigger_offset}d` : `${s.trigger_offset}d`}
              </span>
              <span className="text-xs text-slate-500 text-center leading-tight">{s.step_label}</span>
            </div>
          ))}
        </div>
      </div>

      {error   && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
      {success && <p className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">{success}</p>}

      <div className="flex justify-between">
        <div className="flex gap-2">
          <button onClick={addStep}
            className="text-sm border border-slate-200 px-4 py-1.5 rounded-lg hover:bg-slate-50">
            + Add Step
          </button>
          <button onClick={resetDefault}
            className="text-sm border border-slate-200 px-4 py-1.5 rounded-lg hover:bg-slate-50 text-slate-500">
            Reset to Default
          </button>
        </div>
        <button onClick={save} disabled={saving || !wOk || !configId}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-5 py-2 rounded-lg disabled:opacity-50">
          {saving ? "Saving..." : "Save Ladder"}
        </button>
      </div>
    </div>
  )
}