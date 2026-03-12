import axios from 'axios'

const api = axios.create({ baseURL: '/api/v1' })

// --- Customers ---
export const getCustomers    = (p) => api.get('/customers', { params: p })
export const getCustomer     = (id) => api.get(`/customers/${id}`)
export const createCustomer  = (d) => api.post('/customers', d)
export const updateCustomer  = (id, d) => api.patch(`/customers/${id}`, d)

// --- Invoices ---
export const getInvoices     = (p) => api.get('/invoices', { params: p })
export const getInvoice      = (id) => api.get(`/invoices/${id}`)
export const createInvoice   = (d) => api.post('/invoices', d)
export const updateInvoice   = (id, d) => api.patch(`/invoices/${id}`, d)

// --- Payments ---
export const getPayments     = (p) => api.get('/payments', { params: p })
export const createPayment   = (d) => api.post('/payments', d)

// --- Scores ---
export const getPortfolio    = () => api.get('/scores/portfolio')
export const getCustomerScore= (id) => api.get(`/scores/customer/${id}`)
export const computeAll      = () => api.post('/scores/compute-all')

// --- Collections ---
export const getCollections  = (id) => api.get(`/collections/customer/${id}`)
export const createCollection= (d) => api.post('/collections', d)
export const updateOutcome   = (id, d) => api.patch(`/collections/${id}/outcome`, d)

// --- Dunning Config ---
export const getDunningConfigs  = () => api.get('/dunning-config')
export const getActiveConfig    = () => api.get('/dunning-config/active')
export const createDunningConfig= (d) => api.post('/dunning-config', d)
export const activateConfig     = (id) => api.post(`/dunning-config/${id}/activate`)
export const addLadder          = (id, d) => api.post(`/dunning-config/${id}/ladders`, d)
export const deleteLadder       = (id, key) => api.delete(`/dunning-config/${id}/ladders/${key}`)

// --- Templates ---
export const getTemplates    = (p) => api.get('/templates', { params: p })
export const getTemplate     = (id) => api.get(`/templates/${id}`)
export const createTemplate  = (d) => api.post('/templates', d)
export const updateTemplate  = (id, d) => api.patch(`/templates/${id}`, d)
export const deleteTemplate  = (id) => api.delete(`/templates/${id}`)
export const previewTemplate = (id) => api.post(`/templates/${id}/preview`)
export const getTokens       = () => api.get('/templates/tokens')

// --- Dunning ---
export const evaluateInvoice   = (id, dry) => api.post(`/dunning/evaluate/invoice/${id}`, null, { params: { dry_run: dry } })
export const evaluateCustomer  = (id, dry) => api.post(`/dunning/evaluate/customer/${id}`, null, { params: { dry_run: dry } })
export const evaluatePortfolio = (dry) => api.post('/dunning/evaluate/portfolio', null, { params: { dry_run: dry } })
export const getDunningLog     = (id) => api.get(`/dunning/log/customer/${id}`)
export const getPortfolioLog   = () => api.get('/dunning/log/portfolio')

// --- Email Config ---
export const getEmailConfigs   = () => api.get('/email-config')
export const getActiveEmail    = () => api.get('/email-config/active')
export const createEmailConfig = (d) => api.post('/email-config', d)
export const updateEmailConfig = (id, d) => api.patch(`/email-config/${id}`, d)
export const activateEmail     = (id) => api.post(`/email-config/${id}/activate`)
export const testSmtp          = (id) => api.post(`/email-config/${id}/test`)

// --- Currency ---
export const getRates          = (p) => api.get('/currency', { params: p })
export const getLatestRate     = (from, to) => api.get('/currency/latest', { params: { from_currency: from, to_currency: to } })
export const createRate        = (d) => api.post('/currency', d)
export const updateRate        = (id, d) => api.patch(`/currency/${id}`, d)
export const deleteRate        = (id) => api.delete(`/currency/${id}`)
export const convertAmount     = (p) => api.post('/currency/convert', null, { params: p })

// --- Import Mapping ---
export const getMappings       = (p) => api.get('/import-mapping', { params: p })
export const createMapping     = (d) => api.post('/import-mapping', d)
export const updateMapping     = (id, d) => api.patch(`/import-mapping/${id}`, d)
export const deleteMapping     = (id) => api.delete(`/import-mapping/${id}`)
export const getTargetFields   = () => api.get('/import-mapping/targets')
export const getTransformRules = () => api.get('/import-mapping/transforms')
export const validateFile      = (name, table, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post('/import-mapping/validate', fd, { params: { mapping_name: name, target_table: table } })
}
export const importFile        = (name, table, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post('/import-mapping/import', fd, { params: { mapping_name: name, target_table: table } })
}
export const getImportLog      = (limit) => api.get('/import-mapping/import-log', { params: { limit } })

// --- AR Ledger ---
export const getArLedger       = (id, ccy) => api.get(`/ar-ledger/customer/${id}`, { params: { reporting_currency: ccy } })
export const sendArLedger      = (id, p) => api.post(`/ar-ledger/customer/${id}/send`, null, { params: p })
export const arLedgerPdfUrl    = (id, ccy) => `/api/v1/ar-ledger/customer/${id}/pdf${ccy ? `?reporting_currency=${ccy}` : ''}`
export const arLedgerExcelUrl  = (id, ccy) => `/api/v1/ar-ledger/customer/${id}/excel${ccy ? `?reporting_currency=${ccy}` : ''}`

// --- Predictions ---
export const getGlobalCashflow    = () => api.get('/predictions/cashflow')
export const getCustomerPredictions = (id) => api.get(`/predictions/customer/${id}`)
export const getAgingSummary      = () => api.get('/scores/portfolio/aging-summary')

// --- AI Chat (M9) ---
export const sendAiMessage = (payload) => api.post('/ai-chat/chat', payload)