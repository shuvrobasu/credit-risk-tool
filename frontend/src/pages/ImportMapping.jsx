import { useEffect, useState, useRef, useCallback, useLayoutEffect } from "react"
import axios from "axios"
import { Plus, Upload } from "lucide-react"

const SOURCE_TYPES  = ["csv", "excel", "json", "erp_api"]
const TARGET_TABLES = ["customers", "invoices", "payments"]

function ConnectorLine({ sourceId, targetId, container, label, onClick }) {
  const [coords, setCoords] = useState(null)

  useLayoutEffect(() => {
    const update = () => {
      const srcEl = document.getElementById(sourceId)?.querySelector(".port-dot")
      const tgtEl = document.getElementById(targetId)?.querySelector(".port-dot")
      if (!srcEl || !tgtEl || !container) return
      
      const sRect = srcEl.getBoundingClientRect()
      const tRect = tgtEl.getBoundingClientRect()
      const cRect = container.getBoundingClientRect()

      setCoords({
        x1: sRect.left + sRect.width/2 - cRect.left,
        y1: sRect.top + sRect.height/2 - cRect.top,
        x2: tRect.left + tRect.width/2 - cRect.left,
        y2: tRect.top + tRect.height/2 - cRect.top
      })
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [sourceId, targetId, container])

  if (!coords) return null

  const { x1, y1, x2, y2 } = coords
  const path = `M ${x1} ${y1} C ${x1 + (x2-x1)/2} ${y1}, ${x1 + (x2-x1)/2} ${y2}, ${x2} ${y2}`

  return (
    <g className="cursor-pointer group" onClick={onClick}>
      <path d={path} className="connector-line group-hover:stroke-blue-400 group-hover:stroke-[3]" />
      <path d={path} stroke="transparent" strokeWidth="20" fill="none" className="pointer-events-auto" />
      {label && (
        <g transform={`translate(${(x1+x2)/2}, ${(y1+y2)/2})`}>
          <rect x="-30" y="-10" width="60" height="20" rx="10" fill="white" stroke="#e2e8f0" strokeWidth="1" />
          <text textAnchor="middle" dominantBaseline="middle" dy="1" fontSize="9" fontWeight="bold" fill="#64748b">{label}</text>
        </g>
      )}
    </g>
  )
}

function Badge({ label, color }) {
  const colors = {
    green:  "bg-green-100 text-green-700",
    amber:  "bg-amber-100 text-amber-700",
    red:    "bg-red-100 text-red-700",
    blue:   "bg-blue-100 text-blue-700",
    slate:  "bg-slate-100 text-slate-500",
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full ${colors[color] || colors.slate}`}>{label}</span>
}

const EMPTY_PROFILE = { mapping_name: "", source_type: "csv", target_table: "invoices", fields: [] }
const EMPTY_FIELD   = { source_field: "", target_field: "", transform_rule: "", is_required: false, default_value: "" }

export default function ImportMapping() {
  const [profiles,    setProfiles]    = useState([])
  const [selected,    setSelected]    = useState(null)
  const [form,        setForm]        = useState(EMPTY_PROFILE)
  const [targetFields,setTargetFields]= useState({})
  const [transforms,  setTransforms]  = useState([])
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState(null)
  const [success,     setSuccess]     = useState(null)
  const [tab,         setTab]         = useState("mapping")  // mapping | validate | import
  const [validateResult, setValidateResult] = useState(null)
  const [validating,  setValidating]  = useState(false)
  const [importing,   setImporting]   = useState(false)
  const [importResult,setImportResult] = useState(null)
  const [importLog,   setImportLog]   = useState([])
  const [dragOver,    setDragOver]    = useState(false)
  const [importFile,  setImportFile]  = useState(null)
  const fileRef = useRef(null)
  const importFileRef = useRef(null)
  const [sourceFields, setSourceFields] = useState([])
  const [connectingFrom, setConnectingFrom] = useState(null)
  const [connPopover, setConnPopover] = useState(null)
  const designerRef = useRef(null)
  const [newSourceField, setNewSourceField] = useState("")

  function load() {
    Promise.all([
      axios.get("/api/v1/import-mapping"),
      axios.get("/api/v1/import-mapping/targets"),
      axios.get("/api/v1/import-mapping/transforms"),
      axios.get("/api/v1/import-mapping/import-log?limit=10"),
    ]).then(([p, t, tr, il]) => {
      setProfiles(p.data || [])
      setTargetFields(t.data.target_tables || {})
      setTransforms(tr.data.transform_rules || [])
      setImportLog(il.data || [])
    })
  }
  useEffect(() => { load() }, [])

  function selectProfile(p) {
    setSelected(p)
    setForm({ ...p })
    setError(null); setSuccess(null); setValidateResult(null)
  }

  function newProfile() {
    setSelected(null)
    setForm(EMPTY_PROFILE)
    setError(null); setSuccess(null); setValidateResult(null)
  }

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function addField() {
    setForm(f => ({ ...f, fields: [...f.fields, { ...EMPTY_FIELD }] }))
  }

  function updateField(i, k, v) {
    setForm(f => {
      const fields = [...f.fields]
      fields[i] = { ...fields[i], [k]: v }
      return { ...f, fields }
    })
  }

  function removeField(i) {
    setForm(f => ({ ...f, fields: f.fields.filter((_, idx) => idx !== i) }))
  }

  function autoMap() {
    const available = targetFields[form.target_table] || []
    const fields = available.map(tf => ({
      source_field:   tf,
      target_field:   tf,
      transform_rule: "",
      is_required:    ["invoice_number","invoice_date","due_date","invoice_amount",
                       "payment_date","payment_amount","customer_code"].includes(tf),
      default_value:  "",
    }))
    setForm(f => ({ ...f, fields }))
    // also populate sourceFields from the target fields for display
    setSourceFields(available.map(t => t))
  }

  function connectFields(src, tgt) {
    // check if target already connected
    const existing = form.fields.findIndex(f => f.target_field === tgt)
    if (existing >= 0) {
      // update the source of existing mapping
      updateField(existing, "source_field", src)
    } else {
      // create new connection
      setForm(f => ({ ...f, fields: [...f.fields, {
        source_field: src,
        target_field: tgt,
        transform_rule: "",
        is_required: false,
        default_value: "",
      }]}))
    }
    setConnectingFrom(null)
  }

  function disconnectField(tgt) {
    setForm(f => ({ ...f, fields: f.fields.filter(fld => fld.target_field !== tgt) }))
  }

  function addSourceField(name) {
    if (!name.trim()) return
    if (!sourceFields.includes(name.trim())) {
      setSourceFields(sf => [...sf, name.trim()])
    }
    setNewSourceField("")
  }

  function loadSourcesFromFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target.result
      const firstLine = text.split(/\r?\n/)[0]
      if (firstLine) {
        const headers = firstLine.split(/[,;\t]/).map(h => h.replace(/^"|"$/g, "").trim()).filter(Boolean)
        setSourceFields(headers)
      }
    }
    reader.readAsText(file)
  }

  function clickTargetPort(tgt) {
    if (connectingFrom) {
      connectFields(connectingFrom, tgt)
    }
  }

  function clickSourcePort(src) {
    setConnectingFrom(prev => prev === src ? null : src)
  }

  function getConnectionForTarget(tgt) {
    return form.fields.find(f => f.target_field === tgt)
  }

  function save() {
    setError(null); setSuccess(null)
    if (!form.mapping_name.trim()) { setError("Profile name required"); return }
    if (form.fields.length === 0)  { setError("Add at least one field mapping"); return }
    setSaving(true)
    axios.post("/api/v1/import-mapping", form)
      .then(r => {
        setSuccess("Profile saved.")
        load()
        setSelected(r.data)
        setSaving(false)
      })
      .catch(e => { setError(e.response?.data?.detail || "Save failed"); setSaving(false) })
  }

  function deleteProfile(name, table) {
    if (!window.confirm(`Delete profile "${name}"?`)) return
    axios.delete(`/api/v1/import-mapping/profile/${encodeURIComponent(name)}/${table}`)
      .then(() => { load(); newProfile() })
  }

  async function validate() {
    const file = fileRef.current?.files?.[0]
    if (!file)         { setError("Select a file first"); return }
    if (!selected)     { setError("Save the profile first"); return }
    setValidating(true); setValidateResult(null)
    const fd = new FormData()
    fd.append("file", file)
    axios.post(`/api/v1/import-mapping/validate?mapping_name=${encodeURIComponent(selected.mapping_name)}&target_table=${selected.target_table}`, fd)
      .then(r => { setValidateResult(r.data); setValidating(false) })
      .catch(e => { setError(e.response?.data?.detail || "Validation failed"); setValidating(false) })
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer?.files?.[0]
    if (f) setImportFile(f)
  }

  function runImport() {
    const f = importFile || importFileRef.current?.files?.[0]
    if (!f)       { setError("Select a file first"); return }
    if (!selected) { setError("Save the mapping profile first"); return }
    setImporting(true)
    setImportResult(null)
    setError(null)
    const fd = new FormData()
    fd.append("file", f)
    axios.post(`/api/v1/import-mapping/import?mapping_name=${encodeURIComponent(selected.mapping_name)}&target_table=${selected.target_table}`, fd)
      .then(r => {
        setImportResult(r.data)
        setImporting(false)
        // refresh log
        axios.get("/api/v1/import-mapping/import-log?limit=10").then(r2 => setImportLog(r2.data || []))
      })
      .catch(e => {
        setError(e.response?.data?.detail || "Import failed")
        setImporting(false)
      })
  }

  const availableTargets = targetFields[form.target_table] || []

  return (
    <div className="p-6 h-full">
      <div className="flex gap-5">

        {/* sidebar */}
        <div className="w-60 flex-shrink-0 space-y-2">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-base font-bold text-slate-800">Import Mapping</h1>
            <button onClick={newProfile}
              className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg hover:bg-blue-700">+ New</button>
          </div>
          <div className="space-y-1 max-h-[75vh] overflow-y-auto pr-1">
            {profiles.map((p, i) => (
              <div key={i} onClick={() => selectProfile(p)}
                className={`rounded-lg px-3 py-2 cursor-pointer border transition-colors ${
                  selected?.mapping_name === p.mapping_name && selected?.target_table === p.target_table
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white border-slate-100 hover:border-blue-200 hover:bg-blue-50"
                }`}>
                <p className={`text-sm font-medium truncate ${selected?.mapping_name === p.mapping_name ? "text-white" : "text-slate-700"}`}>
                  {p.mapping_name}
                </p>
                <div className="flex gap-1 mt-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${selected?.mapping_name === p.mapping_name ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500"}`}>
                    {p.target_table}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${selected?.mapping_name === p.mapping_name ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500"}`}>
                    {p.source_type}
                  </span>
                </div>
              </div>
            ))}
            {profiles.length === 0 && <p className="text-xs text-slate-400 px-2 py-4">No profiles yet.</p>}
          </div>
        </div>

        {/* main */}
        <div className="flex-1 bg-white rounded-xl border border-slate-100 shadow-sm flex flex-col">
          {/* header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-700">
              {selected ? `Editing: ${selected.mapping_name}` : "New Mapping Profile"}
            </p>
            <div className="flex gap-2">
              {selected && (
                <button onClick={() => deleteProfile(selected.mapping_name, selected.target_table)}
                  className="text-xs border border-red-200 text-red-500 px-3 py-1 rounded-lg hover:bg-red-50">
                  Delete
                </button>
              )}
              <button onClick={save} disabled={saving}
                className="text-xs bg-blue-600 text-white px-4 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving..." : selected ? "Update" : "Create"}
              </button>
            </div>
          </div>

          <div className="p-5 space-y-4 overflow-auto">
            {/* profile meta */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Profile Name *</label>
                <input value={form.mapping_name} onChange={e => setF("mapping_name", e.target.value)}
                  placeholder="e.g. SAP Invoice Export"
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Source Type</label>
                <select value={form.source_type} onChange={e => setF("source_type", e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                  {SOURCE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Target Table</label>
                <select value={form.target_table} onChange={e => setF("target_table", e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                  {TARGET_TABLES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {/* tabs */}
            <div className="flex gap-1 border-b border-slate-100">
              {[["mapping","Field Mappings"],["validate","Validate File"],["import","Upload & Import"]].map(([k,l]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`px-4 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                    tab === k ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                  {l}
                </button>
              ))}
            </div>

            {tab === "mapping" && (
              <div className="space-y-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-4">
                  {/* Controls Bar */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-black uppercase text-slate-400">ERP Profile</label>
                        <select 
                          onChange={(e) => autoMap(e.target.value)}
                          className="text-[11px] bg-white border border-slate-200 rounded px-2 py-1 focus:ring-1 ring-blue-500 outline-none"
                          defaultValue=""
                        >
                          <option value="" disabled>Select Template...</option>
                          <option value="SAP">SAP (KUNNR, BELNR...)</option>
                          <option value="Oracle">Oracle (TRX_NUMBER...)</option>
                          <option value="MS_Dynamics">MS Dynamics (AccountNum...)</option>
                        </select>
                      </div>
                      <button 
                        onClick={() => autoMap()} 
                        className="text-[11px] font-bold text-blue-600 hover:bg-blue-50 px-3 py-1 rounded-lg border border-blue-200 shadow-sm transition-all bg-white"
                      >
                        Smart Auto-Map
                      </button>
                      <button 
                        onClick={() => setF('fields', [])} 
                        className="text-[11px] font-bold text-slate-400 hover:text-red-500 px-2 py-1"
                      >
                        Reset
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <input 
                        type="text" 
                        placeholder="Add manual source..."
                        value={newSourceField}
                        onChange={(e) => setNewSourceField(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addSourceField()}
                        className="text-[11px] border border-slate-200 rounded-lg px-3 py-1.5 w-40 shadow-inner bg-white"
                      />
                      <button onClick={addSourceField} className="p-1.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700">
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-200/50">
                    <button 
                      onClick={() => fileRef.current?.click()}
                      className="text-[11px] text-blue-600 hover:text-blue-700 font-bold flex items-center gap-1"
                    >
                      <Upload size={12} />
                      Load headers from CSV
                      <input type="file" accept=".csv" ref={fileRef} className="hidden" 
                        onChange={e => loadSourcesFromFile(e.target.files?.[0])} />
                    </button>
                    <button onClick={() => setSourceFields([])} className="text-[10px] uppercase font-bold text-slate-400 hover:text-red-500">
                      Clear Sources
                    </button>
                  </div>
                </div>

                {/* VISUAL DESIGNER CANVAS */}
                <div className="mapping-canvas flex justify-between p-8" ref={designerRef}>
                   {/* Connections SVG */}
                   <svg className="absolute inset-0 pointer-events-none w-full h-full">
                      {form.fields.map((f, idx) => {
                        return (
                          <ConnectorLine 
                            key={idx} 
                            idx={idx}
                            sourceId={`src-${f.source_field}`} 
                            targetId={`tgt-${f.target_field}`} 
                            container={designerRef.current}
                            label={f.transform_rule}
                            onClick={(e) => {
                              const crect = designerRef.current.getBoundingClientRect()
                              setConnPopover({
                                index: idx,
                                field: f,
                                x: e.clientX - crect.left,
                                y: e.clientY - crect.top
                              })
                            }}
                          />
                        )
                      })}
                      {/* logic for line while connecting */}
                      {connectingFrom && (
                         <line className="connector-line active" />
                      )}
                   </svg>

                   {/* TARGET PANEL (LEFT) */}
                   <div className="mapping-panel">
                      <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-3 px-2">Target: {form.target_table}</p>
                      <div className="space-y-2">
                        {(targetFields[form.target_table] || []).map(tf => {
                          const mapping = getConnectionForTarget(tf)
                          const isConnected = !!mapping
                          return (
                            <div key={tf} id={`tgt-${tf}`} className={`field-node pl-0 ${isConnected ? 'connected' : ''}`}>
                               <div 
                                 className={`port-dot target ${isConnected ? 'connected' : ''} ${connectingFrom ? 'hover:scale-125 bg-blue-400 active' : ''}`}
                                 onClick={() => clickTargetPort(tf)}
                               />
                               <span className="flex-1 truncate px-2 font-medium">{tf}</span>
                               {isConnected && (
                                  <button onClick={() => disconnectField(tf)} className="text-[10px] text-slate-300 hover:text-red-400 pr-1">✕</button>
                               )}
                               {mapping?.is_required && (
                                  <span className="text-[10px] text-red-400 font-bold pr-2">*</span>
                               )}
                            </div>
                          )
                        })}
                      </div>
                   </div>

                   {/* SOURCE PANEL (RIGHT) */}
                   <div className="mapping-panel">
                      <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-3 px-2">Source Fields (File Headers)</p>
                      <div className="space-y-2">
                        {sourceFields.map(sf => {
                          const isConnected = form.fields.some(f => f.source_field === sf)
                          const isActive = connectingFrom === sf
                          return (
                            <div key={sf} id={`src-${sf}`} className={`field-node pr-0 ${isConnected ? 'connected' : ''} ${isActive ? 'active' : ''}`}>
                               <span className="truncate font-mono text-[11px] font-semibold px-2">{sf}</span>
                               <div 
                                 className={`port-dot source ${isConnected ? 'connected' : ''} ${isActive ? 'active' : ''}`}
                                 onClick={() => clickSourcePort(sf)}
                               />
                            </div>
                          )
                        })}
                        {sourceFields.length === 0 && (
                          <div className="bg-slate-50 border border-slate-100 rounded-lg p-4 text-center">
                            <p className="text-[11px] text-slate-400 italic">No source fields loaded</p>
                            <p className="text-[10px] text-slate-300 mt-1">Upload a file or add manually</p>
                          </div>
                        )}
                      </div>
                   </div>

                   {/* POPOVER */}
                   {connPopover && (
                      <div 
                        className="connection-popover"
                        style={{ left: connPopover.x, top: connPopover.y }}
                      >
                         <div className="flex justify-between items-center mb-3">
                            <p className="text-xs font-bold text-slate-700">Mapping: {connPopover.field.target_field}</p>
                            <button onClick={() => setConnPopover(null)} className="text-slate-400 hover:text-slate-600">✕</button>
                         </div>
                         <div className="space-y-3">
                            <div>
                               <label className="text-[10px] text-slate-400 block mb-1">Transform Rule</label>
                               <select 
                                 value={connPopover.field.transform_rule} 
                                 onChange={e => {
                                   updateField(connPopover.index, "transform_rule", e.target.value)
                                   setConnPopover(prev => ({ ...prev, field: { ...prev.field, transform_rule: e.target.value } }))
                                 }}
                                 className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none"
                               >
                                  <option value="">— none —</option>
                                  {transforms.map(t => <option key={t.rule} value={t.rule}>{t.rule}</option>)}
                               </select>
                            </div>
                            <div>
                               <label className="text-[10px] text-slate-400 block mb-1">Default Value</label>
                               <input 
                                 value={connPopover.field.default_value} 
                                 onChange={e => {
                                   updateField(connPopover.index, "default_value", e.target.value)
                                   setConnPopover(prev => ({ ...prev, field: { ...prev.field, default_value: e.target.value } }))
                                 }}
                                 placeholder="optional"
                                 className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none"
                               />
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer">
                               <input 
                                 type="checkbox" 
                                 checked={connPopover.field.is_required}
                                 onChange={e => {
                                   updateField(connPopover.index, "is_required", e.target.checked)
                                   setConnPopover(prev => ({ ...prev, field: { ...prev.field, is_required: e.target.checked } }))
                                 }}
                               />
                               <span className="text-xs text-slate-600">Mark as Required</span>
                            </label>
                         </div>
                      </div>
                   )}
                </div>

                {/* legend */}
                <div className="flex gap-4 px-2">
                   <div className="flex items-center gap-1.5 border border-slate-100 bg-white px-2 py-1 rounded shadow-sm text-[10px] text-slate-400">
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                      <span>Connected</span>
                   </div>
                   <div className="flex items-center gap-1.5 border border-slate-100 bg-white px-2 py-1 rounded shadow-sm text-[10px] text-slate-400">
                      <span className="w-2 h-2 rounded-full border border-slate-200 bg-slate-100"></span>
                      <span>Unmapped</span>
                   </div>
                   <p className="text-[10px] text-slate-400 italic mt-1">Tip: Click source port, then click target port to link them. Click line to edit transforms.</p>
                </div>
              </div>
            )}

            {tab === "validate" && (
              <div className="space-y-4">
                <p className="text-sm text-slate-500">Upload a sample file to validate against the saved mapping profile.</p>
                <div className="flex gap-3 items-end">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">CSV File</label>
                    <input type="file" accept=".csv" ref={fileRef}
                      className="text-sm text-slate-600 file:mr-3 file:py-1 file:px-3 file:border file:border-slate-200 file:rounded-lg file:text-xs file:bg-white file:hover:bg-slate-50" />
                  </div>
                  <button onClick={validate} disabled={validating || !selected}
                    className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    {validating ? "Validating..." : "Validate"}
                  </button>
                </div>
                {!selected && <p className="text-xs text-amber-600">Save the mapping profile first before validating.</p>}

                {validateResult && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-semibold ${validateResult.valid ? "text-green-600" : "text-red-600"}`}>
                        {validateResult.valid ? "✓ Valid" : "✗ Validation failed"}
                      </span>
                      <span className="text-xs text-slate-400">{validateResult.total_rows} rows · {validateResult.headers_found?.length} headers</span>
                    </div>

                    {validateResult.errors?.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
                        <p className="text-xs font-semibold text-red-700">Errors</p>
                        {validateResult.errors.map((e, i) => <p key={i} className="text-xs text-red-600">• {e}</p>)}
                      </div>
                    )}
                    {validateResult.warnings?.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                        <p className="text-xs font-semibold text-amber-700">Warnings</p>
                        {validateResult.warnings.map((w, i) => <p key={i} className="text-xs text-amber-600">• {w}</p>)}
                      </div>
                    )}

                    <div>
                      <p className="text-xs text-slate-500 mb-2">Headers found</p>
                      <div className="flex flex-wrap gap-1">
                        {validateResult.headers_found?.map(h => (
                          <span key={h} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">{h}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "import" && (
              <div className="space-y-5">
                <p className="text-sm text-slate-500">Upload a CSV or Excel file to import data using the saved mapping profile.</p>

                {/* drag-drop zone */}
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                    dragOver ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/50"
                  }`}
                  onClick={() => importFileRef.current?.click()}
                >
                  <input type="file" accept=".csv,.xlsx" ref={importFileRef} className="hidden"
                    onChange={e => setImportFile(e.target.files?.[0] || null)} />
                  <div className="text-3xl mb-2">📁</div>
                  {importFile
                    ? <p className="text-sm font-medium text-blue-600">{importFile.name} <span className="text-slate-400">({(importFile.size / 1024).toFixed(1)} KB)</span></p>
                    : <p className="text-sm text-slate-400">Drag & drop a file here, or click to browse</p>
                  }
                  <p className="text-xs text-slate-300 mt-1">Supports .csv and .xlsx</p>
                </div>

                <div className="flex gap-3 items-center">
                  <button onClick={runImport} disabled={importing || !selected || !importFile}
                    className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    {importing ? "Importing..." : "▶ Import Data"}
                  </button>
                  {!selected && <span className="text-xs text-amber-600">Select or save a mapping profile first</span>}
                  {selected && <span className="text-xs text-slate-400">Profile: {selected.mapping_name} → {selected.target_table}</span>}
                </div>

                {/* import result */}
                {importResult && (
                  <div className={`rounded-xl p-4 border ${
                    importResult.errors === 0
                      ? "bg-green-50 border-green-200"
                      : "bg-amber-50 border-amber-200"
                  }`}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className={`text-lg font-bold ${importResult.errors === 0 ? "text-green-700" : "text-amber-700"}`}>
                        {importResult.errors === 0 ? "✓ Import Complete" : "⚠ Import Complete with Errors"}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div className="bg-white/60 rounded-lg p-3">
                        <p className="text-xs text-slate-400 mb-1">Total Rows</p>
                        <p className="text-xl font-bold text-slate-700">{importResult.total_rows}</p>
                      </div>
                      <div className="bg-white/60 rounded-lg p-3">
                        <p className="text-xs text-slate-400 mb-1">Imported</p>
                        <p className="text-xl font-bold text-green-600">{importResult.success}</p>
                      </div>
                      <div className="bg-white/60 rounded-lg p-3">
                        <p className="text-xs text-slate-400 mb-1">Errors</p>
                        <p className="text-xl font-bold text-red-600">{importResult.errors}</p>
                      </div>
                    </div>
                    {importResult.error_details?.length > 0 && (
                      <details className="mt-3">
                        <summary className="text-xs text-red-600 cursor-pointer font-medium">View error details ({importResult.error_details.length})</summary>
                        <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                          {importResult.error_details.map((e, i) => (
                            <p key={i} className="text-xs text-red-500 font-mono">• {e}</p>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}

                {/* import history */}
                {importLog.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-400 mb-2 font-semibold uppercase tracking-wider">Recent Imports</p>
                    <div className="bg-white rounded-lg border border-slate-100 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-slate-400 uppercase">
                            <th className="px-3 py-2 text-left">Date</th>
                            <th className="px-3 py-2 text-left">File</th>
                            <th className="px-3 py-2 text-left">Table</th>
                            <th className="px-3 py-2 text-right">Total</th>
                            <th className="px-3 py-2 text-right">OK</th>
                            <th className="px-3 py-2 text-right">Fail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importLog.map(l => (
                            <tr key={l.import_id} className="border-t border-slate-50">
                              <td className="px-3 py-1.5 text-slate-400">{l.imported_at?.slice(0,16).replace("T"," ")}</td>
                              <td className="px-3 py-1.5 text-slate-600 font-medium truncate max-w-[150px]">{l.source}</td>
                              <td className="px-3 py-1.5"><span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{l.import_type}</span></td>
                              <td className="px-3 py-1.5 text-right text-slate-600">{l.total_records}</td>
                              <td className="px-3 py-1.5 text-right text-green-600 font-medium">{l.success_records}</td>
                              <td className="px-3 py-1.5 text-right text-red-500">{l.failed_records || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {error   && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            {success && <p className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">{success}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}