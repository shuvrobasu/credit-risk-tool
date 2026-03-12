// export default function Dashboard() {
//   return <div className="p-4"><h1 className="text-2xl font-bold">Dashboard</h1><p className="text-slate-500 mt-1">Portfolio overview — coming next</p></div>
// }

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import axios from 'axios'
import { getPortfolio, computeAll, getGlobalCashflow, getAgingSummary } from '../api/index.js'
import { AlertTriangle, TrendingDown, CheckCircle, XCircle, RefreshCw, BarChart3, Clock } from 'lucide-react'

const BAND_META = {
  green: { label: 'Green',  color: '#22c55e', icon: CheckCircle,   bg: 'bg-green-50',  border: 'border-green-200', text: 'text-green-700' },
  amber: { label: 'Amber',  color: '#f59e0b', icon: AlertTriangle, bg: 'bg-amber-50',  border: 'border-amber-200', text: 'text-amber-700' },
  red:   { label: 'Red',    color: '#ef4444', icon: TrendingDown,  bg: 'bg-red-50',    border: 'border-red-200',   text: 'text-red-700'   },
  black: { label: 'Black',  color: '#1e293b', icon: XCircle,       bg: 'bg-slate-100', border: 'border-slate-300', text: 'text-slate-800' },
}

function fmt(n) {
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `€${(n / 1_000).toFixed(1)}K`
  return `€${n.toFixed(2)}`
}

function BandCard({ band, count, exposure }) {
  const m = BAND_META[band]
  const Icon = m.icon
  return (
    <div className={`rounded-xl border p-4 ${m.bg} ${m.border} flex flex-col gap-1`}>
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold uppercase tracking-wide ${m.text}`}>{m.label}</span>
        <Icon size={16} className={m.text} />
      </div>
      <p className={`text-3xl font-bold ${m.text}`}>{count}</p>
      <p className="text-xs text-slate-500">Exposure: {fmt(exposure)}</p>
    </div>
  )
}

function ScoreBadge({ band, score }) {
  const colors = { green: 'bg-green-100 text-green-700', amber: 'bg-amber-100 text-amber-700', red: 'bg-red-100 text-red-700', black: 'bg-slate-200 text-slate-800' }
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold leading-5 ${colors[band] || 'bg-slate-100'}`}>
      {score?.toFixed(0)}
    </span>
  )
}

function AgingBucketCard({ label, amount, ratio }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</span>
        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{(ratio * 100).toFixed(1)}%</span>
      </div>
      <p className="text-xl font-bold text-slate-700">{fmt(amount)}</p>
    </div>
  )
}


export default function Dashboard() {
  const [data,    setData]    = useState(null)
  const [cashflow, setCashflow] = useState(null)
  const [aging,   setAging]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [computing, setComputing] = useState(false)
  const [search,  setSearch]  = useState('')
  const [sortBy,  setSortBy]  = useState('final_score')
  const [sortDir, setSortDir] = useState('asc')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const nav = useNavigate()

  const [mappings, setMappings] = useState([])

  const load = () => {
    setLoading(true)
    Promise.all([
      getPortfolio().catch(e => { throw new Error('Failed to load portfolio') }),
      getGlobalCashflow().catch(e => ({ data: null })),
      getAgingSummary().catch(e => ({ data: null })),
      axios.get("/api/v1/ui-mapping").catch(e => ({ data: [] }))
    ])
      .then(([portRes, cfRes, agingRes, uiRes]) => {
        setData(portRes.data)
        if (cfRes && cfRes.data) setCashflow(cfRes.data)
        if (agingRes && agingRes.data) setAging(agingRes.data)
        if (uiRes && uiRes.data) setMappings(uiRes.data)
      })
      .catch((e) => setError(e.message || 'Failed to load dashboard data'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const getLabel = (field, def) => {
    const m = mappings.find(map => map.page === 'worklist' && map.field === field);
    return m ? m.label : def;
  }

  const handleComputeAll = () => {
    setComputing(true)
    computeAll().finally(() => { setComputing(false); load() })
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading portfolio...</div>
  if (error)   return <div className="text-red-500 p-4">{error}</div>
  if (!data)   return null

  const { band_summary, total_exposure, total_customers, customers } = data

  // band exposure
  const bandExposure = { green: 0, amber: 0, red: 0, black: 0 }
  customers.forEach(c => { 
    if (c.risk_band && bandExposure.hasOwnProperty(c.risk_band)) {
       bandExposure[c.risk_band] = (bandExposure[c.risk_band] || 0) + (c.open_ar_balance || 0) 
    }
  })

  const pieData = Object.entries(band_summary).map(([band, count]) => ({
    name:  BAND_META[band]?.label || band,
    value: count,
    color: BAND_META[band]?.color,
  })).filter(d => d.value > 0)

  const barData = Object.entries(bandExposure).map(([band, amt]) => ({
    band:  BAND_META[band]?.label || band,
    amount: amt,
    color: BAND_META[band]?.color,
  }))

  // filter + sort
  const filtered = customers
    .filter(c => {
      const q = search.toLowerCase()
      const matchSearch = c.customer_name.toLowerCase().includes(q) || c.customer_code.toLowerCase().includes(q)
      const matchOverdue = overdueOnly ? c.overdue_balance > 0 : true
      return matchSearch && matchOverdue
    })
    .sort((a, b) => {
      const av = a[sortBy], bv = b[sortBy]
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }

  const SortIcon = ({ col }) => sortBy !== col ? null : <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Portfolio Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total_customers} customers — Total exposure {fmt(total_exposure)}</p>
        </div>
        <button
          onClick={handleComputeAll}
          disabled={computing}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <RefreshCw size={14} className={computing ? 'animate-spin' : ''} />
          {computing ? 'Computing...' : 'Recompute All'}
        </button>
      </div>

      {/* Band Cards */}
      <div className="grid grid-cols-4 gap-4">
        {Object.entries(band_summary).map(([band, count]) => (
          <BandCard key={band} band={band} count={count} exposure={bandExposure[band] || 0} />
        ))}
      </div>

      {/* Aging Buckets */}
      {aging && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
             <Clock size={16} className="text-slate-400" />
             <h2 className="text-sm font-bold text-slate-700">Accounts Receivable Aging</h2>
          </div>
          <div className="grid grid-cols-5 gap-4">
            <AgingBucketCard label="Current" amount={aging.buckets.current} ratio={aging.ratios.current} />
            <AgingBucketCard label="1-30 Days" amount={aging.buckets["1_30"]} ratio={aging.ratios["1_30"]} />
            <AgingBucketCard label="31-60 Days" amount={aging.buckets["31_60"]} ratio={aging.ratios["31_60"]} />
            <AgingBucketCard label="61-90 Days" amount={aging.buckets["61_90"]} ratio={aging.ratios["61_90"]} />
            <AgingBucketCard label="Over 90 Days" amount={aging.buckets["90_plus"]} ratio={aging.ratios["90_plus"]} />
          </div>
          
          {/* Stacked bar visualization */}
          <div className="bg-white rounded-xl border border-slate-200 p-1 flex h-3 overflow-hidden">
             {Object.entries(aging.ratios).map(([key, ratio], idx) => {
               const colors = ['bg-blue-500', 'bg-amber-400', 'bg-orange-500', 'bg-red-500', 'bg-slate-800']
               if (ratio === 0) return null
               return (
                 <div 
                   key={key} 
                   className={`${colors[idx]} h-full transition-all`} 
                   style={{ width: `${ratio * 100}%` }}
                   title={`${key}: ${(ratio * 100).toFixed(1)}%`}
                 />
               )
             })}
          </div>
        </div>
      )}

      {/* Cash Flow Forecast Card */}
      {cashflow && (
        <div className="bg-white rounded-xl border border-blue-100 overflow-hidden shadow-sm">
          <div className="bg-gradient-to-r from-blue-50 to-white px-5 py-3 border-b border-blue-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 size={18} className="text-blue-600" />
              <h2 className="text-sm font-bold text-blue-900">Predictive Cash Flow Forecast</h2>
            </div>
            <span className="text-xs font-medium text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">M5 Engine Active</span>
          </div>
          <div className="grid grid-cols-4 divide-x divide-slate-100 p-5">
            <div className="flex flex-col gap-1 pr-4">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Next 30 Days</span>
              <span className="text-2xl font-bold text-slate-800">{fmt(cashflow.forecast_30_days)}</span>
            </div>
            <div className="flex flex-col gap-1 px-5">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Days 31 - 60</span>
              <span className="text-2xl font-bold text-slate-800">{fmt(cashflow.forecast_60_days)}</span>
            </div>
            <div className="flex flex-col gap-1 px-5">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Days 61 - 90</span>
              <span className="text-2xl font-bold text-slate-800">{fmt(cashflow.forecast_90_days)}</span>
            </div>
            <div className="flex flex-col gap-1 pl-5">
              <span className="text-xs text-blue-600 uppercase tracking-wider font-bold">90-Day Expected Recovery</span>
              <span className="text-2xl font-black text-blue-700">{fmt(cashflow.total_expected_recovery)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-700 mb-3">Customer Distribution</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-700 mb-3">Exposure by Risk Band</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="band" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 11 }} />
              <Tooltip formatter={v => fmt(v)} />
              <Bar dataKey="amount">
                {barData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Customer Table */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">All Customers</p>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-600 font-medium cursor-pointer">
              <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} className="rounded text-blue-600 w-4 h-4 focus:ring-blue-500" />
              Show Overdue Only
            </label>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name or code..."
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                {[
                  ['customer_code',  getLabel('customer_code', 'Code')],
                  ['customer_name',  getLabel('customer_name', 'Name')],
                  ['customer_category', getLabel('customer_category', 'Category')],
                  ['final_score',    getLabel('final_score', 'Score')],
                  ['cur',            getLabel('cur', 'Utilization')],
                  ['open_ar_balance',getLabel('open_ar_balance', 'Open AR')],
                  ['score_date',     getLabel('score_date', 'Score Date')],
                ].map(([col, label]) => (
                  <th key={col} className="px-4 py-2 text-left cursor-pointer hover:text-slate-700 select-none" onClick={() => toggleSort(col)}>
                    {label}<SortIcon col={col} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr
                  key={c.customer_id}
                  className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => nav(`/customers/${c.customer_id}`)}
                >
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{c.customer_code}</td>
                  <td className="px-4 py-2 font-medium text-slate-800">{c.customer_name}</td>
                  <td className="px-4 py-2 capitalize text-slate-600">{c.customer_category}</td>
                  <td className="px-4 py-2"><ScoreBadge band={c.risk_band} score={c.final_score} /></td>
                  <td className="px-4 py-2 text-slate-600">{(c.cur * 100).toFixed(1)}%</td>
                  <td className="px-4 py-2 text-slate-600">{fmt(c.open_ar_balance)}</td>
                  <td className="px-4 py-2 text-slate-400 text-xs">{c.score_date}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No customers found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}