
  # VoteCore Online Voting Platform

  This is a code bundle for VoteCore Online Voting Platform. The original project is available at https://www.figma.com/design/z6ItKAs4tMDqj1CXnQdJrm/VoteCore-Online-Voting-Platform.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.

  ## Security notes

  ### Auth token storage (known tradeoff)

  The session JWT is stored in `localStorage` (see `src/lib/api.tsx`,
  `getToken`/`setToken`), not in an httpOnly cookie. This is a deliberate
  tradeoff for a voting application and worth calling out explicitly:

  - **Risk:** any successful XSS on this origin can read `localStorage` and
    exfiltrate the token, giving an attacker a live session (vote-casting,
    event management, etc.) until the token expires or the user logs out
    elsewhere. A cookie-based session (httpOnly, `SameSite`, plus CSRF
    protection on state-changing requests) would not be readable by injected
    JS, closing that specific exfiltration path.
  - **Why it's still this way today:** simplicity — no CSRF-token plumbing,
    works cleanly across the Vercel-preview / API-on-a-different-origin setup
    (`credentials: true` CORS), and is consistent with how the three session
    types (UNIFIED/ORG/GOV) are threaded through the SPA today.
  - **If pursued:** moving to httpOnly cookies + CSRF tokens is an
    architectural change (backend sets/reads the cookie, frontend stops
    managing the token directly, CSRF middleware added) and should be scoped
    as its own follow-up rather than folded into an unrelated change.

  In the meantime, the standard mitigation is disciplined output encoding /
  avoiding `dangerouslySetInnerHTML` with unsanitized data anywhere in the
  app, since XSS is the precondition for this risk to matter at all.
  