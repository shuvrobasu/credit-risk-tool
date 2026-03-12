// export default function TemplateDesigner() {
//   return <div className="p-4"><h1 className="text-2xl font-bold">Template Designer</h1><p className="text-slate-500 mt-1">Rich text editor + token toolbar — coming next</p></div>
// }
import { useEffect, useState, useRef } from "react"
import axios from "axios"

const CATS    = ["all", "strategic", "preferred", "standard", "at_risk"]
const TOKENS  = [
  "{{customer_name}}", "{{invoice_number}}", "{{amount_due}}",
  "{{due_date}}", "{{days_overdue}}", "{{outstanding_balance}}",
  "{{payment_terms}}", "{{company_name}}", "{{invoice_table}}", "{{signature}}",
]

const EMPTY = {
  template_name: "", dunning_step: "", customer_category: "",
  subject_line: "", body_template: "", is_active: true, created_by: "admin",
}

function Badge({ step }) {
  if (!step) return <span className="text-xs bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">Standalone</span>
  const colors = step <= 3 ? "bg-blue-100 text-blue-700" : step <= 6 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
  return <span className={`text-xs px-2 py-0.5 rounded-full ${colors}`}>Step {step}</span>
}

// ── Rich text toolbar ──────────────────────────────────────────────────────
function Toolbar({ textareaRef, onInsert }) {
  function exec(cmd, val = null) {
    const ta  = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end   = ta.selectionEnd
    const sel   = ta.value.slice(start, end)
    let replacement = ""
    if (cmd === "bold")   replacement = `<strong>${sel}</strong>`
    if (cmd === "italic") replacement = `<em>${sel}</em>`
    if (cmd === "ul")     replacement = `<ul>\n  <li>${sel || "Item"}</li>\n</ul>`
    if (cmd === "h2")     replacement = `<h2>${sel}</h2>`
    if (cmd === "hr")     replacement = `<hr/>`
    if (cmd === "br")     replacement = `${sel}<br/>`
    onInsert(start, end, replacement)
  }

  return (
    <div className="flex flex-wrap gap-1 bg-slate-50 border border-slate-200 rounded-t-lg px-2 py-1.5">
      {[
        ["B", "bold",   "font-bold"],
        ["I", "italic", "italic"],
        ["H2","h2",     ""],
        ["—", "hr",     ""],
        ["↵", "br",     ""],
        ["•", "ul",     ""],
      ].map(([lbl, cmd, cls]) => (
        <button key={cmd} type="button" onClick={() => exec(cmd)}
          className={`px-2 py-0.5 text-xs rounded border border-slate-200 hover:bg-white ${cls}`}>
          {lbl}
        </button>
      ))}
      <div className="w-px bg-slate-200 mx-1" />
      {TOKENS.map(tok => (
        <button key={tok} type="button"
          onClick={() => onInsert(textareaRef.current?.selectionStart ?? 0, textareaRef.current?.selectionEnd ?? 0, tok)}
          className="px-2 py-0.5 text-xs rounded border border-slate-200 bg-blue-50 text-blue-700 hover:bg-blue-100 font-mono">
          {tok.replace(/[{}]/g, "")}
        </button>
      ))}
    </div>
  )
}

export default function TemplateDesigner() {
  const [templates, setTemplates] = useState([])
  const [selected,  setSelected]  = useState(null)   // template being edited
  const [form,      setForm]       = useState(EMPTY)
  const [tab,       setTab]        = useState("editor") // editor | preview
  const [preview,   setPreview]    = useState(null)
  const [saving,    setSaving]     = useState(false)
  const [error,     setError]      = useState(null)
  const [success,   setSuccess]    = useState(null)
  const [search,    setSearch]     = useState("")
  const bodyRef = useRef(null)

  function load() {
    axios.get("/api/v1/templates").then(r => setTemplates(r.data || []))
  }
  useEffect(() => { load() }, [])

  function selectTemplate(t) {
    setSelected(t)
    setForm({
      template_name:     t.template_name,
      dunning_step:      t.dunning_step ?? "",
      customer_category: t.customer_category ?? "",
      subject_line:      t.subject_line,
      body_template:     t.body_template,
      is_active:         t.is_active,
      created_by:        t.created_by || "admin",
    })
    setPreview(null)
    setTab("editor")
    setError(null)
    setSuccess(null)
  }

  function newTemplate() {
    setSelected(null)
    setForm(EMPTY)
    setPreview(null)
    setTab("editor")
    setError(null)
    setSuccess(null)
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function insertIntoBody(start, end, text) {
    const cur = form.body_template
    const next = cur.slice(0, start) + text + cur.slice(end)
    set("body_template", next)
    // restore cursor after state update
    setTimeout(() => {
      if (bodyRef.current) {
        bodyRef.current.selectionStart = start + text.length
        bodyRef.current.selectionEnd   = start + text.length
        bodyRef.current.focus()
      }
    }, 0)
  }

  function save() {
    setError(null); setSuccess(null)
    if (!form.template_name.trim()) { setError("Template name is required"); return }
    if (!form.subject_line.trim())  { setError("Subject line is required");  return }
    if (!form.body_template.trim()) { setError("Body is required");           return }
    const payload = {
      ...form,
      dunning_step:      form.dunning_step      ? Number(form.dunning_step)      : null,
      customer_category: form.customer_category || null,
    }
    setSaving(true)
    const req = selected
      ? axios.patch(`/api/v1/templates/${selected.template_id}`, payload)
      : axios.post("/api/v1/templates", payload)
    req.then(r => {
      setSuccess(selected ? "Template updated." : "Template created.")
      setSelected(r.data)
      load()
      setSaving(false)
    }).catch(e => { setError(e.response?.data?.detail || "Save failed"); setSaving(false) })
  }

  function loadPreview() {
    if (!selected) return
    axios.post(`/api/v1/templates/${selected.template_id}/preview`)
      .then(r => { setPreview(r.data); setTab("preview") })
  }

  function deleteTemplate(id) {
    if (!window.confirm("Delete this template?")) return
    axios.delete(`/api/v1/templates/${id}`).then(() => {
      load(); newTemplate()
    })
  }

  const filtered = templates.filter(t => {
    const q = search.toLowerCase()
    return !q || t.template_name.toLowerCase().includes(q)
  })

  return (
    <div className="p-6 h-full">
      <div className="flex gap-5 h-full">

        {/* sidebar — template list */}
        <div className="w-64 flex-shrink-0 space-y-2">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-base font-bold text-slate-800">Templates</h1>
            <button onClick={newTemplate}
              className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg hover:bg-blue-700">
              + New
            </button>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
          <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1">
            {filtered.map(t => (
              <div key={t.template_id}
                onClick={() => selectTemplate(t)}
                className={`rounded-lg px-3 py-2 cursor-pointer border transition-colors ${
                  selected?.template_id === t.template_id
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white border-slate-100 hover:border-blue-200 hover:bg-blue-50"
                }`}>
                <div className="flex items-center justify-between gap-1">
                  <p className={`text-sm font-medium truncate ${selected?.template_id === t.template_id ? "text-white" : "text-slate-700"}`}>
                    {t.template_name}
                  </p>
                  {!t.is_active && <span className="text-xs opacity-60">off</span>}
                </div>
                <div className="flex gap-1 mt-1">
                  <Badge step={t.dunning_step} />
                  {t.customer_category && (
                    <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                      {t.customer_category}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-slate-400 px-2 py-4">No templates yet.</p>
            )}
          </div>
        </div>

        {/* main editor */}
        <div className="flex-1 bg-white rounded-xl border border-slate-100 shadow-sm flex flex-col">
          {/* header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-700">
              {selected ? `Editing: ${selected.template_name}` : "New Template"}
            </p>
            <div className="flex gap-2">
              {selected && (
                <>
                  <button onClick={loadPreview}
                    className="text-xs border border-slate-200 px-3 py-1 rounded-lg hover:bg-slate-50">
                    Preview
                  </button>
                  <button onClick={() => deleteTemplate(selected.template_id)}
                    className="text-xs border border-red-200 text-red-500 px-3 py-1 rounded-lg hover:bg-red-50">
                    Delete
                  </button>
                </>
              )}
              <button onClick={save} disabled={saving}
                className="text-xs bg-blue-600 text-white px-4 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving..." : selected ? "Update" : "Create"}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-5 space-y-4">
            {/* meta fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs text-slate-500 block mb-1">Template Name *</label>
                <input value={form.template_name} onChange={e => set("template_name", e.target.value)}
                  placeholder="e.g. Net30 Post-Due Step 4"
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Dunning Step</label>
                <input type="number" value={form.dunning_step} onChange={e => set("dunning_step", e.target.value)}
                  placeholder="e.g. 4 (blank = standalone)"
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Customer Category</label>
                <select value={form.customer_category} onChange={e => set("customer_category", e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                  {CATS.map(c => <option key={c} value={c === "all" ? "" : c}>{c === "all" ? "All categories" : c}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-500 block mb-1">Subject Line *</label>
                <input value={form.subject_line} onChange={e => set("subject_line", e.target.value)}
                  placeholder="e.g. Payment reminder — {{customer_name}} — {{invoice_number}}"
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 font-mono" />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input type="checkbox" id="is_active" checked={form.is_active}
                  onChange={e => set("is_active", e.target.checked)} className="rounded" />
                <label htmlFor="is_active" className="text-sm text-slate-600">Active</label>
              </div>
            </div>

            {/* tabs */}
            <div className="flex gap-1 border-b border-slate-100">
              {[["editor","Body Editor"],["preview","Preview"]].map(([k,l]) => (
                <button key={k} onClick={() => { if (k === "preview" && !preview) loadPreview(); else setTab(k) }}
                  className={`px-4 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                    tab === k ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                  {l}
                </button>
              ))}
            </div>

            {tab === "editor" && (
              <div>
                <Toolbar textareaRef={bodyRef} onInsert={insertIntoBody} />
                <textarea
                  ref={bodyRef}
                  value={form.body_template}
                  onChange={e => set("body_template", e.target.value)}
                  rows={16}
                  placeholder="Write your email body here using HTML and tokens..."
                  className="w-full border border-slate-200 border-t-0 rounded-b-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300 resize-y"
                />
              </div>
            )}

            {tab === "preview" && preview && (
              <div className="space-y-3">
                <div className="bg-slate-50 rounded-lg px-4 py-2">
                  <p className="text-xs text-slate-400 mb-1">Subject</p>
                  <p className="text-sm font-medium text-slate-700">{preview.preview_subject}</p>
                </div>
                <div className="border border-slate-200 rounded-lg p-4 bg-white">
                  <p className="text-xs text-slate-400 mb-2">Body (dummy data)</p>
                  <div className="prose prose-sm max-w-none text-slate-700"
                    dangerouslySetInnerHTML={{ __html: preview.preview_body }} />
                </div>
                {preview.note && <p className="text-xs text-amber-600">⚠ {preview.note}</p>}
              </div>
            )}

            {tab === "preview" && !preview && !selected && (
              <p className="text-sm text-slate-400 py-4">Save the template first to preview.</p>
            )}

            {error   && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            {success && <p className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">{success}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}