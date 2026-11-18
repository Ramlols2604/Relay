import { useId } from 'react'
import { Link } from 'react-router'
import { GlassCard } from '../components/GlassCard.tsx'

export function AboutPage() {
  const headingId = useId()

  return (
    <section className="about-page" aria-labelledby={headingId}>
      <GlassCard tone="strong" className="about-hero">
        <p className="eyebrow">How Relay works</p>
        <h1 id={headingId} className="about-title">
          Share tools with people in your city
        </h1>
        <p className="about-lead">
          Relay is a neighborhood lending app. You list what you can lend, ask for what you need, and
          match with people who listed the same city on their profile. Loans stay in-app — no public
          phone numbers or emails are shared.
        </p>
      </GlassCard>

      <GlassCard tone="solid" className="about-section">
        <h2>Quick start</h2>
        <ol className="about-list about-list-ordered">
          <li>Verify your street address in Edit profile so you appear on the map.</li>
          <li>Add items on My Inventory and leave “Available to lend” on.</li>
          <li>
            In Chat, ask something like “I want a ladder, who is the closest with it?” or offer “I
            have a drill to lend.”
          </li>
          <li>Accept or advance loans on Activity. Track pickup and return there too.</li>
        </ol>
      </GlassCard>

      <GlassCard tone="solid" className="about-section">
        <h2>What each tab is for</h2>
        <ul className="about-list">
          <li>
            <strong>Chat</strong> — projects, needs, offers, and “closest lender” searches. Use New
            chat / Reset to clear the thread, and Edit on your last message to rewrite it.
          </li>
          <li>
            <strong>My Inventory</strong> — your shelf: quantities, condition, notes, and whether
            neighbors can request each item.
          </li>
          <li>
            <strong>Map</strong> (home) — Mapbox map plus optional 3D town. Search radius, demo
            listing pins, and neighbor markers live here.
          </li>
          <li>
            <strong>Activity</strong> — active and completed loans, handoffs, and shared demand /
            group buys.
          </li>
          <li>
            <strong>About</strong> — this guide.
          </li>
        </ul>
      </GlassCard>

      <GlassCard tone="solid" className="about-section">
        <h2>Your address matters</h2>
        <p>
          On first sign-in, Relay asks for your street and city. Matching, the map, and the 3D
          neighborhood only show people who share that city and have a verified address. Edit street,
          city, and about-you anytime from Edit profile. Email and password stay in Clerk (avatar
          menu).
        </p>
        <p>
          The map centers on your verified coordinates when available. If Mapbox cannot geocode an
          address, Relay falls back to a demo backdrop and tells you why.
        </p>
      </GlassCard>

      <GlassCard tone="solid" className="about-section">
        <h2>Loans and privacy</h2>
        <p>
          When Chat finds a real neighbor, use Request to borrow. That creates an in-app loan request
          the lender can accept — Relay never exposes their email, phone, or exact street in chat
          cards. Demo listings are labeled clearly and cannot be contacted or borrowed.
        </p>
      </GlassCard>

      <GlassCard tone="glass" className="about-section">
        <h2>Demo neighbors vs demo listings</h2>
        <p>
          <strong>Demo neighbors</strong> (Willow Court / Charlotte) fill empty towns in the 3D view
          for local testing. A real signed-in account does not show the fictional Willow Court banner.
        </p>
        <p>
          <strong>Demo listings</strong> are up to ~100,000 generated pins across US cities (denser
          clusters near the largest metros) so a 2-mile search is rarely empty. They are labeled
          “Demo listing”, never enter real loans, and stay out of the admin people list.
        </p>
        <p>
          City locations for those pins come from{' '}
          <a href="https://www.geonames.org/" rel="noreferrer" target="_blank">
            GeoNames
          </a>{' '}
          (cities15000), under{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer" target="_blank">
            CC BY 4.0
          </a>
          . Item names and offsets are Relay sample data, not real offers.
        </p>
      </GlassCard>

      <GlassCard tone="solid" className="about-section">
        <h2>Open a page</h2>
        <p className="about-links">
          <Link to="/">Map</Link>
          {' · '}
          <Link to="/chat">Chat</Link>
          {' · '}
          <Link to="/my-stuff">My Inventory</Link>
          {' · '}
          <Link to="/activity">Activity</Link>
        </p>
      </GlassCard>
    </section>
  )
}
