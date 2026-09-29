import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Atom, ArrowUp, LogOut, Menu, MessageSquarePlus, Orbit, Sparkles, X, Search, Trash2, UserRound, ArrowLeft, Check, Copy, Pin, PinOff, Pencil, Download, Printer, ListOrdered, FileText } from 'lucide-react'
import { supabase } from './supabase'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const planOptions = [
  { id: 'free', name: 'Free', cost: 'No cost', detail: '2 questions per account' },
  { id: 'questions_10', name: '10-question pack', cost: 'One-time plan', detail: '10 extra questions added to your balance' },
  { id: 'monthly', name: 'Monthly', cost: 'Monthly plan', detail: 'Unlimited questions for one month' },
  { id: 'yearly', name: 'Yearly', cost: 'Yearly plan', detail: 'Unlimited questions for one year' },
]

const suggestions = [
  { icon: Orbit, title: 'Space & time', question: 'Why does time slow down near a black hole?' },
  { icon: Sparkles, title: 'Quantum world', question: 'Explain quantum entanglement in simple terms.' },
  { icon: Atom, title: 'Solve a problem', question: 'How do I calculate escape velocity?' },
]

function AuthView() {
  const [mode, setMode] = useState('signin')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      const result = mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName.trim() } },
          })
      if (result.error) throw result.error
      if (mode === 'signup' && !result.data.session) setNotice('Your account was created. Check your inbox to confirm your email, then sign in.')
    } catch (err) { setError(err.message || 'Could not sign in.') }
    finally { setBusy(false) }
  }

  return <main className="auth-page">
    <div className="auth-glow" />
    <section className="auth-card">
      <Brand />
      <div className="auth-copy"><span className="kicker">A LITTLE MORE WONDER</span><h1>Physics,<br /><em>made clear.</em></h1><p>Big questions deserve beautiful explanations. Let’s explore.</p></div>
      <div className="auth-tabs"><button type="button" className={mode === 'signin' ? 'selected' : ''} onClick={() => { setMode('signin'); setError(''); setNotice('') }}>Sign in</button><button type="button" className={mode === 'signup' ? 'selected' : ''} onClick={() => { setMode('signup'); setError(''); setNotice('') }}>Create account</button></div>
      <form onSubmit={submit} className="auth-form">
        {mode === 'signup' && <label>Your name<input type="text" autoComplete="name" placeholder="Srishti Jaitly" required maxLength={80} value={fullName} onChange={e => setFullName(e.target.value)} /></label>}
        <label>Email address<input type="email" autoComplete="email" placeholder="you@example.com" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" minLength="8" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder="At least 8 characters" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        {error && <div className="form-message error">{error}</div>}{notice && <div className="form-message">{notice}</div>}
        <button className="primary-button" disabled={busy}>{busy ? 'One moment…' : mode === 'signin' ? 'Welcome back' : 'Create your account'} <ArrowUp size={17} /></button>
      </form>
      <p className="auth-foot">Your conversations are private and saved to your account.</p>
    </section>
    <div className="auth-orbit orbit-a" /><div className="auth-orbit orbit-b" />
  </main>
}

function Brand() { return <div className="brand"><div className="brand-mark"><Atom size={20} strokeWidth={1.7} /></div><span>Einstein<span className="brand-light">AI</span></span></div> }

export default function App() {
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [view, setView] = useState('chat')
  const [profileName, setProfileName] = useState('')
  const [profileNotice, setProfileNotice] = useState('')
  const [usage, setUsage] = useState(null)
  const [usageError, setUsageError] = useState('')
  const [historySearch, setHistorySearch] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState('')
  const [editingMessageId, setEditingMessageId] = useState('')
  const [showSteps, setShowSteps] = useState(() => localStorage.getItem('einsteinai-show-steps') === 'true')
  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const [chatSearch, setChatSearch] = useState('')
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => subscription.unsubscribe()
  }, [])

  const refreshConversations = useCallback(async () => {
    if (!session?.user) return
    const { data, error: dbError } = await supabase.from('conversations').select('id,title,updated_at,is_pinned').eq('user_id', session.user.id).order('is_pinned', { ascending: false }).order('updated_at', { ascending: false })
    if (dbError) setError(dbError.message)
    else setConversations(data || [])
  }, [session])

  useEffect(() => { refreshConversations() }, [refreshConversations])
  useEffect(() => {
    setProfileName(session?.user?.user_metadata?.full_name || '')
  }, [session?.user?.id, session?.user?.user_metadata?.full_name])

  const refreshUsage = useCallback(async () => {
    if (!session?.user?.id) { setUsage(null); return }
    const { data, error: dbError } = await supabase
      .from('account_usage')
      .select('questions_used,question_credits,question_credits_expires_at,plan_type,input_tokens,output_tokens,subscription_status,subscription_ends_at,created_at,updated_at')
      .eq('user_id', session.user.id)
      .maybeSingle()
    if (dbError) {
      setUsageError(dbError.message)
      return
    }
    if (!data) {
      setUsageError('No usage row exists yet. Run the subscription_usage.sql setup in Supabase.')
      return
    }
    setUsage(data)
    setUsageError('')
  }, [session?.user?.id])

  useEffect(() => { refreshUsage() }, [refreshUsage])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  const loadConversation = useCallback(async (id) => {
    setActiveId(id); setSidebarOpen(false); setError(''); setEditingMessageId(''); setInput(''); setChatSearch('')
    const { data, error: dbError } = await supabase.from('messages').select('id,role,content,created_at').eq('conversation_id', id).eq('user_id', session.user.id).order('created_at')
    if (dbError) setError(dbError.message)
    else setMessages(data || [])
  }, [session])

  const newConversation = useCallback(async () => {
    if (!session?.user) return
    const { data, error: dbError } = await supabase.from('conversations').insert({ user_id: session.user.id, title: 'New conversation' }).select('id,title,updated_at,is_pinned').single()
    if (dbError) { setError(dbError.message); return }
    setConversations(prev => [data, ...prev]); setActiveId(data.id); setMessages([]); setInput(''); setEditingMessageId(''); setChatSearch(''); setChatSearchOpen(false); setExportMenuOpen(false); setView('chat'); setSidebarOpen(false); inputRef.current?.focus()
  }, [session])

  useEffect(() => {
    function handleShortcut(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        newConversation()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [newConversation])

  async function deleteConversation(event, id) {
    event.stopPropagation()
    const { error: dbError } = await supabase.from('conversations').delete().eq('id', id).eq('user_id', session.user.id)
    if (dbError) { setError(dbError.message); return }
    setConversations(prev => prev.filter(item => item.id !== id))
    if (activeId === id) { setActiveId(null); setMessages([]) }
  }

  async function togglePin(event, conversation) {
    event.stopPropagation()
    const nextPinned = !conversation.is_pinned
    const { error: dbError } = await supabase.from('conversations').update({ is_pinned: nextPinned }).eq('id', conversation.id).eq('user_id', session.user.id)
    if (dbError) { setError(`Could not update pin: ${dbError.message}`); return }
    setConversations(prev => prev.map(item => item.id === conversation.id ? { ...item, is_pinned: nextPinned } : item)
      .sort((a, b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned))))
  }

  function startEditing(message) {
    setEditingMessageId(message.id)
    setInput(message.content)
    inputRef.current?.focus()
  }

  function cancelEditing() {
    setEditingMessageId('')
    setInput('')
  }

  async function copyAnswer(message) {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopiedMessageId(message.id)
      window.setTimeout(() => setCopiedMessageId(''), 1800)
    } catch {
      setError('Could not copy the answer. Check your browser clipboard permissions.')
    }
  }

  function exportConversation(format) {
    const title = conversations.find(item => item.id === activeId)?.title || 'EinsteinAI conversation'
    const text = messages.map(message => `${message.role === 'user' ? 'You' : 'EinsteinAI'}\n${message.content}`).join('\n\n------------------------------\n\n')
    if (!text.trim()) { setError('There are no messages to export yet.'); return }
    const safeTitle = title.replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-') || 'einsteinai-conversation'
    if (format === 'txt') {
      const blob = new Blob([`${title}\n\n${text}`], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = `${safeTitle}.txt`; link.click()
      URL.revokeObjectURL(url)
    } else {
      const popup = window.open('', '_blank')
      if (!popup) { setError('Allow pop-ups to print or save this conversation as a PDF.'); return }
      const escapeHtml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
      popup.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>body{font:15px/1.7 Arial,sans-serif;color:#172033;max-width:820px;margin:48px auto;padding:0 28px}h1{font-size:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.7 Arial,sans-serif}@media print{body{margin:18mm auto;padding:0}}</style></head><body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(text)}</pre></body></html>`)
      popup.document.close(); popup.focus(); window.setTimeout(() => popup.print(), 300)
    }
    setExportMenuOpen(false)
  }

  async function saveProfile(event) {
    event.preventDefault(); setSavingProfile(true); setProfileNotice('')
    const { error: updateError } = await supabase.auth.updateUser({ data: { full_name: profileName.trim() } })
    setSavingProfile(false)
    if (updateError) setProfileNotice(updateError.message)
    else setProfileNotice('Your name has been updated.')
  }

  async function sendQuestion(text = input) {
    const question = text.trim()
    if (!question || busy) return
    const beforeMessages = messages
    const targetIndex = editingMessageId ? beforeMessages.findIndex(message => message.id === editingMessageId) : -1
    const editTarget = targetIndex >= 0 ? beforeMessages[targetIndex] : null
    const historyMessages = editTarget ? beforeMessages.slice(0, targetIndex) : beforeMessages
    const temporaryUserMessage = editTarget
      ? { ...editTarget, content: question }
      : { id: crypto.randomUUID(), role: 'user', content: question }

    setBusy(true); setInput(''); setError(''); setEditingMessageId('')
    setMessages(editTarget ? [...historyMessages, temporaryUserMessage] : [...beforeMessages, temporaryUserMessage])
    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          question,
          show_steps: showSteps,
          history: historyMessages.slice(-12).map(({ role, content }) => ({ role, content })),
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'The assistant could not answer just now.')
      const assistantMessage = { id: crypto.randomUUID(), role: 'assistant', content: payload.answer }
      setMessages(current => [...current, assistantMessage])
      let conversationId = activeId
      try {
        if (!conversationId) {
          const { data, error: createError } = await supabase.from('conversations')
            .insert({ user_id: session.user.id, title: question.slice(0, 60) })
            .select('id,title,updated_at,is_pinned').single()
          if (createError) throw createError
          conversationId = data.id
          setActiveId(data.id)
        }

        let savedAssistant
        if (editTarget) {
          const laterIds = beforeMessages.slice(targetIndex + 1).map(message => message.id).filter(Boolean)
          const { error: updateError } = await supabase.from('messages').update({ content: question })
            .eq('id', editTarget.id).eq('user_id', session.user.id)
          if (updateError) throw updateError
          if (laterIds.length) {
            const { error: deleteError } = await supabase.from('messages').delete().in('id', laterIds).eq('conversation_id', conversationId).eq('user_id', session.user.id)
            if (deleteError) throw deleteError
          }
          const { data: inserted, error: insertError } = await supabase.from('messages').insert({
            conversation_id: conversationId, user_id: session.user.id, role: 'assistant', content: payload.answer,
          }).select('id,role,content,created_at')
          if (insertError) throw insertError
          savedAssistant = inserted[0]
          setMessages([...historyMessages, { ...editTarget, content: question }, savedAssistant])
        } else {
          const { data: inserted, error: insertError } = await supabase.from('messages').insert([
            { conversation_id: conversationId, user_id: session.user.id, role: 'user', content: question },
            { conversation_id: conversationId, user_id: session.user.id, role: 'assistant', content: payload.answer },
          ]).select('id,role,content,created_at')
          if (insertError) throw insertError
          setMessages(current => [...current.filter(message => message.id !== temporaryUserMessage.id && message.id !== assistantMessage.id), ...inserted])
        }
        const title = question.slice(0, 60) || 'Physics conversation'
        await supabase.from('conversations').update({ title, updated_at: new Date().toISOString() }).eq('id', conversationId).eq('user_id', session.user.id)
        setConversations(prev => {
          const oldConversation = prev.find(item => item.id === conversationId)
          return [{ id: conversationId, title, updated_at: new Date().toISOString(), is_pinned: oldConversation?.is_pinned || false }, ...prev.filter(item => item.id !== conversationId)]
            .sort((a, b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned)))
        })
      } catch (saveError) {
        setError(`Your answer arrived, but could not be saved to chat history: ${saveError.message}`)
      }
      refreshUsage()
    } catch (err) {
      setMessages(beforeMessages)
      setInput(question)
      if (editTarget) setEditingMessageId(editTarget.id)
      setError(err.message || 'Something went wrong. Please try again.')
    }
    finally { setBusy(false) }
  }

  async function logout() { await supabase.auth.signOut(); setConversations([]); setMessages([]); setActiveId(null); setView('chat') }

  const subscriptionIsActive = usage && ['active', 'canceling'].includes(usage.subscription_status)
    && (!usage.subscription_ends_at || new Date(usage.subscription_ends_at) > new Date())
  const freeRemaining = usage ? Math.max(0, 2 - Number(usage.questions_used || 0)) : null
  const creditExpiryPassed = usage?.question_credits_expires_at && new Date(usage.question_credits_expires_at) <= new Date()
  const currentCredits = creditExpiryPassed ? 0 : Number(usage?.question_credits || 0)
  const remainingQuestions = usage ? freeRemaining + currentCredits : null
  const activePlanName = usage?.plan_type === 'monthly' ? 'Monthly subscription' : usage?.plan_type === 'yearly' ? 'Yearly subscription' : 'Unlimited subscription'
  const currentPlanName = subscriptionIsActive ? activePlanName : currentCredits > 0 ? '10-question pack' : 'Free plan'
  const visibleMessages = chatSearch.trim() ? messages.filter(message => message.content.toLowerCase().includes(chatSearch.trim().toLowerCase())) : messages
  const pinnedConversations = conversations.filter(item => item.is_pinned && item.title.toLowerCase().includes(historySearch.toLowerCase()))
  const recentConversations = conversations.filter(item => !item.is_pinned && item.title.toLowerCase().includes(historySearch.toLowerCase()))
  const renderConversation = item => <div key={item.id} className={`conversation ${activeId === item.id ? 'active' : ''} ${item.is_pinned ? 'pinned' : ''}`}><button className="conversation-open" onClick={() => { setView('chat'); loadConversation(item.id) }}><span className="conversation-dot" /><span>{item.title}</span></button><button className="pin-chat" title={item.is_pinned ? 'Unpin conversation' : 'Pin conversation'} aria-label={item.is_pinned ? 'Unpin conversation' : 'Pin conversation'} onClick={event => togglePin(event, item)}>{item.is_pinned ? <PinOff size={13} /> : <Pin size={13} />}</button><button className="delete-chat" title="Delete conversation" aria-label={`Delete ${item.title}`} onClick={event => deleteConversation(event, item.id)}><Trash2 size={14} /></button></div>

  if (!authReady) return <div className="loading-page"><div className="loading-mark"><Atom /></div></div>
  if (!supabase) return <main className="setup-page"><Brand /><h1>One small setup step.</h1><p>Add your Supabase URL and publishable key to <code>.env</code>, then restart the development server.</p></main>
  if (!session) return <AuthView />

  return <main className="app-shell">
    {sidebarOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="side-top"><Brand /><button className="icon-button mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={19} /></button></div>
      <button className="new-chat" onClick={newConversation}><MessageSquarePlus size={17} /> New conversation <span>⌘ K</span></button>
      <div className="history-label">RECENT CONVERSATIONS</div>
      <label className="history-search"><Search size={14} /><input aria-label="Search conversations" placeholder="Search chats" value={historySearch} onChange={e => setHistorySearch(e.target.value)} /></label>
      <nav className="conversation-list">
        {pinnedConversations.length > 0 && <><div className="history-label pinned-label">PINNED</div>{pinnedConversations.map(renderConversation)}</>}
        {recentConversations.length > 0 && <><div className="history-label">RECENT</div>{recentConversations.map(renderConversation)}</>}
        {!conversations.length && <p className="empty-history">Your conversations will appear here.</p>}
        {!!conversations.length && !pinnedConversations.length && !recentConversations.length && <p className="empty-history">No conversations match that search.</p>}
      </nav>
      <div className="sidebar-plan"><div><span>{subscriptionIsActive ? (usage?.plan_type || 'UNLIMITED').toUpperCase() : currentCredits > 0 ? 'QUESTION PACK' : 'FREE PLAN'}</span><strong>{subscriptionIsActive ? 'Unlimited questions' : usage ? `${remainingQuestions} questions available` : 'Usage loading…'}</strong></div><button onClick={() => { setView('profile'); refreshUsage(); setSidebarOpen(false) }} aria-label="View plan and usage"><ArrowUp size={15} /></button></div>
      <div className="sidebar-bottom"><div className="user-avatar">{(session.user.user_metadata?.full_name || session.user.email || 'S')[0].toUpperCase()}</div><div className="user-meta"><strong>{session.user.user_metadata?.full_name || session.user.email?.split('@')[0]}</strong><span>{session.user.email}</span></div><button className={`icon-button profile-button ${view === 'profile' ? 'selected' : ''}`} onClick={() => { setView('profile'); refreshUsage(); setProfileNotice(''); setSidebarOpen(false) }} aria-label="Profile" title="Profile"><UserRound size={17} /></button><button className="icon-button logout-button" onClick={logout} aria-label="Log out" title="Log out"><LogOut size={17} /></button></div>
    </aside>
    <section className="chat-area">
      <header className="topbar"><button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={20} /></button><div className="topbar-title"><span className="status-dot" /> EINSTEINAI <span className="topbar-divider">/</span> {view === 'profile' ? 'YOUR PROFILE' : 'PHYSICS ASSISTANT'}</div><div className="topbar-tools">{view === 'chat' && <><button className={`tool-button ${showSteps ? 'active' : ''}`} onClick={() => setShowSteps(value => { const next = !value; localStorage.setItem('einsteinai-show-steps', String(next)); return next })} title="Toggle step-by-step answers"><ListOrdered size={14} /><span>Steps {showSteps ? 'on' : 'off'}</span></button><button className={`tool-button ${chatSearchOpen ? 'active' : ''}`} onClick={() => { setChatSearchOpen(value => !value); setChatSearch('') }} title="Search this conversation"><Search size={14} /><span>Find</span></button><div className="export-control"><button className={`tool-button ${exportMenuOpen ? 'active' : ''}`} onClick={() => setExportMenuOpen(value => !value)} disabled={!messages.length}><Download size={14} /><span>Export</span></button>{exportMenuOpen && <div className="export-menu"><button onClick={() => exportConversation('txt')}><FileText size={14} /> Download text</button><button onClick={() => exportConversation('pdf')}><Printer size={14} /> Print / Save as PDF</button></div>}</div></>}<div className="topbar-right">BUILT FOR CURIOSITY <Atom size={16} /></div></div></header>
      {chatSearchOpen && view === 'chat' && <div className="chat-search-bar"><Search size={15} /><input autoFocus value={chatSearch} onChange={event => setChatSearch(event.target.value)} placeholder="Search in this conversation…" aria-label="Search in this conversation" /><span>{chatSearch ? `${visibleMessages.length} match${visibleMessages.length === 1 ? '' : 'es'}` : 'Search messages'}</span><button onClick={() => { setChatSearchOpen(false); setChatSearch('') }} aria-label="Close search"><X size={15} /></button></div>}
      {view === 'profile' ? <div className="profile-scroll"><section className="profile-card profile-card-wide">
        <button className="profile-back" onClick={() => setView('chat')}><ArrowLeft size={15} /> Back to chat</button>
        <div className="profile-avatar"><UserRound size={27} /></div>
        <div className="kicker">YOUR ACCOUNT</div><h1>Profile &amp; usage</h1><p>Your account details, plan, and AI usage in one place.</p>
        <form className="auth-form profile-form" onSubmit={saveProfile}>
          <label>Display name<input value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="Your name" maxLength={80} required /></label>
          <label>Email address<input value={session.user.email || ''} readOnly /></label>
          <div className="account-created">Account created {session.user.created_at ? new Date(session.user.created_at).toLocaleDateString() : '—'}</div>
          {profileNotice && <div className={`form-message ${profileNotice.includes('updated') ? '' : 'error'}`}>{profileNotice}</div>}
          <button className="primary-button" disabled={savingProfile || !profileName.trim()}>{savingProfile ? 'Saving…' : 'Save profile'}{!savingProfile && <Check size={16} />}</button>
        </form>
        <div className="usage-section">
          <div className="usage-heading"><div><span className="kicker">YOUR PLAN</span><h2>{currentPlanName}</h2></div><span className={`plan-badge ${subscriptionIsActive ? 'premium' : currentCredits > 0 ? 'premium' : ''}`}>{subscriptionIsActive ? 'ACTIVE' : currentCredits > 0 ? 'CREDITS' : 'FREE'}</span></div>
          {subscriptionIsActive && <p className="subscription-validity">{usage.subscription_ends_at ? `Subscription active until ${new Date(usage.subscription_ends_at).toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Subscription active · no end date set'}</p>}
          {!subscriptionIsActive && currentCredits > 0 && usage?.question_credits_expires_at && <p className="subscription-validity credit-validity">10-question pack active until {new Date(usage.question_credits_expires_at).toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.</p>}
          {usage ? <>
            <div className="question-meter-label"><span>Questions used</span><strong>{subscriptionIsActive ? `${usage.questions_used} total` : `${Math.min(2, usage.questions_used)} / 2`}</strong></div>
            {!subscriptionIsActive && <div className="question-meter"><span style={{ width: `${Math.min(100, (Number(usage.questions_used) / 2) * 100)}%` }} /></div>}
            <div className="usage-stats">
              <div className="usage-stat"><span>Questions remaining</span><strong>{subscriptionIsActive ? 'Unlimited' : remainingQuestions}</strong></div>
              <div className="usage-stat"><span>Total tokens</span><strong>{(Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0)).toLocaleString()}</strong></div>
              <div className="usage-stat"><span>Tokens sent</span><strong>{Number(usage.input_tokens || 0).toLocaleString()}</strong></div>
              <div className="usage-stat"><span>Tokens received</span><strong>{Number(usage.output_tokens || 0).toLocaleString()}</strong></div>
            </div>
            <p className="usage-caption">Free accounts include two questions. The 10-question pack uses your question credit balance. Monthly and yearly plans have unlimited questions until the expiry date shown in your account record.</p>
          </> : <p className="usage-caption">{usageError || 'Loading your usage…'}</p>}
          <div className="plan-options-section">
            <div className="plan-options-heading"><span className="kicker">AVAILABLE PLANS</span><p>Choose a plan to discuss with the EinsteinAI administrator.</p></div>
            <div className="plan-options-grid">{planOptions.map(plan => {
              const isCurrent = plan.id === 'free'
                ? !subscriptionIsActive && currentCredits === 0
                : plan.id === 'questions_10'
                  ? !subscriptionIsActive && currentCredits > 0
                  : subscriptionIsActive && usage?.plan_type === plan.id
              return <article className={`plan-option-card ${isCurrent ? 'current' : ''}`} key={plan.id}>
                <div className="plan-option-top"><h3>{plan.name}</h3>{isCurrent && <span className="plan-current">CURRENT</span>}</div>
                <strong className="plan-option-price">{plan.cost}</strong>
                <p>{plan.detail}</p>
              </article>
            })}</div>
            <div className="manual-plan-note">Plan options are shown here for reference. The administrator activates or changes a plan manually in Supabase; this page does not take payments.</div>
          </div>
          {usageError && usage && <div className="form-message error">Usage refresh failed: {usageError}</div>}
        </div>
        <div className="profile-note">Your account details and usage are private. Conversations are saved to your account.</div>
      </section></div> : <>
      <div className={`chat-scroll ${messages.length ? 'has-messages' : ''}`}>
        {!messages.length ? <div className="welcome">
          <div className="welcome-icon"><Atom size={30} strokeWidth={1.4} /></div>
          <div className="kicker">YOUR PERSONAL PHYSICS ASSISTANT</div>
          <h1>Where curiosity<br />meets <em>clarity.</em></h1>
          <p>From the tiniest particles to the farthest stars,<br className="desktop-break" /> let’s make sense of the universe together.</p>
          <div className="suggestion-grid">{suggestions.map(({ icon: Icon, title, question }) => <button key={title} className="suggestion" onClick={() => sendQuestion(question)}><span className="suggestion-icon"><Icon size={17} /></span><span><strong>{title}</strong><small>{question}</small></span><ArrowUp className="suggestion-arrow" size={15} /></button>)}</div>
        </div> : <div className="messages">{chatSearch && <div className="search-summary">Showing {visibleMessages.length} of {messages.length} messages</div>}{visibleMessages.map(msg => <article className={`message-row ${msg.role}`} key={msg.id}><div className={`message-avatar ${msg.role}`}>{msg.role === 'assistant' ? <Atom size={17} /> : session.user.email?.[0]?.toUpperCase()}</div><div className="message-body"><div className="message-label">{msg.role === 'assistant' ? 'EINSTEINAI' : 'YOU'}</div><div className="markdown"><ReactMarkdown>{msg.content}</ReactMarkdown></div>{msg.role === 'assistant' && <button className="copy-answer" onClick={() => copyAnswer(msg)} aria-label="Copy answer" title="Copy answer">{copiedMessageId === msg.id ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy answer</>}</button>}{msg.role === 'user' && !chatSearch && <button className="edit-question" onClick={() => startEditing(msg)} disabled={busy} title="Edit and resend this question"><Pencil size={13} /> Edit &amp; resend</button>}</div></article>)}{chatSearch && visibleMessages.length === 0 && <div className="no-search-results">No messages match “{chatSearch}”.</div>}{!chatSearch && !busy && messages[messages.length - 1]?.role === 'assistant' && <div className="followup-box"><div className="followup-heading"><Sparkles size={14} /><span>CONTINUE EXPLORING</span></div><div className="followup-actions"><button onClick={() => sendQuestion('Can you explain that more simply?')}>Explain it simply <ArrowUp size={12} /></button><button onClick={() => sendQuestion('Can you give me a real-world example of that?')}>Give me an example <ArrowUp size={12} /></button><button onClick={() => sendQuestion('Can you show the relevant equation and explain its terms?')}>Show the equation <ArrowUp size={12} /></button></div></div>}{busy && <article className="message-row assistant"><div className="message-avatar assistant"><Atom size={17} /></div><div className="message-body"><div className="message-label">EINSTEINAI</div><div className="thinking"><i /><i /><i /> <span>Thinking through the physics</span></div></div></article>}<div ref={bottomRef} /></div>}
      </div>
      <div className="composer-wrap">
        {error && <div className="inline-error">{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}
        {editingMessageId && <div className="editing-banner"><Pencil size={13} /> Editing a question. Resending replaces this question and the replies after it.<button type="button" onClick={cancelEditing}>Cancel</button></div>}
        <form className="composer" onSubmit={e => { e.preventDefault(); sendQuestion() }}><textarea ref={inputRef} rows="1" placeholder={editingMessageId ? 'Edit your question…' : 'Ask anything about physics…'} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuestion() } }} /><button className="send-button" type="submit" disabled={!input.trim() || busy} aria-label="Send message">{busy ? <div className="mini-spinner" /> : <ArrowUp size={18} />}</button><div className="composer-hint">{subscriptionIsActive ? 'Unlimited plan · ' : usage ? `${remainingQuestions} questions available · ` : ''}EinsteinAI can make mistakes. Check important physics with a trusted source.</div></form>
      </div>
      </>}
    </section>
  </main>
}
