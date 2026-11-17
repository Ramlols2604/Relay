import { createRoot } from 'react-dom/client'
import '../../src/styles/index.css'
import { ActivityPage } from '../../src/pages/ActivityPage.tsx'
import { ActivityFeedProvider } from '../../src/state/activityFeed.tsx'
import { HandoffsProvider } from '../../src/state/handoffs.tsx'
import { LoanRequestsProvider } from '../../src/state/loanRequests.tsx'
import { ShelfResidentProvider } from '../../src/state/shelfResident.tsx'

/** The real Activity page and providers, talking to a real backend, viewed as the demo resident. */
createRoot(document.getElementById('root')!).render(
  <ShelfResidentProvider residentId="avery">
    <ActivityFeedProvider>
      <LoanRequestsProvider>
        <HandoffsProvider>
          <ActivityPage />
        </HandoffsProvider>
      </LoanRequestsProvider>
    </ActivityFeedProvider>
  </ShelfResidentProvider>,
)
