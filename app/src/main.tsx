import { StrictMode, useCallback, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthGuard, useCurrentUser } from 'lemma-sdk/react'
import {
  BookOpen, CircleDot, GitPullRequest, MessagesSquare, Moon, Plug, Radio, Sun, Users,
  Terminal as TerminalIcon, Timer,
} from 'lucide-react'
import { lemmaClient } from './lemma-client'
import { AppProvider, useApp } from './lib/app-context'
import { useRoute, routeParts } from './lib/router'
import { useTheme } from './lib/theme'
import { RepoPicker } from './components/RepoPicker'
import { Home } from './routes/Home'
import { Signals } from './routes/Signals'
import { PullRequests } from './routes/PullRequests'
import { Issues } from './routes/Issues'
import { Conversations } from './routes/Conversations'
import { Automations } from './routes/Automations'
import { Connections } from './routes/Connections'
import { HowItWorks } from './routes/HowItWorks'
import { People } from './routes/People'
import './styles.css'

const queryClient = new QueryClient()

const NAV = [
  { id: 'home', label: 'Code', icon: TerminalIcon, group: 'The pod' },
  { id: 'signals', label: 'Signals', icon: Radio, group: 'The pod' },
  { id: 'conversations', label: 'Conversations', icon: MessagesSquare, group: 'The pod' },
  { id: 'automations', label: 'Automations', icon: Timer, group: 'The pod' },
  { id: 'pulls', label: 'Pull requests', icon: GitPullRequest, group: 'GitHub' },
  { id: 'issues', label: 'Issues', icon: CircleDot, group: 'GitHub' },
  { id: 'people', label: 'People', icon: Users, group: 'Setup' },
  { id: 'how', label: 'How it works', icon: BookOpen, group: 'Setup' },
  { id: 'connections', label: 'Connections', icon: Plug, group: 'Setup' },
] as const

function Rail({ view, go }: { view: string; go: (to: string) => void }) {
  const { user } = useCurrentUser({ client: lemmaClient })
  const { orgError, live } = useApp()
  const [theme, toggleTheme] = useTheme()

  let lastGroup = ''
  return (
    <nav className="rail" aria-label="Sections">
      <div className="brand">
        <span className="mark"><Radio size={14} /></span>
        <span>Shipyard</span>
      </div>
      <RepoPicker />
      <div className="nav">
        {NAV.map((item) => {
          const head = item.group !== lastGroup ? item.group : null
          lastGroup = item.group
          const Icon = item.icon
          return (
            <div key={item.id}>
              {head && <div className="group">{head}</div>}
              <a href={`#/${item.id}`} aria-current={view === item.id ? 'page' : undefined}
                onClick={(e) => { e.preventDefault(); go(item.id) }}>
                <span className="ico" aria-hidden="true"><Icon size={15} /></span>
                <span>{item.label}</span>
              </a>
            </div>
          )
        })}
      </div>
      <div className="rail-foot">
        <button className="themetoggle" onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
        <span className="live" data-s={live}>
          <i />{live === 'open' ? 'live' : live === 'reconnecting' ? 'reconnecting'
            : live === 'connecting' ? 'connecting' : 'offline'}
        </span>
        {orgError && <span style={{ color: 'var(--high)' }}>no org context</span>}
        <span className="who">{[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || 'signed in'}</span>
      </div>
    </nav>
  )
}

function Shell() {
  const [route, go] = useRoute()
  const { view, id } = routeParts(route)

  useEffect(() => {
    if (!window.location.hash) window.location.hash = '#/home'
  }, [])

  const openConversation = useCallback((id: string) => {
    go(`conversations/${id}`)
  }, [go])

  return (
    <div className="shell">
      <Rail view={view} go={go} />
      <div className="main">
        {view === 'home' && <Home go={go} onOpenConversation={openConversation} />}
        {view === 'signals' && <Signals id={id} go={go} />}
        {view === 'pulls' && <PullRequests id={id} go={go} />}
        {view === 'issues' && <Issues id={id} go={go} />}
        {view === 'conversations' && <Conversations id={id} go={go} />}
        {view === 'automations' && <Automations />}
        {view === 'people' && <People />}
        {view === 'how' && <HowItWorks go={go} />}
        {view === 'connections' && <Connections />}
      </div>
    </div>
  )
}

/* Vite re-executes this module on every hot update. Calling `createRoot` again
   on a container that already has one tears the whole tree down and builds it
   back — which is what makes the app look like it is refreshing constantly in
   dev, and it takes every socket and in-flight request with it. Keep one root. */
const container = document.getElementById('root')!
type RootHolder = { __shipyardRoot?: ReturnType<typeof createRoot> }
const holder = window as unknown as RootHolder
const root = holder.__shipyardRoot ?? (holder.__shipyardRoot = createRoot(container))

root.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGuard client={lemmaClient}>
        <AppProvider>
          <Shell />
        </AppProvider>
      </AuthGuard>
    </QueryClientProvider>
  </StrictMode>,
)
