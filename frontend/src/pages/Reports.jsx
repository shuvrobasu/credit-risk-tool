import { useEffect, useState } from "react"
import axios from "axios"
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell 
} from "recharts"
import { TrendingUp, Users, DollarSign, Activity, ArrowUpRight, ArrowDownRight, Filter, Download, FileText, ChevronRight } from "lucide-react"

const COLORS = ["#3b82f6", "#f59e0b", "#f97316", "#ef4444", "#7f1d1d"]

const KpiCard = ({ title, value, icon: Icon, trend, colorClass }) => (
  <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm">
    <div className="flex justify-between items-start mb-4">
      <div className={`p-2 rounded-lg bg-slate-50 ${colorClass}`}>
        <Icon size={20} />
      </div>
      {trend && (
        <span className={`flex items-center text-xs font-bold ${trend > 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {trend > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {Math.abs(trend)}%
        </span>
      )}
    </div>
    <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">{title}</h3>
    <p className="text-2xl font-black text-slate-800">{value}</p>
  </div>
)

const ChartContainer = ({ title, children, height = 300 }) => (
  <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm">
    <h3 className="text-sm font-black text-slate-800 mb-6 uppercase tracking-widest">{title}</h3>
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        {children}
      </ResponsiveContainer>
    </div>
  </div>
)

export default function Reports() {
  const [activeTab, setActiveTab] = useState("standard")
  const [stats, setStats] = useState(null)
  const [trends, setTrends] = useState([])
  const [efficiency, setEfficiency] = useState(null)
  const [loading, setLoading] = useState(true)

  // Custom Report State
  const [customData, setCustomData] = useState([])
  const [filters, setFilters] = useState({
    report_type: "ledger",
    date_from: "",
    date_to: "",
    risk_bands: [],
  })

  useEffect(() => {
    loadOverviewData()
  }, [])

  const loadOverviewData = () => {
    setLoading(true)
    Promise.all([
      axios.get("/api/v1/reports/dashboard-stats"),
      axios.get("/api/v1/reports/aging-trends"),
      axios.get("/api/v1/reports/collector-efficiency")
    ]).then(([s, t, e]) => {
      setStats(s.data)
      setTrends(t.data)
      setEfficiency(e.data)
      setLoading(false)
    }).catch(err => {
      console.error("Failed to load report data", err)
      setLoading(false)
    })
  }

  const runCustomQuery = () => {
    setLoading(true)
    axios.post("/api/v1/reports/query", filters)
      .then(r => {
        setCustomData(r.data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  const exportCsv = () => {
    if (customData.length === 0) return
    const headers = Object.keys(customData[0]).join(",")
    const rows = customData.map(row => Object.values(row).join(",")).join("\n")
    const csvContent = "data:text/csv;charset=utf-8," + headers + "\n" + rows
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", `custom_report_${filters.report_type}.csv`)
    document.body.appendChild(link)
    link.click()
  }

  const renderStandard = () => (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* KPI Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard 
          title="Total AR Exposure" 
          value={`€${(stats?.total_ar / 1e6).toFixed(2)}M`} 
          icon={DollarSign} 
          trend={2.4}
          colorClass="text-blue-600"
        />
        <KpiCard 
          title="Days Sales Outstanding" 
          value={`${stats?.dso} Days`} 
          icon={TrendingUp} 
          trend={-5.1}
          colorClass="text-emerald-600"
        />
        <KpiCard 
          title="Recovery Rate (30d)" 
          value={`${stats?.recovery_rate}%`} 
          icon={Activity} 
          trend={1.2}
          colorClass="text-purple-600"
        />
        <KpiCard 
          title="Collector Efficiency" 
          value={`${efficiency?.efficiency_ratio}%`} 
          icon={Users} 
          trend={8.4}
          colorClass="text-orange-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Aging Trend Chart */}
        <ChartContainer title="Aging Buckets Historical Trend">
          <AreaChart data={trends}>
            <defs>
              <linearGradient id="colorO90" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#7f1d1d" stopOpacity={0.1}/>
                <stop offset="95%" stopColor="#7f1d1d" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10}} />
            <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10}} />
            <Tooltip 
              contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
            />
            <Legend iconType="circle" />
            <Area type="monotone" dataKey="current" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} name="Current" />
            <Area type="monotone" dataKey="overdue_1_30" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.6} name="1-30 Days" />
            <Area type="monotone" dataKey="overdue_31_60" stackId="1" stroke="#f97316" fill="#f97316" fillOpacity={0.6} name="31-60 Days" />
            <Area type="monotone" dataKey="overdue_61_90" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.6} name="61-90 Days" />
            <Area type="monotone" dataKey="overdue_91_plus" stackId="1" stroke="#7f1d1d" fill="#7f1d1d" fillOpacity={0.6} name="91+ Days" />
          </AreaChart>
        </ChartContainer>

        {/* DSO Trend Chart */}
        <ChartContainer title="DSO Volatility (90-Day Rolling)">
          <LineChart data={trends}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10}} />
            <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10}} />
            <Tooltip 
              contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
            />
            <Line type="stepAfter" dataKey="dso" stroke="#3b82f6" strokeWidth={3} dot={{r: 4, fill: '#3b82f6'}} activeDot={{r: 6}} name="DSO Index" />
          </LineChart>
        </ChartContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         {/* Collector Workload Breakdown */}
         <ChartContainer title="Worklist Status Distribution">
            <PieChart>
              <Pie
                data={[
                  { name: 'Approved', value: efficiency?.approved || 0 },
                  { name: 'Rejected', value: efficiency?.rejected || 0 },
                  { name: 'Pending', value: efficiency?.pending || 0 },
                ]}
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
              >
                <Cell fill="#10b981" />
                <Cell fill="#ef4444" />
                <Cell fill="#6366f1" />
              </Pie>
              <Tooltip />
              <Legend verticalAlign="bottom" height={36}/>
            </PieChart>
         </ChartContainer>

         {/* High Risk Concentration */}
         <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <h3 className="text-sm font-black text-slate-800 mb-6 uppercase tracking-widest">High Risk Concentration</h3>
            <div className="space-y-4">
               {[
                 { name: "Strategic Accounts", value: 45, color: "bg-blue-600" },
                 { name: "SME Portfolio", value: 30, color: "bg-purple-600" },
                 { name: "At-Risk Segments", value: 15, color: "bg-rose-600" },
                 { name: "New Customers", value: 10, color: "bg-emerald-600" },
               ].map(item => (
                 <div key={item.name} className="space-y-1">
                    <div className="flex justify-between text-xs">
                       <span className="font-bold text-slate-600">{item.name}</span>
                       <span className="text-slate-400">{item.value}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-50 rounded-full overflow-hidden">
                       <div className={`h-full ${item.color}`} style={{ width: `${item.value}%` }} />
                    </div>
                 </div>
               ))}
            </div>
         </div>
      </div>
    </div>
  )

  const renderBuilder = () => (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 animate-in slide-in-from-right duration-500">
      {/* Sidebar Filters */}
      <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm h-fit space-y-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={18} className="text-blue-600" />
          <h3 className="font-black text-slate-800 uppercase text-xs tracking-widest">Report Builder</h3>
        </div>

        <div>
          <label className="text-[10px] font-black uppercase text-slate-400 block mb-2">Report Type</label>
          <select 
            value={filters.report_type}
            onChange={e => setFilters({...filters, report_type: e.target.value})}
            className="w-full bg-slate-50 border-none rounded p-2 text-sm font-bold text-slate-700 focus:ring-2 ring-blue-500"
          >
            <option value="ledger">AR Ledger (Detailed)</option>
            <option value="dispute">Dispute Aging</option>
            <option value="credit_util">Credit Utilization</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 block mb-2">From</label>
            <input type="date" className="w-full bg-slate-50 border-none rounded p-2 text-xs font-bold text-slate-700" onChange={e => setFilters({...filters, date_from: e.target.value})} />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 block mb-2">To</label>
            <input type="date" className="w-full bg-slate-50 border-none rounded p-2 text-xs font-bold text-slate-700" onChange={e => setFilters({...filters, date_to: e.target.value})} />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-black uppercase text-slate-400 block mb-2">Risk Bands</label>
          <div className="space-y-2">
            {["RED", "AMBER", "GREEN"].map(band => (
              <label key={band} className="flex items-center gap-2 cursor-pointer group">
                <input 
                  type="checkbox" 
                  className="rounded text-blue-600 bg-slate-100 border-none focus:ring-0" 
                  onChange={e => {
                    const next = e.target.checked 
                      ? [...filters.risk_bands, band]
                      : filters.risk_bands.filter(b => b !== band)
                    setFilters({...filters, risk_bands: next})
                  }}
                />
                <span className="text-xs font-bold text-slate-500 group-hover:text-slate-800 transition-colors uppercase">{band}</span>
              </label>
            ))}
          </div>
        </div>

        <button 
          onClick={runCustomQuery}
          className="w-full bg-slate-800 hover:bg-black text-white py-3 rounded font-black text-xs uppercase tracking-widest transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"
        >
          Generate Report
        </button>
      </div>

      {/* Results Table */}
      <div className="lg:col-span-3 space-y-6">
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Query Results ({customData.length})</h4>
            <button 
              onClick={exportCsv}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded text-[10px] font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 transition-colors"
            >
              <Download size={14} /> Export CSV
            </button>
          </div>
          
          <div className="overflow-x-auto">
            {customData.length > 0 ? (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-white">
                    {Object.keys(customData[0]).filter(h => !h.startsWith("_")).map(h => (
                      <th key={h} className="px-4 py-3 font-black text-slate-400 uppercase tracking-tighter border-b border-slate-50">{h.replace(/_/g, " ")}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {customData.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors group">
                      {Object.keys(row).filter(key => !key.startsWith("_")).map((key, j) => {
                        const val = row[key];
                        let cellClass = "px-4 py-3 font-bold text-slate-700";
                        
                        // Action-specific color feedback
                        if (key === "Status") {
                          if (row._status_intent === "danger") cellClass = "px-4 py-3 font-black text-rose-600 bg-rose-50/50";
                          else if (row._status_intent === "warning") cellClass = "px-4 py-3 font-black text-orange-600 bg-orange-50/50";
                          else if (row._status_intent === "success") cellClass = "px-4 py-3 font-black text-emerald-600 bg-emerald-50/50";
                        }
                        
                        if (key === "Recommendation") {
                          if (row._rec_intent === "danger") cellClass = "px-4 py-3 font-black text-rose-600 bg-rose-50/50";
                          else if (row._rec_intent === "warning") cellClass = "px-4 py-3 font-black text-orange-600 bg-orange-50/50";
                          else if (row._rec_intent === "success") cellClass = "px-4 py-3 font-black text-emerald-600 bg-emerald-50/50";
                          else if (row._rec_intent === "info") cellClass = "px-4 py-3 font-black text-blue-600 bg-blue-50/50";
                        }

                        return <td key={j} className={cellClass}>{String(val || "-")}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-12 text-center text-slate-400">
                <FileText size={48} className="mx-auto mb-4 opacity-10" />
                <p className="text-xs font-black uppercase tracking-widest">No results to display</p>
                <p className="text-[10px] mt-1">Configure filters and click Generate Report</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  if (loading && activeTab === "standard") return (
    <div className="p-8 text-center">
      <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
      <p className="text-slate-400 font-bold uppercase text-xs tracking-widest">Synthesizing Analytics...</p>
    </div>
  )

  return (
    <div className="p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tighter flex items-center gap-2">
            Intelligence Center <span className="text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full uppercase tracking-widest font-black">Pro</span>
          </h1>
          <p className="text-slate-500 text-sm mt-1">Strategic portfolio analytics and ad-hoc report generation</p>
        </div>

        <div className="flex bg-slate-100 p-1 rounded-lg">
          <button 
            onClick={() => setActiveTab("standard")}
            className={`px-6 py-2 rounded-md text-xs font-black uppercase tracking-widest transition-all ${activeTab === "standard" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            Overview
          </button>
          <button 
            onClick={() => setActiveTab("custom")}
            className={`px-6 py-2 rounded-md text-xs font-black uppercase tracking-widest transition-all ${activeTab === "custom" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            Builder
          </button>
        </div>
      </div>

      <div className="pt-2">
        {activeTab === "standard" ? renderStandard() : renderBuilder()}
      </div>
    </div>
  )
}
