import { getAppConfig, getFormattedCopyright } from '@block9/app-platform'

type SignInScreenProps = {
  residentSignInUrl: string
  adminSignInUrl: string
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 19 6v5c0 4.6-2.9 8-7 10-4.1-2-7-5.4-7-10V6l7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  )
}

function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 21V5l8-3 8 3v16M8 8h1m6 0h1M8 12h1m6 0h1M8 16h1m6 0h1M10 21v-3h4v3" />
    </svg>
  )
}

export default function SignInScreen({ residentSignInUrl, adminSignInUrl }: SignInScreenProps) {
  const config = getAppConfig()
  return (
    <main className="sign-in-shell">
      <header className="sign-in-brand" aria-label={config.application.productName}>
        <span className="brand-mark">{config.application.monogram}</span>
        <span>{config.application.productName}</span>
      </header>

      <div className="sign-in-layout">
        <section className="sign-in-story">
          <span className="eyebrow">ONE HOME. ONE CLEAR VIEW.</span>
          <h1>Apartment living, thoughtfully managed.</h1>
          <p>Maintenance payments, resident communication, and apartment operations in one secure workspace.</p>
          <div className="sign-in-trust">
            <span className="sign-in-trust-icon"><ShieldIcon /></span>
            <div>
              <strong>Private by design</strong>
              <small>Every organization is isolated with role based access.</small>
            </div>
          </div>
        </section>

        <section className="sign-in-card" aria-labelledby="sign-in-title">
          <div className="sign-in-heading">
            <span className="sign-in-mobile-mark">{config.application.monogram}</span>
            <h2 id="sign-in-title">Welcome back</h2>
            <p>Choose the {config.application.productName} app you want to sign in to.</p>
          </div>

          <div className="sign-in-options">
            <a className="sign-in-option" href={residentSignInUrl}>
              <span className="sign-in-option-icon"><PersonIcon /></span>
              <span className="sign-in-option-copy">
                <strong>Resident</strong>
              </span>
            </a>
            <a className="sign-in-option" href={adminSignInUrl}>
              <span className="sign-in-option-icon"><BuildingIcon /></span>
              <span className="sign-in-option-copy">
                <strong>APARTMENT ADMIN</strong>
              </span>
            </a>
          </div>

          <p className="sign-in-security"><ShieldIcon /> Secure sign in with an email verification code.</p>
        </section>
      </div>

      <footer className="sign-in-footer"><span>{getFormattedCopyright()}</span><span>Secure access for your community</span></footer>
    </main>
  )
}
