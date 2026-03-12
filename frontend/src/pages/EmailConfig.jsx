// export default function EmailConfig() {
//   return <div className="p-4"><h1 className="text-2xl font-bold">Email Config</h1><p className="text-slate-500 mt-1">SMTP settings — coming next</p></div>
// }
import { useEffect, useState, useRef } from "react"
import axios from "axios"

const EMPTY = {
  config_name: "", smtp_host: "", smtp_port: 587, smtp_user: "",
  smtp_password: "", use_tls: true, from_name: "", from_address: "",
  reply_to: "", default_to: "", default_cc: "",
  company_name: "", reporting_currency: "EUR", signature_html: "",
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

function Input({ value, onChange, type = "text", placeholder = "" }) {
  return (
    <input type={type} value={value ?? ""} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
  )
}

export default function EmailConfig() {
  const [configs,    setConfigs]    = useState([])
  const [selected,   setSelected]   = useState(null)
  const [form,       setForm]       = useState(EMPTY)
  const [tab,        setTab]        = useState("smtp")
  const [saving,     setSaving]     = useState(false)
  const [testing,    setTesting]    = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [error,      setError]      = useState(null)
  const [success,    setSuccess]    = useState(null)
  const sigRef = useRef(null)

  function load() {
    axios.get("/api/v1/email-config").then(r => {
      setConfigs(r.data || [])
      const active = (r.data || []).find(c => c.is_active)
      if (active && !selected) {
        setSelected(active)
        setForm({ ...EMPTY, ...active, smtp_password: "" })
      }
    })
  }

  useEffect(() => { load() }, [])

  function selectConfig(c) {
    setSelected(c)
    setForm({ ...EMPTY, ...c, smtp_password: "" })
    setError(null); setSuccess(null); setTestResult(null)
  }

  function newConfig() {
    setSelected(null)
    setForm(EMPTY)
    setError(null); setSuccess(null); setTestResult(null)
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function save() {
    setError(null); setSuccess(null)
    if (!form.config_name.trim())  { setError("Config name is required");   return }
    if (!form.smtp_host.trim())    { setError("SMTP host is required");      return }
    if (!form.from_address.trim()) { setError("From address is required");   return }
    if (!form.company_name.trim()) { setError("Company name is required");   return }

    const payload = { ...form, smtp_port: Number(form.smtp_port) }
    // don't send blank password on update
    if (selected && !payload.smtp_password) delete payload.smtp_password

    setSaving(true)
    const req = selected
      ? axios.patch(`/api/v1/email-config/${selected.email_config_id}`, payload)
      : axios.post("/api/v1/email-config", payload)
    req.then(r => {
      setSuccess(selected ? "Config updated." : "Config created.")
      setSelected(r.data)
      load(); setSaving(false)
    }).catch(e => { setError(e.response?.data?.detail || "Save failed"); setSaving(false) })
  }

  function activate(id) {
    axios.post(`/api/v1/email-config/${id}/activate`)
      .then(() => { load(); setSuccess("Config activated.") })
  }

  function testSmtp() {
    if (!selected) return
    setTesting(true); setTestResult(null)
    axios.post(`/api/v1/email-config/${selected.email_config_id}/test`)
      .then(r => { setTestResult({ ok: true, ...r.data }); setTesting(false) })
      .catch(e => { setTestResult({ ok: false, error: e.response?.data?.detail || "Test failed" }); setTesting(false) })
  }

  function insertSig(tag) {
    const ta = sigRef.current
    if (!ta) return
    const s = ta.selectionStart, e = ta.selectionEnd
    const cur = form.signature_html
    const next = cur.slice(0, s) + tag + cur.slice(e)
    set("signature_html", next)
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = s + tag.length
      ta.focus()
    }, 0)
  }

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-xl font-bold text-slate-800">Email Config</h1>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">

        {/* sidebar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-slate-600">Configurations</p>
            <button onClick={newConfig}
              className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg hover:bg-blue-700">+ New</button>
          </div>
          {configs.map(c => (
            <div key={c.email_config_id} onClick={() => selectConfig(c)}
              className={`rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                selected?.email_config_id === c.email_config_id
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white border-slate-100 hover:border-blue-200"}`}>
              <div className="flex items-center justify-between">
                <p className={`text-sm font-medium truncate ${selected?.email_config_id === c.email_config_id ? "text-white" : "text-slate-700"}`}>
                  {c.config_name}
                </p>
                {c.is_active && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${selected?.email_config_id === c.email_config_id ? "bg-white/20 text-white" : "bg-green-100 text-green-700"}`}>
                    Active
                  </span>
                )}
              </div>
              <p className={`text-xs mt-0.5 truncate ${selected?.email_config_id === c.email_config_id ? "text-blue-100" : "text-slate-400"}`}>
                {c.smtp_host}:{c.smtp_port}
              </p>
            </div>
          ))}
          {configs.length === 0 && <p className="text-xs text-slate-400 px-1">No configs yet.</p>}
        </div>

        {/* editor */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-slate-100 shadow-sm">
          {/* header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-700">
              {selected ? selected.config_name : "New Configuration"}
            </p>
            <div className="flex gap-2">
              {selected && !selected.is_active && (
                <button onClick={() => activate(selected.email_config_id)}
                  className="text-xs border border-green-300 text-green-600 px-3 py-1 rounded-lg hover:bg-green-50">
                  Activate
                </button>
              )}
              {selected && (
                <button onClick={testSmtp} disabled={testing}
                  className="text-xs border border-slate-200 px-3 py-1 rounded-lg hover:bg-slate-50 disabled:opacity-50">
                  {testing ? "Testing..." : "Test SMTP"}
                </button>
              )}
              <button onClick={save} disabled={saving}
                className="text-xs bg-blue-600 text-white px-4 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving..." : selected ? "Update" : "Create"}
              </button>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {/* tabs */}
            <div className="flex gap-1 border-b border-slate-100">
              {[["smtp","SMTP"],["sender","Sender"],["defaults","Defaults"],["signature","Signature"]].map(([k,l]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`px-4 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                    tab === k ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                  {l}
                </button>
              ))}
            </div>

            <Field label="Config Name *">
              <Input value={form.config_name} onChange={v => set("config_name", v)} placeholder="e.g. Production SMTP" />
            </Field>

            {tab === "smtp" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Field label="SMTP Host *">
                    <Input value={form.smtp_host} onChange={v => set("smtp_host", v)} placeholder="smtp.gmail.com" />
                  </Field>
                </div>
                <Field label="SMTP Port">
                  <Input type="number" value={form.smtp_port} onChange={v => set("smtp_port", v)} placeholder="587" />
                </Field>
                <Field label="Use TLS">
                  <div className="flex items-center gap-2 mt-1.5">
                    <input type="checkbox" checked={form.use_tls} onChange={e => set("use_tls", e.target.checked)}
                      id="tls" className="rounded" />
                    <label htmlFor="tls" className="text-sm text-slate-600">Enable TLS</label>
                  </div>
                </Field>
                <Field label="SMTP Username">
                  <Input value={form.smtp_user} onChange={v => set("smtp_user", v)} placeholder="user@gmail.com" />
                </Field>
                <Field label={selected ? "SMTP Password (leave blank to keep)" : "SMTP Password"}>
                  <Input type="password" value={form.smtp_password} onChange={v => set("smtp_password", v)} placeholder="••••••••" />
                </Field>
              </div>
            )}

            {tab === "sender" && (
              <div className="grid grid-cols-2 gap-4">
                <Field label="From Name">
                  <Input value={form.from_name} onChange={v => set("from_name", v)} placeholder="Accounts Receivable" />
                </Field>
                <Field label="From Address *">
                  <Input value={form.from_address} onChange={v => set("from_address", v)} placeholder="ar@yourcompany.com" />
                </Field>
                <Field label="Reply-To">
                  <Input value={form.reply_to} onChange={v => set("reply_to", v)} placeholder="accounts@yourcompany.com" />
                </Field>
                <Field label="Company Name *">
                  <Input value={form.company_name} onChange={v => set("company_name", v)} placeholder="Acme Ltd" />
                </Field>
                <Field label="Reporting Currency">
                  <select value={form.reporting_currency} onChange={e => set("reporting_currency", e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
                    {["EUR","USD","GBP","CHF","JPY"].map(c => <option key={c}>{c}</option>)}
                  </select>
                </Field>
              </div>
            )}

            {tab === "defaults" && (
              <div className="grid grid-cols-1 gap-4">
                <Field label="Default To" hint="Comma-separated. Used when no customer email is on file.">
                  <Input value={form.default_to} onChange={v => set("default_to", v)} placeholder="finance@client.com" />
                </Field>
                <Field label="Default CC" hint="Always CC'd on every outbound dunning email.">
                  <Input value={form.default_cc} onChange={v => set("default_cc", v)} placeholder="ar-team@yourcompany.com" />
                </Field>
              </div>
            )}

            {tab === "signature" && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">HTML signature appended to every email via <code className="bg-slate-100 px-1 rounded">{"{{signature}}"}</code> token.</p>
                {/* mini toolbar */}
                <div className="flex flex-wrap gap-1 bg-slate-50 border border-slate-200 rounded-t-lg px-2 py-1.5">
                  {[
                    ["B",  `<strong></strong>`],
                    ["I",  `<em></em>`],
                    ["BR", `<br/>`],
                    ["HR", `<hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0;"/>`],
                    ["Link", `<a href="https://"></a>`],
                  ].map(([lbl, tag]) => (
                    <button key={lbl} type="button" onClick={() => insertSig(tag)}
                      className="px-2 py-0.5 text-xs rounded border border-slate-200 hover:bg-white">
                      {lbl}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={sigRef}
                  value={form.signature_html ?? ""}
                  onChange={e => set("signature_html", e.target.value)}
                  rows={8}
                  placeholder={`<p>Best regards,<br/><strong>{{company_name}}</strong><br/>accounts@yourcompany.com</p>`}
                  className="w-full border border-slate-200 border-t-0 rounded-b-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300 resize-y"
                />
                {/* live preview */}
                {form.signature_html && (
                  <div className="border border-slate-200 rounded-lg p-4 bg-white">
                    <p className="text-xs text-slate-400 mb-2">Preview</p>
                    <div dangerouslySetInnerHTML={{ __html: form.signature_html
                      .replace("{{company_name}}", form.company_name || "Your Company") }} />
                  </div>
                )}
              </div>
            )}

            {testResult && (
              <div className={`rounded-lg px-4 py-2 text-sm ${testResult.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                {testResult.ok
                  ? `SMTP test: ${testResult.status} — ${testResult.note}`
                  : `Test failed: ${testResult.error}`}
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