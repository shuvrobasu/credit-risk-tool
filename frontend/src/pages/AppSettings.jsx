import { useState, useEffect } from 'react'
import axios from 'axios'
import { useTheme } from '../contexts/ThemeContext'
import { Save, Palette, Bell, Globe, CheckCircle2, Building2, Mail, MapPin, Lock, Layers, Hash, Type } from 'lucide-react'

export default function AppSettings() {
    const { theme, setTheme } = useTheme()
    const [settings, setSettings] = useState({
        global_use_manual_contact: false,
        auto_resolve_dispute_on_payment: false,
        dunning_mode: 'fixed',
        dunning_level: 'invoice',
        pagination_size: 15,
        business_name: '',
        business_email: '',
        business_address: ''
    })
    const [localTheme, setLocalTheme] = useState(theme)
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState(null)

    const [mappings, setMappings] = useState([])
    const [newMapping, setNewMapping] = useState({ page: 'customers', field: '', label: '' })

    useEffect(() => {
        axios.get('/api/v1/app-settings').then(res => {
            setSettings(s => ({ ...s, ...res.data }))
        })
        axios.get('/api/v1/ui-mapping').then(res => {
            setMappings(res.data)
        })
    }, [])

    const saveSettings = async () => {
        setLoading(true)
        setMessage(null)
        try {
            // Atomic Bulk Save for EVERYTHING (Settings + Theme)
            // Storing theme in DB is significantly faster and more reliable than file system writes
            await axios.post('/api/v1/app-settings/bulk', {
                global_use_manual_contact: settings.global_use_manual_contact,
                auto_resolve_dispute_on_payment: settings.auto_resolve_dispute_on_payment,
                dunning_mode: settings.dunning_mode,
                dunning_level: settings.dunning_level,
                pagination_size: settings.pagination_size,
                business_name: settings.business_name,
                business_email: settings.business_email,
                business_address: settings.business_address,
                theme_config: { ...localTheme, appName: theme.appName } // Protect read-only App Name
            })

            // Background sync to theme.json (optional/non-blocking for cold starts)
            const themePayload = { ...localTheme, appName: theme.appName };
            axios.post('/api/v1/app-settings/theme', themePayload).catch(() => { })

            setTheme(themePayload)
            setMessage({ type: 'success', text: 'All settings and theme deployed successfully.' })
        } catch (e) {
            setMessage({ type: 'error', text: 'Deployment failed: ' + (e.response?.data?.detail || e.message) })
        } finally {
            setLoading(false)
        }
    }

    const addMapping = async () => {
        if (!newMapping.field || !newMapping.label) return
        await axios.post('/api/v1/ui-mapping/upsert', {
            page_key: newMapping.page,
            field_key: newMapping.field,
            display_name: newMapping.label
        })
        const res = await axios.get('/api/v1/ui-mapping')
        setMappings(res.data)
        setNewMapping({ ...newMapping, field: '', label: '' })
    }

    const updateTheme = (key, val) => {
        setLocalTheme(prev => ({ ...prev, [key]: val }))
    }

    const updateSetting = (key, val) => {
        setSettings(prev => ({ ...prev, [key]: val }))
    }

    return (
        <div className="max-w-4xl space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Application Settings</h1>
                    <p className="text-slate-500 mt-1 font-medium">Configure your business profile, branding, and global system behavior.</p>
                </div>
                <button
                    onClick={saveSettings}
                    disabled={loading}
                    className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-200 disabled:opacity-50 transition-all active:scale-95 font-bold"
                >
                    <Save size={20} />
                    {loading ? 'Saving...' : 'Save All Changes'}
                </button>
            </div>

            {message && (
                <div className={`p-5 rounded-2xl flex items-center gap-4 border shadow-sm toast-animate ${message.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700'}`}>
                    <CheckCircle2 size={24} className={message.type === 'success' ? 'text-emerald-500' : 'text-rose-500'} />
                    <p className="text-sm font-semibold">{message.text}</p>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-2">
                {/* Section 1: Business Identity (Signature Data) */}
                <div className="bg-white rounded-[var(--radius)] border border-slate-100 shadow-xl shadow-slate-200/40 overflow-hidden flex flex-col group transition-all hover:shadow-2xl hover:shadow-slate-300/40">
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-8 py-5 border-b border-slate-100 flex items-center gap-3">
                        <div className="p-2 bg-white rounded-xl shadow-sm">
                            <Building2 size={20} className="text-blue-600" />
                        </div>
                        <h2 className="text-sm font-black text-slate-700 uppercase tracking-[0.2em]">Business Identity</h2>
                    </div>
                    <div className="p-8 space-y-6 flex-1">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Company Registered Name</label>
                            <input
                                type="text"
                                value={settings.business_name}
                                onChange={e => updateSetting('business_name', e.target.value)}
                                placeholder="e.g. Acme International Ltd."
                                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-semibold focus:ring-4 ring-blue-500/10 border-blue-100/50 outline-none transition-all placeholder:text-slate-300 text-slate-700"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Official Business Email</label>
                            <div className="relative group/input">
                                <Mail size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within/input:text-blue-500 transition-colors" />
                                <input
                                    type="email"
                                    value={settings.business_email}
                                    onChange={e => updateSetting('business_email', e.target.value)}
                                    placeholder="collections@business.com"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-5 py-3.5 text-sm font-semibold focus:ring-4 ring-blue-500/10 border-blue-100/50 outline-none transition-all placeholder:text-slate-300 text-slate-700"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Registered Address (for Remittance)</label>
                            <div className="relative group/input">
                                <MapPin size={18} className="absolute left-5 top-5 text-slate-300 group-focus-within/input:text-blue-500 transition-colors" />
                                <textarea
                                    rows={4}
                                    value={settings.business_address}
                                    onChange={e => updateSetting('business_address', e.target.value)}
                                    placeholder="123 Corporate Way, City, Country, Zip..."
                                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-5 py-3.5 text-sm font-semibold focus:ring-4 ring-blue-500/10 border-blue-100/50 outline-none transition-all placeholder:text-slate-300 text-slate-700 resize-none leading-relaxed"
                                />
                            </div>
                            <p className="text-[10px] text-slate-400 italic ml-1">* These details will be dynamically injected into automated dunning email signatures.</p>
                        </div>
                    </div>
                </div>

                {/* Section 2: Branding & System ID */}
                <div className="bg-white rounded-[var(--radius)] border border-slate-100 shadow-xl shadow-slate-200/40 overflow-hidden flex flex-col group transition-all hover:shadow-2xl hover:shadow-slate-300/40">
                    <div className="bg-gradient-to-r from-purple-50 to-pink-50 px-8 py-5 border-b border-slate-100 flex items-center gap-3">
                        <div className="p-2 bg-white rounded-xl shadow-sm">
                            <Palette size={20} className="text-purple-600" />
                        </div>
                        <h2 className="text-sm font-black text-slate-700 uppercase tracking-[0.2em]">Branding & Theme</h2>
                    </div>
                    <div className="p-8 space-y-6 flex-1">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center justify-between">
                                Tool System Name
                                <span className="flex items-center gap-1 text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded-full lowercase tracking-normal">
                                    <Lock size={10} /> read-only
                                </span>
                            </label>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={theme.appName}
                                    readOnly
                                    className="w-full bg-slate-100 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-black text-slate-400 cursor-not-allowed outline-none select-none border-dashed"
                                />
                                <Lock size={16} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-300" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Application Tagline</label>
                            <input
                                type="text"
                                value={localTheme.tagline}
                                onChange={e => updateTheme('tagline', e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-semibold focus:ring-4 ring-purple-500/10 border-purple-100/50 outline-none transition-all text-slate-700"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-6 pt-2">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 text-center block w-full">Primary Brand</label>
                                <div className="flex flex-col items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <input type="color" value={localTheme.primaryColor} onChange={e => updateTheme('primaryColor', e.target.value)} className="h-12 w-full rounded-xl cursor-pointer border-none bg-transparent" />
                                    <input type="text" value={localTheme.primaryColor} onChange={e => updateTheme('primaryColor', e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-black text-center text-slate-500 uppercase font-mono" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 text-center block w-full">Sidebar Context</label>
                                <div className="flex flex-col items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <input type="color" value={localTheme.sidebarBg} onChange={e => updateTheme('sidebarBg', e.target.value)} className="h-12 w-full rounded-xl cursor-pointer border-none bg-transparent" />
                                    <input type="text" value={localTheme.sidebarBg} onChange={e => updateTheme('sidebarBg', e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-black text-center text-slate-500 uppercase font-mono" />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6 pt-2">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 text-center block w-full">Typography Style (Font Face)</label>
                                <div className="p-4 bg-slate-50 rounded-[var(--radius)] border border-slate-100">
                                    <select
                                        value={localTheme.fontFamily || "Inter, system-ui, sans-serif"}
                                        onChange={e => updateTheme('fontFamily', e.target.value)}
                                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:ring-4 ring-indigo-500/10 transition-all appearance-none cursor-pointer"
                                    >
                                        <option value="Inter, system-ui, sans-serif">Inter (Modern & Clean)</option>
                                        <option value="'Outfit', sans-serif">Outfit (Premium & Round)</option>
                                        <option value="'Roboto', sans-serif">Roboto (Structured)</option>
                                        <option value="'Plus Jakarta Sans', sans-serif">Plus Jakarta (Modern High-Tech)</option>
                                        <option value="'JetBrains Mono', monospace">JetBrains Mono (Developer Style)</option>
                                        <option value="'Playfair Display', serif">Playfair (Elegant Serif)</option>
                                    </select>
                                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter mt-2 text-center">Changes System-wide Letterforms</p>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6 pt-2">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 text-center block w-full">Global Font Color</label>
                                <div className="flex flex-col items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <input type="color" value={localTheme.baseFontColor || '#1e293b'} onChange={e => updateTheme('baseFontColor', e.target.value)} className="h-12 w-full rounded-xl cursor-pointer border-none bg-transparent" />
                                    <input type="text" value={localTheme.baseFontColor || '#1e293b'} onChange={e => updateTheme('baseFontColor', e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-black text-center text-slate-500 uppercase font-mono" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 text-center block w-full">Base Font Size</label>
                                <div className="flex flex-col items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100 min-h-[100px]">
                                    <div className="flex items-center gap-3 w-full grow">
                                        <input
                                            type="range"
                                            min="12"
                                            max="20"
                                            step="1"
                                            value={parseInt(localTheme.baseFontSize || '14')}
                                            onChange={e => updateTheme('baseFontSize', `${e.target.value}px`)}
                                            className="grow accent-purple-600 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                                        />
                                        <span className="text-xs font-black text-slate-600 w-8">{localTheme.baseFontSize || '14px'}</span>
                                    </div>
                                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Adjusts system-wide readability</div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2 pt-6">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 text-center block w-full">Box Roundness (Corner Sharpness)</label>
                            <div className="flex items-center gap-6 p-4 bg-slate-50 rounded-[var(--radius)] border border-slate-100">
                                <input
                                    type="range"
                                    min="0"
                                    max="20"
                                    step="1"
                                    value={parseInt(localTheme.borderRadius?.replace('px', '') || (localTheme.borderRadius?.includes('rem') ? parseFloat(localTheme.borderRadius) * 16 : 8))}
                                    onChange={e => updateTheme('borderRadius', `${e.target.value}px`)}
                                    className="grow accent-indigo-600 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                                />
                                <div className="flex flex-col items-center min-w-[60px]">
                                    <span className="text-xs font-black text-slate-600 italic">{localTheme.borderRadius || '8px'}</span>
                                    <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">{parseInt(localTheme.borderRadius) === 0 ? 'Square' : 'Rounded'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Section 3: Global System Overrides (Full Width) */}
                <div className="lg:col-span-2 bg-white rounded-[var(--radius)] border border-slate-100 shadow-xl shadow-slate-200/40 overflow-hidden group transition-all hover:shadow-2xl hover:shadow-slate-300/40">
                    <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-8 py-5 border-b border-slate-100 flex items-center gap-3">
                        <div className="p-2 bg-white rounded-xl shadow-sm">
                            <Globe size={20} className="text-emerald-600" />
                        </div>
                        <h2 className="text-sm font-black text-slate-700 uppercase tracking-[0.2em]">Global System Overrides</h2>
                    </div>
                    <div className="p-8">
                        <div className="flex items-center justify-between p-8 bg-slate-50 rounded-[var(--radius)] border border-slate-100/50 shadow-inner group/toggle hover:bg-white transition-all cursor-pointer"
                            onClick={() => updateSetting('auto_resolve_dispute_on_payment', !settings.auto_resolve_dispute_on_payment)}>
                            <div className="space-y-1">
                                <p className="text-lg font-black text-slate-800">Auto-resolve Dispute on Payment</p>
                                <p className="text-sm text-slate-400 font-medium max-w-2xl leading-relaxed">
                                    When active, the system automatically removes the 'disputed' status and clears the dispute flag as soon as an invoice is marked as fully paid.
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer ml-8" onClick={e => e.stopPropagation()}>
                                <input type="checkbox"
                                    className="sr-only peer"
                                    checked={settings.auto_resolve_dispute_on_payment}
                                    onChange={e => updateSetting('auto_resolve_dispute_on_payment', e.target.checked)}
                                />
                                <div className="w-16 h-9 bg-slate-200 peer-focus:outline-none ring-0 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-7 after:w-7 after:transition-all peer-checked:bg-emerald-500 shadow-inner"></div>
                            </label>
                        </div>

                        <div className="flex items-center justify-between p-8 bg-slate-50 rounded-[var(--radius)] border border-slate-100/50 shadow-inner group/toggle hover:bg-white transition-all cursor-pointer mt-6"
                            onClick={() => updateSetting('dunning_level', settings.dunning_level === 'customer' ? 'invoice' : 'customer')}>
                            <div className="space-y-1">
                                <p className="text-lg font-black text-slate-800 text-indigo-700 flex items-center gap-2">
                                    <Layers size={18} /> Dunning Hierarchy: {settings.dunning_level === 'customer' ? 'Company Level' : 'Invoice Level'}
                                </p>
                                <p className="text-sm text-slate-400 font-medium max-w-2xl leading-relaxed">
                                    {settings.dunning_level === 'customer'
                                        ? 'Account consolidation active. AI will generate ONE strategic action for the entire customer portfolio.'
                                        : 'Granular monitoring active. AI will evaluate each invoice individually.'}
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer ml-8" onClick={e => e.stopPropagation()}>
                                <input type="checkbox"
                                    className="sr-only peer"
                                    checked={settings.dunning_level === 'customer'}
                                    onChange={e => updateSetting('dunning_level', e.target.checked ? 'customer' : 'invoice')}
                                />
                                <div className="w-16 h-9 bg-slate-200 peer-focus:outline-none ring-0 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-7 after:w-7 after:transition-all peer-checked:bg-indigo-500 shadow-inner"></div>
                            </label>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                            <div className="p-8 bg-slate-50 rounded-[var(--radius)] border border-slate-100/50 shadow-inner">
                                <div className="flex items-center gap-3 mb-4">
                                    <Hash size={20} className="text-emerald-500" />
                                    <p className="text-lg font-black text-slate-800">Global Pagination</p>
                                </div>
                                <select
                                    value={settings.pagination_size}
                                    onChange={e => updateSetting('pagination_size', parseInt(e.target.value))}
                                    className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold text-slate-700 outline-none"
                                >
                                    <option value={10}>10 rows per page</option>
                                    <option value={15}>15 rows per page (Default)</option>
                                    <option value={25}>25 rows per page</option>
                                    <option value={50}>50 rows per page</option>
                                    <option value={100}>100 rows per page (Admin)</option>
                                </select>
                            </div>

                            <div className="p-8 bg-white rounded-[var(--radius)] border border-slate-100 shadow-xl">
                                <div className="flex items-center justify-between mb-8">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-blue-50 rounded-xl">
                                            <Type size={20} className="text-blue-500" />
                                        </div>
                                        <div>
                                            <p className="text-lg font-black text-slate-800 italic">Table Personality & Nomenclature</p>
                                            <p className="text-xs text-slate-400 font-medium italic">Type over the display label to rename column headers globally.</p>
                                        </div>
                                    </div>
                                    <select
                                        value={newMapping.page}
                                        onChange={e => setNewMapping({ ...newMapping, page: e.target.value })}
                                        className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-black text-slate-600 outline-none focus:ring-4 ring-blue-500/10 transition-all cursor-pointer"
                                    >
                                        <option value="customers">Customers Page</option>
                                        <option value="invoices">Invoices Page</option>
                                        <option value="worklist">AI Worklist</option>
                                    </select>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {(newMapping.page === 'customers' ? [
                                        { f: 'customer_code', d: 'ERP ID' },
                                        { f: 'customer_name', d: 'Customer' },
                                        { f: 'customer_category', d: 'Category' },
                                        { f: 'final_score', d: 'Score' },
                                        { f: 'cur', d: 'Utilization' },
                                        { f: 'open_ar_balance', d: 'Open AR' },
                                        { f: 'credit_limit', d: 'Credit Limit' },
                                        { f: 'score_date', d: 'Score Date' },
                                    ] : newMapping.page === 'invoices' ? [
                                        { f: 'invoice_number', d: 'Invoice #' },
                                        { f: 'customer_name', d: 'Customer' },
                                        { f: 'invoice_date', d: 'Inv Date' },
                                        { f: 'payment_terms', d: 'Terms' },
                                        { f: 'invoice_amount', d: 'Amount' },
                                        { f: 'outstanding_amount', d: 'Outstanding' },
                                        { f: 'status', d: 'Status' },
                                        { f: 'days_past_due', d: 'Days Late' },
                                    ] : [
                                        { f: 'suggested_action', d: 'AI Action' },
                                        { f: 'score', d: 'Risk Score' },
                                        { f: 'reasoning', d: 'AI Logic' },
                                    ]).map((def) => {
                                        const m = mappings.find(map => map.page === newMapping.page && map.field === def.f);
                                        const currentVal = m ? m.label : def.d;

                                        return (
                                            <div key={def.f} className="group p-5 bg-slate-50 rounded-2xl border border-slate-100 hover:bg-white hover:shadow-xl hover:border-blue-100 transition-all duration-300">
                                                <div className="flex items-center justify-between mb-3">
                                                    <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">{def.f}</span>
                                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                                </div>
                                                <input
                                                    type="text"
                                                    value={currentVal}
                                                    onChange={async (e) => {
                                                        const newVal = e.target.value;
                                                        const newMappings = [...mappings];
                                                        const idx = newMappings.findIndex(nm => nm.page === newMapping.page && nm.field === def.f);
                                                        if (idx >= 0) {
                                                            newMappings[idx] = { ...newMappings[idx], label: newVal };
                                                        } else {
                                                            newMappings.push({ page: newMapping.page, field: def.f, label: newVal });
                                                        }
                                                        setMappings(newMappings);

                                                        try {
                                                            await axios.post('/api/v1/ui-mapping/upsert', {
                                                                page_key: newMapping.page,
                                                                field_key: def.f,
                                                                display_name: newVal
                                                            });
                                                        } catch (err) {
                                                            console.error("Auto-save failed", err);
                                                        }
                                                    }}
                                                    className="w-full bg-transparent border-b border-slate-200 py-1.5 text-sm font-bold text-slate-700 focus:border-blue-500 outline-none transition-all placeholder:text-slate-300"
                                                    placeholder={def.d}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
