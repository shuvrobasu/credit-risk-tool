import React, { useState, useRef, useEffect } from 'react'
import { MessageSquare, X, Send, Database, Loader, Minus } from 'lucide-react'
import { sendAiMessage } from '../api'

export default function AiChatAssistant() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState([{ role: "assistant", content: "Hi! I'm your AI Knowledge Assistant. How can I help you analyze credit health today?" }])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  
  const bottomRef = useRef(null)
  
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen])

  const handleSend = async (e) => {
    e?.preventDefault()
    if (!input.trim() || loading) return
    
    const userMsg = { role: "user", content: input }
    setMessages(prev => [...prev, userMsg])
    setInput("")
    setLoading(true)
    
    const context = [...messages, userMsg].filter(m => !m.is_tool_progress)

    try {
      const res = await sendAiMessage({ messages: context })
      const aiReply = res.data.message
      
      if (res.data.tool_executed) {
        setMessages(prev => [...prev, { role: "assistant", content: "Querying PostgreSQL...", is_tool_progress: true }, aiReply])
      } else {
        setMessages(prev => [...prev, aiReply])
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err.response?.data?.detail || err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 bg-blue-600 text-white p-4 rounded-full shadow-xl hover:bg-blue-700 transition shadow-blue-500/20 z-50 flex items-center justify-center"
      >
        <MessageSquare className="w-6 h-6" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 w-[400px] h-[600px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col z-50 overflow-hidden text-sm">
      {/* Header */}
      <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between shadow-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center shadow-inner">
            <MessageSquare className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-100 uppercase tracking-wider text-xs">CreditTool AI</h3>
            <p className="text-[10px] text-slate-400">Local Knowledge Assistant</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white transition bg-slate-800 p-1.5 rounded-full" title="Minimize">
            <Minus className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-5 bg-slate-50 space-y-4">
        {messages.map((m, i) => {
          if (m.is_tool_progress) {
            return (
              <div key={i} className="flex justify-start">
                <div className="bg-slate-200 text-slate-600 px-3 py-2 rounded-xl text-xs flex items-center gap-2 border border-slate-300">
                  <Database className="w-3 h-3 animate-pulse text-indigo-500" />
                  {m.content}
                </div>
              </div>
            )
          }
          
          const isUser = m.role === "user"
          return (
            <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-4 py-3 ${
                isUser 
                  ? 'bg-slate-800 text-white rounded-lg rounded-br-sm shadow-md shadow-slate-800/20' 
                  : 'bg-white text-slate-700 border border-slate-200 rounded-2xl rounded-bl-sm shadow-sm'
              }`}>
                {m.content}
              </div>
            </div>
          )
        })}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-bl-none shadow-sm flex items-center gap-2 text-slate-500">
              <Loader className="w-4 h-4 animate-spin text-blue-600" />
              Thinking...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      
      {/* Input */}
      <div className="p-4 bg-white border-t border-slate-200">
        <form onSubmit={handleSend} className="flex gap-2 relative">
          <input 
            type="text" 
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={loading}
            placeholder="Ask about risk profiles, global AR..."
            className="flex-1 bg-slate-50 border border-slate-200 rounded-full px-5 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500/50 shadow-inner"
          />
          <button 
            type="submit" 
            disabled={!input.trim() || loading}
            className="absolute right-1 top-1 bottom-1 aspect-square bg-blue-600 text-white rounded-full flex items-center justify-center hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition shadow-sm"
          >
            <Send className="w-4 h-4 ml-0.5" />
          </button>
        </form>
        <div className="mt-2 text-center">
          <p className="text-[9px] text-slate-400 tracking-wide">
            AI can make mistakes. Please verify important financial data manually.
          </p>
        </div>
      </div>
    </div>
  )
}
