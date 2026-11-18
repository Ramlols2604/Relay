import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import '../../src/styles/index.css'
import { RelayWorld } from '../../src/components/RelayWorld.tsx'
import { AdminPage } from '../../src/pages/AdminPage.tsx'
import { ActivityPage } from '../../src/pages/ActivityPage.tsx'
import { ChatPage } from '../../src/pages/ChatPage.tsx'
import { NeighborhoodPage } from '../../src/pages/NeighborhoodPage.tsx'
import { ActivityFeedProvider } from '../../src/state/activityFeed.tsx'
import { HandoffsProvider } from '../../src/state/handoffs.tsx'
import { LoanRequestsProvider } from '../../src/state/loanRequests.tsx'
import { ShelfResidentProvider } from '../../src/state/shelfResident.tsx'
import { AddressShell } from './AddressShell.tsx'
import { CacheShell } from './CacheShell.tsx'

window.__RELAY_E2E__ = true

const path = location.pathname

/** The real pages and providers, talking to a real backend, viewed as the demo resident. */
createRoot(document.getElementById('root')!).render(
  path.startsWith('/cache-shell') ? (
    <CacheShell />
  ) : path.startsWith('/address-shell') ? (
    <AddressShell />
  ) : (
    <ShelfResidentProvider residentId="avery">
      <ActivityFeedProvider>
        <LoanRequestsProvider>
          <HandoffsProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/world" element={<RelayWorld />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/neighborhood" element={<NeighborhoodPage />} />
                <Route path="*" element={<ActivityPage />} />
              </Routes>
            </BrowserRouter>
          </HandoffsProvider>
        </LoanRequestsProvider>
      </ActivityFeedProvider>
    </ShelfResidentProvider>
  ),
)
