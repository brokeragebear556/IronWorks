import { NavLink, Outlet, Route, Routes } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api, useAnalytics, useLibrary } from './api'
import { UndoButton } from './components/UndoButton'
import { DashboardPage } from './pages/DashboardPage'
import { GunPage } from './pages/GunPage'
import { LibraryPage } from './pages/LibraryPage'
import { SettingsPage } from './pages/SettingsPage'

function Shell() {
  const { data: lib, error } = useLibrary()
  const { data: a } = useAnalytics()
  const alerts = a?.prices.alerts.length ?? 0
  const { data: net } = useQuery({ queryKey: ['network'], queryFn: api.network, staleTime: 60_000 })
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand"><img src="/favicon.svg" alt="" />Ironworks</NavLink>
        <nav className="topnav" aria-label="Main">
          <NavLink to="/" end>Library</NavLink>
          <NavLink to="/gun">Bench</NavLink>
          <NavLink to="/dashboard">Dashboard{alerts ? <span className="pill ok" style={{ marginLeft: 6 }}>{alerts}</span> : null}</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <span className="spacer" />
        <UndoButton />
        {net && !net.thisComputer && <form method="post" action="/logout"><button type="submit" className="btn ghost">Sign out</button></form>}
      </header>
      {error && <div className="banner bad">{(error as Error).message}</div>}
      {lib && lib.errors.length > 0 && <div className="banner warn"><b>Some files could not be read:</b> {lib.errors.join(' · ')}</div>}
      <main className="page"><Outlet /></main>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<LibraryPage />} />
        <Route path="gun" element={<GunPage />} />
        <Route path="gun/:gunId" element={<GunPage />} />
        <Route path="gun/:gunId/part/:partId" element={<GunPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/:section" element={<SettingsPage />} />
        <Route path="*" element={<div className="page-pad"><h1>Not found</h1><p className="note"><NavLink to="/">Back to the library</NavLink></p></div>} />
      </Route>
    </Routes>
  )
}
