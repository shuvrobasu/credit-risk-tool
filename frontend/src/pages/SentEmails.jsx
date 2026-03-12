import { useEffect, useState } from "react"
import axios from "axios"

const DELIVERY_COLORS = {
  sent:      "bg-blue-100 text-blue-600",
  delivered: "bg-green-100 text-green-700",
  mocked:    "bg-slate-100 text-slate-500",
  failed:    "bg-red-100 text-red-600",
  bounced:   "bg-orange-100 text-orange-600",
}

export default function SentEmails() {
  const [emails,   setEmails]   = useState([])
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState("")
  const [filter,   setFilter]   = useState("")
  const [detail,   setDetail]   = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  function load() {
    setLoading(true)
    const params = new URLSearchParams({ limit: "100" })
    if (filter) params.set("delivery_status", filter)
    if (search) params.set("search", search)
    axios.get(`/api/v1/dunning/sent-emails?${params}`)
      .then(r => {
        setEmails(r.data.entries || [])
        setTotal(r.data.total || 0)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [filter])

  function openDetail(id) {
    setDetailLoading(true)
    axios.get(`/api/v1/dunning/sent-emails/${id}`)
      .then(r => {
        setDetail(r.data)
        setDetailLoading(false)
      })
      .catch(() => setDetailLoading(false))
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Sent Emails</h1>
          <p className="text-sm text-slate-400">{total} dunning emails on record</p>
        </div>
      </div>

      {/* filters */}
      <div className="flex gap-3 items-end">
        <div>
          <label className="text-xs text-slate-400 block mb-1">Search</label>
          <input value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === "Enter" && load()}
            placeholder="Customer, invoice, subject..."
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Status</label>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
            <option value="">All</option>
            <option value="sent">Sent</option>
            <option value="delivered">Delivered</option>
            <option value="mocked">Mocked</option>
            <option value="failed">Failed</option>
            <option value="bounced">Bounced</option>
          </select>
        </div>
        <button onClick={load}
          className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700">
          Search
        </button>
      </div>

      {/* table */}
      {loading ? <div className="text-slate-400 py-8 text-center">Loading...</div> : (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-220px)]">
          <div className="overflow-y-auto overflow-x-auto flex-1 custom-scrollbar">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 text-xs uppercase text-slate-400">
                  {["Sent At", "Customer", "Invoice", "Step", "Subject", "To", "Delivery", ""].map(h => (
                    <th key={h} className="px-4 py-3 text-left whitespace-nowrap bg-slate-50 border-b border-slate-100">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {emails.map(e => (
                  <tr key={e.dunning_id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2 text-xs text-slate-400 whitespace-nowrap">{e.sent_at?.slice(0,16).replace("T"," ")}</td>
                    <td className="px-4 py-2 font-medium text-slate-700">{e.customer_name || e.customer_id?.slice(0,8)}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{e.invoice_number}</td>
                    <td className="px-4 py-2">
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">Step {e.dunning_step}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600 truncate max-w-[200px]">{e.rendered_subject || "—"}</td>
                    <td className="px-4 py-2 text-xs text-slate-400 truncate max-w-[150px]">{e.sent_to || "—"}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${DELIVERY_COLORS[e.delivery_status] || "bg-slate-100 text-slate-400"}`}>
                        {e.delivery_status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <button onClick={() => openDetail(e.dunning_id)}
                        className="text-xs text-blue-500 hover:text-blue-700 hover:underline">View</button>
                    </td>
                  </tr>
                ))}
                {emails.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No sent emails found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[700px] max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">Email Detail</p>
                <p className="text-xs text-slate-400">{detail.sent_at?.slice(0,16).replace("T"," ")}</p>
              </div>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>
            <div className="px-6 py-4 space-y-3 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-slate-400">Customer:</span> <span className="text-slate-700 font-medium">{detail.customer_name}</span></div>
                <div><span className="text-slate-400">Invoice:</span> <span className="text-slate-700 font-mono">{detail.invoice_number}</span></div>
                <div><span className="text-slate-400">To:</span> <span className="text-slate-600">{detail.sent_to || "—"}</span></div>
                <div><span className="text-slate-400">CC:</span> <span className="text-slate-600">{detail.sent_cc || "—"}</span></div>
                <div><span className="text-slate-400">Step:</span> <span className="text-slate-700">{detail.dunning_step}</span></div>
                <div><span className="text-slate-400">Template:</span> <span className="text-slate-600">{detail.template_name || "—"}</span></div>
                <div><span className="text-slate-400">DPD at Send:</span> <span className="text-slate-700">{detail.days_past_due_at_send ?? "—"}</span></div>
                <div><span className="text-slate-400">Status:</span>
                  <span className={`ml-1 text-xs px-2 py-0.5 rounded-full capitalize ${DELIVERY_COLORS[detail.delivery_status] || ""}`}>
                    {detail.delivery_status}
                  </span>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3">
                <p className="text-xs text-slate-400 mb-1 font-semibold uppercase">Subject</p>
                <p className="text-sm text-slate-700">{detail.rendered_subject || "No subject recorded"}</p>
              </div>

              <div className="border-t border-slate-100 pt-3">
                <p className="text-xs text-slate-400 mb-2 font-semibold uppercase">Email Body</p>
                {detail.rendered_body ? (
                  <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 text-sm overflow-auto max-h-[400px]"
                    dangerouslySetInnerHTML={{ __html: detail.rendered_body }} />
                ) : (
                  <p className="text-sm text-slate-400 italic">No email body recorded for this action</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
