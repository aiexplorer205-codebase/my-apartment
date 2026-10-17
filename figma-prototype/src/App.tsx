import { useState, type ReactNode } from "react"
import appConfig from "../../packages/app-platform/config/app-config.json"

type Role = "resident" | "admin" | "operator"
type Tone = "neutral" | "success" | "warning" | "danger" | "info"

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value)

const iconPaths: Record<string, ReactNode> = {
  home: (
    <>
      <path d="m3 10 9-7 9 7" />
      <path d="M5 9v11h14V9M9 20v-6h6v6" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V5l8-3 8 3v16M8 8h1M15 8h1M8 12h1M15 12h1M8 16h1M15 16h1M10 21v-3h4v3" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h6" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 6h15a2 2 0 0 1 2 2v11H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h13" />
      <path d="M16 12h5v4h-5a2 2 0 0 1 0-4" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  chart: (
    <>
      <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  megaphone: (
    <>
      <path d="m3 11 17-6v14L3 13zM11 16l1 5H7l-1-7" />
    </>
  ),
  support: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.8 1c0 2-2.3 2.3-2.3 4M12 18h.01" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  audit: (
    <>
      <path d="M9 4H6a2 2 0 0 0-2 2v14h16V6a2 2 0 0 0-2-2h-3" />
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M8 11h8M8 15h5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-4-4 4 4 4-4M4 21h16" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  receipt: (
    <>
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  dots: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
}

function Icon({ name, size = 18 }: { name: string size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  )
}

function Button({
  children,
  variant = "primary",
  icon,
  onClick,
  wide,
  disabled,
}: {
  children: ReactNode
  variant?: "primary" | "secondary" | "ghost" | "danger"
  icon?: string
  onClick?: () => void
  wide?: boolean
  disabled?: boolean
}) {
  return (
    <button
      className={`button ${variant} ${wide ? "wide" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <Icon name={icon} size={16} />}
      <span>{children}</span>
    </button>
  )
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode
  tone?: Tone
}) {
  return (
    <span className={`badge ${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  )
}

function Avatar({ name, small }: { name: string small?: boolean }) {
  return (
    <span className={`avatar ${small ? "small" : ""}`}>
      {name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")}
    </span>
  )
}

function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle: string
  actions?: ReactNode
}) {
  return (
    <div className="page-title">
      <div>
        <div className="eyebrow">APARTMENT OPERATIONS</div>
        <div className="title">{title}</div>
        <div className="subtitle">{subtitle}</div>
      </div>
      {actions && <div className="title-actions">{actions}</div>}
    </div>
  )
}

function KpiCard({
  label,
  value,
  detail,
  trend,
  tone = "neutral",
}: {
  label: string
  value: string
  detail: string
  trend?: string
  tone?: Tone
}) {
  return (
    <div className="kpi card">
      <div className="kpi-top">
        <span>{label}</span>
        {trend && <span className={`trend ${tone}`}>{trend}</span>}
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-detail">{detail}</div>
    </div>
  )
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: string[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option}
          className={value === option ? "active" : ""}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

function TopRoleSwitcher({
  role,
  setRole,
  onSignOut,
}: {
  role: Role
  setRole: (role: Role) => void
  onSignOut: () => void
}) {
  return (
    <div className="role-switcher">
      <div className="switch-brand">
        <span className="brand-mark">{appConfig.application.monogram}</span>
        <span>{appConfig.application.productName}</span>
      </div>
      <div className="role-tabs">
        <button
          className={role === "resident" ? "active" : ""}
          onClick={() => setRole("resident")}
        >
          <Icon name="user" size={15} />
          Resident
        </button>
        <button
          className={role === "admin" ? "active" : ""}
          onClick={() => setRole("admin")}
        >
          <Icon name="building" size={15} />
          Apartment admin
        </button>
        <button
          className={role === "operator" ? "active" : ""}
          onClick={() => setRole("operator")}
        >
          <Icon name="shield" size={15} />
          System operator
        </button>
      </div>
      <div className="prototype-actions">
        <div className="prototype-label">
          <span className="live-dot" />
          Interactive prototype
        </div>
        <button className="prototype-signout" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  )
}

const demoAccounts: Record<Role, {
  label: string
  email: string
  context: string
  icon: string
}> = {
  resident: {
    label: "Resident",
    email: "ananya@mapleheights.in",
    context: "Maple Heights · B-1204",
    icon: "user",
  },
  admin: {
    label: "Apartment admin",
    email: "rohan@mapleheights.in",
    context: "Maple Heights · Bengaluru",
    icon: "building",
  },
  operator: {
    label: "System operator",
    email: "kavya@nivasa.in",
    context: "Nivasa platform operations",
    icon: "shield",
  },
}

function SignInScreen({
  role,
  setRole,
  onSignIn,
}: {
  role: Role
  setRole: (role: Role) => void
  onSignIn: () => void
}) {
  const account = demoAccounts[role]

  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <span className="brand-mark">{appConfig.application.monogram}</span>
        <span>{appConfig.application.productName}</span>
      </div>
      <div className="auth-layout">
        <div className="auth-story">
          <span className="context-kicker">ONE HOME. ONE CLEAR VIEW.</span>
          <div className="auth-story-title">
            Apartment living,
            <br />
            thoughtfully managed.
          </div>
          <p>
            Maintenance payments, resident communication, and apartment
            operations in one secure workspace.
          </p>
          <div className="auth-trust">
            <span>
              <Icon name="shield" size={17} />
            </span>
            <div>
              <b>Private by design</b>
              <small>
                Every organization is isolated with role-based access.
              </small>
            </div>
          </div>
        </div>
        <div className="auth-card">
          <div className="auth-heading">
            <span className="auth-mobile-mark">{appConfig.application.monogram}</span>
            <b>Welcome back</b>
            <p>Choose a demo workspace and sign in to continue.</p>
          </div>
          <div className="auth-role-picker">
            {(Object.keys(demoAccounts) as Role[]).map((option) => (
              <button
                key={option}
                className={role === option ? "active" : ""}
                onClick={() => setRole(option)}
                type="button"
              >
                <Icon name={demoAccounts[option].icon} size={17} />
                <span>{demoAccounts[option].label}</span>
              </button>
            ))}
          </div>
          <div className="auth-context">
            <span className="org-avatar">{account.label[0]}</span>
            <span>
              <b>{account.label} demo</b>
              <small>{account.context}</small>
            </span>
            <Badge tone="info">Demo</Badge>
          </div>
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault()
              onSignIn()
            }}
          >
            <label>
              <span>Email address</span>
              <input
                key={account.email}
                type="email"
                defaultValue={account.email}
                autoComplete="email"
              />
            </label>
            <label>
              <span className="auth-label-row">
                <span>Password</span>
                <button type="button">Forgot password?</button>
              </span>
              <input
                type="password"
                defaultValue="nivasa-demo"
                autoComplete="current-password"
              />
            </label>
            <Button wide>Sign in to {account.label.toLowerCase()}</Button>
          </form>
          <div className="auth-security">
            <Icon name="shield" size={14} />
            Secure, encrypted access · Demo credentials are prefilled
          </div>
        </div>
      </div>
      <div className="auth-footer">
        <span>© 2025 Nivasa Technologies</span>
        <span>Privacy · Terms · Help</span>
      </div>
    </div>
  )
}

const residentNav = [
  ["home", "Home"],
  ["card", "Payments"],
  ["history", "History"],
  ["bell", "Notices"],
  ["user", "Profile"],
]

function ResidentApp() {
  const [screen, setScreen] = useState("Home")
  const [paymentStep, setPaymentStep] =
    useState<"review" | "method" | "processing" | "success">("review")
  const [adVariant, setAdVariant] = useState("A")

  const navigate = (next: string) => {
    setScreen(next)
    if (next === "Payments") setPaymentStep("review")
  }

  return (
    <div className="resident-stage">
      <div className="mobile-context">
        <div className="context-copy">
          <span className="context-kicker">RESIDENT EXPERIENCE</span>
          <div className="context-title">
            Pay maintenance
            <br />
            in under a minute.
          </div>
          <p>
            Mobile-first, transparent, and calm. Every rupee is accounted for,
            with no advertising in the payment journey.
          </p>
        </div>
        <div className="variant-control">
          <span>Home ad placement</span>
          <Segmented
            options={["A", "B"]}
            value={adVariant}
            onChange={setAdVariant}
          />
        </div>
        <div className="flow-hint">
          <Icon name="arrow" />
          <span>
            Start with <b>Pay Maintenance</b> to try the primary flow.
          </span>
        </div>
      </div>
      <div className="phone-frame">
        <div className="phone-status">
          <span>9:41</span>
          <span className="phone-island" />
          <span className="status-icons">5G ◼</span>
        </div>
        <div className="mobile-screen">
          {screen === "Home" && (
            <ResidentHome
              onPay={() => navigate("Payments")}
              onHistory={() => navigate("History")}
              onNotices={() => navigate("Notices")}
              adVariant={adVariant}
            />
          )}
          {screen === "Payments" && (
            <ResidentPayment
              step={paymentStep}
              setStep={setPaymentStep}
              goHistory={() => setScreen("History")}
            />
          )}
          {screen === "History" && <ResidentHistory />}
          {screen === "Notices" && <ResidentNotices />}
          {screen === "Profile" && <ResidentProfile />}
        </div>
        <div className="mobile-nav">
          {residentNav.map(([icon, label]) => (
            <button
              key={label}
              className={screen === label ? "active" : ""}
              onClick={() => navigate(label)}
            >
              <Icon name={icon} size={20} />
              <span>{label}</span>
              {label === "Notices" && <i />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function MobileHeader({
  greeting = "Good morning, Ananya",
  sub = "Maple Heights · B-1204",
}: {
  greeting?: string
  sub?: string
}) {
  return (
    <div className="mobile-header">
      <div>
        <div className="mobile-greeting">{greeting}</div>
        <div className="mobile-sub">{sub}</div>
      </div>
      <button className="icon-button">
        <Icon name="bell" size={20} />
        <span className="notification-dot" />
      </button>
    </div>
  )
}

function SponsoredCard({ variant }: { variant: string }) {
  const [visible, setVisible] = useState(true)
  const [opened, setOpened] = useState(false)
  if (!visible) return null
  if (variant === "B")
    return (
      <div className="sponsor-card recommendation">
        <div className="sponsor-icon">
          <Icon name="support" />
        </div>
        <div className="sponsor-copy">
          <span className="sponsor-label">Sponsored · Recommended</span>
          <b>AC service from UrbanCare</b>
          <small>Verified technicians · From ₹499</small>
        </div>
        <button className="close-ad" onClick={() => setVisible(false)}>
          <Icon name="close" size={14} />
        </button>
        <Button variant="secondary" onClick={() => setOpened(true)}>
          {opened ? "Offer saved" : "View offer"}
        </Button>
      </div>
    )
  return (
    <div className="sponsor-card compact">
      <div className="sponsor-icon">
        <Icon name="support" />
      </div>
      <div className="sponsor-copy">
        <span className="sponsor-label">Sponsored</span>
        <b>Professional home cleaning</b>
        <small>Flat 20% off for Maple Heights</small>
      </div>
      <Icon name="chevron" size={16} />
    </div>
  )
}

function ResidentHome({
  onPay,
  onHistory,
  onNotices,
  adVariant,
}: {
  onPay: () => void
  onHistory: () => void
  onNotices: () => void
  adVariant: string
}) {
  return (
    <div className="mobile-page">
      <MobileHeader />
      <div className="due-card">
        <div className="due-head">
          <span>June maintenance</span>
          <Badge tone="warning">Due in 4 days</Badge>
        </div>
        <div className="due-amount">{money(4250)}</div>
        <div className="due-meta">
          <span>Invoice #MH-0625-1204</span>
          <span>Due 10 Jun</span>
        </div>
        <Button wide onClick={onPay}>
          Pay maintenance <Icon name="arrow" size={16} />
        </Button>
        <div className="secure-note">
          <Icon name="shield" size={14} />
          Secure payments · No convenience fee
        </div>
      </div>
      {adVariant === "A" && <SponsoredCard variant="A" />}
      <section className="mobile-section">
        <div className="section-heading">
          <span>Recent payments</span>
          <button onClick={onHistory}>View all</button>
        </div>
        <div className="list-card">
          <div className="payment-list-row">
            <div className="receipt-icon">
              <Icon name="receipt" size={18} />
            </div>
            <div>
              <b>May maintenance</b>
              <span>Paid 6 May · UPI</span>
            </div>
            <div className="row-end">
              <b>{money(4250)}</b>
              <Badge tone="success">Paid</Badge>
            </div>
          </div>
          <div className="payment-list-row">
            <div className="receipt-icon">
              <Icon name="receipt" size={18} />
            </div>
            <div>
              <b>April maintenance</b>
              <span>Paid 8 Apr · UPI</span>
            </div>
            <div className="row-end">
              <b>{money(4250)}</b>
              <Badge tone="success">Paid</Badge>
            </div>
          </div>
        </div>
      </section>
      <section className="mobile-section">
        <div className="section-heading">
          <span>Community announcements</span>
          <button onClick={onNotices}>See all</button>
        </div>
        <div className="announcement">
          <span className="announcement-date">12 JUN</span>
          <div>
            <b>Water tank cleaning</b>
            <p>Water supply will pause from 10:00 AM to 1:00 PM.</p>
          </div>
        </div>
        <div className="announcement">
          <span className="announcement-date">16 JUN</span>
          <div>
            <b>Annual residents meeting</b>
            <p>Clubhouse · Sunday at 5:30 PM</p>
          </div>
        </div>
      </section>
      {adVariant === "B" && <SponsoredCard variant="B" />}
      <div className="ad-policy">
        You control ad preferences · Frequency capped
      </div>
    </div>
  )
}

function ResidentPayment({
  step,
  setStep,
  goHistory,
}: {
  step: string
  setStep: (s: "review" | "method" | "processing" | "success") => void
  goHistory: () => void
}) {
  const [method, setMethod] = useState<"UPI" | "Card" | "Net banking">("UPI")
  const [downloaded, setDownloaded] = useState(false)
  if (step === "success")
    return (
      <div className="success-screen">
        <div className="success-mark">
          <Icon name="check" size={30} />
        </div>
        <div className="success-title">Payment successful</div>
        <p>
          Your maintenance payment to Maple Heights Apartment Owners Association
          is complete.
        </p>
        <div className="success-amount">{money(4250)}</div>
        <div className="receipt-summary">
          <div>
            <span>Transaction ID</span>
            <b>NI25060834912</b>
          </div>
          <div>
            <span>Paid on</span>
            <b>8 Jun 2025, 9:42 AM</b>
          </div>
          <div>
            <span>Payment method</span>
            <b>UPI · ananya@okaxis</b>
          </div>
          <div>
            <span>Unit</span>
            <b>Maple Heights · B-1204</b>
          </div>
        </div>
        <Button wide icon={downloaded ? "check" : "download"} onClick={() => setDownloaded(true)}>
          {downloaded ? "Receipt downloaded" : "Download receipt"}
        </Button>
        <Button wide variant="ghost" onClick={goHistory}>
          View payment history
        </Button>
        <div className="confirmation-note">
          <Icon name="bell" size={16} />A receipt has also been sent to your
          email.
        </div>
      </div>
    )

  return (
    <div className="mobile-page payment-page">
      <div className="payment-header">
        <button className="icon-button" onClick={() => setStep("review")}>
          <span className="back-arrow">←</span>
        </button>
        <div>
          <b>{step === "review" ? "Review bill" : "Choose payment method"}</b>
          <span>June 2025 · B-1204</span>
        </div>
        <span />
      </div>
      <div className="stepper">
        <span className="done" />
        <span className={step !== "review" ? "done" : ""} />
        <span />
      </div>
      {step === "review" ? (
        <>
          <div className="bill-hero">
            <span>Amount payable</span>
            <b>{money(4250)}</b>
            <small>Due by 10 June 2025</small>
          </div>
          <div className="bill-card">
            <div className="bill-title">
              Bill breakdown <Badge tone="info">Invoice ready</Badge>
            </div>
            <div className="bill-line">
              <span>Monthly maintenance</span>
              <b>{money(3600)}</b>
            </div>
            <div className="bill-line">
              <span>Water charges</span>
              <b>{money(450)}</b>
            </div>
            <div className="bill-line">
              <span>Sinking fund</span>
              <b>{money(200)}</b>
            </div>
            <div className="bill-line muted">
              <span>Previous dues</span>
              <b>{money(0)}</b>
            </div>
            <div className="bill-total">
              <span>Total due</span>
              <b>{money(4250)}</b>
            </div>
          </div>
          <div className="info-callout">
            <Icon name="shield" size={18} />
            <span>
              <b>No convenience fee</b>
              <small>You will pay exactly {money(4250)}.</small>
            </span>
          </div>
          <div className="payment-bottom">
            <div>
              <span>Total</span>
              <b>{money(4250)}</b>
            </div>
            <Button onClick={() => setStep("method")}>Continue</Button>
          </div>
        </>
      ) : (
        <>
          <div className="method-amount">
            <span>Paying Maple Heights AOAA</span>
            <b>{money(4250)}</b>
          </div>
          <div className="method-section">
            <span className="field-label">RECOMMENDED</span>
            <button
              className={`payment-method ${method === "UPI" ? "selected" : ""}`}
              onClick={() => setMethod("UPI")}
            >
              <span className="upi-logo">UPI</span>
              <span>
                <b>UPI</b>
                <small>Google Pay, PhonePe, BHIM or any UPI app</small>
              </span>
              <span className={`radio ${method === "UPI" ? "checked" : ""}`} />
            </button>
          </div>
          <div className="method-section">
            <span className="field-label">OTHER METHODS</span>
            <button
              className={`payment-method ${method === "Card" ? "selected" : ""}`}
              onClick={() => setMethod("Card")}
            >
              <Icon name="card" />
              <span>
                <b>Credit or debit card</b>
                <small>Visa, Mastercard, RuPay</small>
              </span>
              <span className={`radio ${method === "Card" ? "checked" : ""}`} />
            </button>
            <button
              className={`payment-method ${method === "Net banking" ? "selected" : ""}`}
              onClick={() => setMethod("Net banking")}
            >
              <Icon name="building" />
              <span>
                <b>Net banking</b>
                <small>All major Indian banks</small>
              </span>
              <span className={`radio ${method === "Net banking" ? "checked" : ""}`} />
            </button>
          </div>
          <div className="safe-payment">
            <Icon name="shield" size={16} />
            Payments secured by Razorpay
          </div>
          <div className="payment-bottom single">
            <Button
              wide
              onClick={() => {
                setStep("processing")
                window.setTimeout(() => setStep("success"), 800)
              }}
            >
              {step === "processing"
                ? "Processing securely…"
                : `Pay ${money(4250)}`}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function ResidentHistory() {
  const [filter, setFilter] = useState("All")
  const [downloaded, setDownloaded] = useState<string | null>(null)
  return (
    <div className="mobile-page">
      <MobileHeader greeting="Payment history" sub="Invoices and receipts" />
      <div className="mobile-stat-row">
        <div>
          <span>Total paid in FY 25–26</span>
          <b>{money(8500)}</b>
        </div>
        <Icon name="chart" />
      </div>
      <Segmented
        options={["All", "Paid", "Pending"]}
        value={filter}
        onChange={setFilter}
      />
      <div className="month-label">2025</div>
      <div className="history-list">
        {["May", "April", "March", "February"].map((month, index) => (
          <div className="history-item" key={month}>
            <div className="calendar-tile">
              <b>{index + 5 < 10 ? `0${index + 5}` : index + 5}</b>
              <span>{month.slice(0, 3).toUpperCase()}</span>
            </div>
            <div>
              <b>{month} maintenance</b>
              <span>MH-2025-{1205 - index}</span>
            </div>
            <div className="row-end">
              <b>{money(4250)}</b>
              <button
                className="download-button"
                onClick={() => setDownloaded(month)}
              >
                <Icon
                  name={downloaded === month ? "check" : "download"}
                  size={15}
                />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="empty-mini">
        <Icon name="check" />
        <span>You're all caught up. No overdue payments.</span>
      </div>
    </div>
  )
}

function ResidentNotices() {
  const [read, setRead] = useState(false)
  return (
    <div className="mobile-page">
      <MobileHeader greeting="Notifications" sub="Maple Heights" />
      <div className="notification-filter">
        <Badge tone={read ? "neutral" : "info"}>
          {read ? "All read" : "3 new"}
        </Badge>
        <button onClick={() => setRead(true)}>
          {read ? "Marked as read" : "Mark all as read"}
        </button>
      </div>
      <div className="notice-list">
        <div className={`notice ${read ? "" : "unread"}`}>
          <div className="notice-icon success">
            <Icon name="check" />
          </div>
          <div>
            <b>Payment confirmed</b>
            <p>Your May maintenance payment of {money(4250)} was received.</p>
            <span>2 hours ago</span>
          </div>
        </div>
        <div className={`notice ${read ? "" : "unread"}`}>
          <div className="notice-icon warning">
            <Icon name="bell" />
          </div>
          <div>
            <b>June bill is ready</b>
            <p>Please pay by 10 June to avoid late charges.</p>
            <span>Yesterday</span>
          </div>
        </div>
        <div className="notice">
          <div className="notice-icon info">
            <Icon name="megaphone" />
          </div>
          <div>
            <b>Official notice: water tank cleaning</b>
            <p>Water supply will be paused on 12 June from 10 AM.</p>
            <span>3 days ago</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ResidentProfile() {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <div className="mobile-page">
      <MobileHeader greeting="Profile" sub="Account and preferences" />
      <div className="profile-card">
        <Avatar name="Ananya Mehta" />
        <div>
          <b>Ananya Mehta</b>
          <span>Primary resident · B-1204</span>
          <small>ananya.mehta@example.com</small>
        </div>
        <button onClick={() => setSelected("Personal details")}>
          <Icon name="chevron" />
        </button>
      </div>
      <div className="settings-group">
        <span>ACCOUNT</span>
        {[
          ["building", "Apartment details"],
          ["bell", "Notification preferences"],
          ["card", "Saved payment methods"],
        ].map(([icon, label]) => (
          <button key={label} onClick={() => setSelected(label)}>
            <Icon name={icon} />
            <b>{label}</b>
            <Icon name="chevron" size={16} />
          </button>
        ))}
      </div>
      <div className="settings-group">
        <span>SUPPORT & PRIVACY</span>
        {[
          ["support", "Help and support"],
          ["shield", "Privacy and data"],
          ["megaphone", "Ad preferences"],
        ].map(([icon, label]) => (
          <button key={label} onClick={() => setSelected(label)}>
            <Icon name={icon} />
            <b>{label}</b>
            <Icon name="chevron" size={16} />
          </button>
        ))}
      </div>
      <div className="tenant-label">
        <Icon name="shield" />
        Your data is visible only to Maple Heights administrators.
      </div>
      {selected && (
        <div className="profile-detail-panel">
          <div>
            <b>{selected}</b>
            <button onClick={() => setSelected(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
          <p>
            {selected === "Ad preferences"
              ? "Sponsored recommendations are frequency capped. Personalized payment targeting is always disabled."
              : selected === "Notification preferences"
                ? "Payment receipts, due reminders, and official apartment notices are enabled."
                : "Your current information is verified and securely managed by Maple Heights."}
          </p>
          <Button wide variant="secondary" onClick={() => setSelected(null)}>
            Done
          </Button>
        </div>
      )}
    </div>
  )
}

const adminNav = [
  ["grid", "Overview"],
  ["building", "Buildings & Units"],
  ["users", "Residents"],
  ["file", "Billing"],
  ["wallet", "Collections"],
  ["alert", "Overdue Dues"],
  ["chart", "Reports"],
  ["settings", "Settings"],
]
const operatorNav = [
  ["grid", "Overview"],
  ["building", "Organizations"],
  ["wallet", "Monetization"],
  ["megaphone", "Ad Campaigns"],
  ["card", "Transactions"],
  ["support", "Support"],
  ["audit", "Audit Logs"],
  ["settings", "Settings"],
]

function Sidebar({
  role,
  page,
  setPage,
}: {
  role: "admin" | "operator"
  page: string
  setPage: (p: string) => void
}) {
  const items = role === "admin" ? adminNav : operatorNav
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark">{appConfig.application.monogram}</span>
        <div>
          <b>{appConfig.application.productName}</b>
          <span>
            {role === "admin" ? "APARTMENT ADMIN" : "PLATFORM OPERATIONS"}
          </span>
        </div>
      </div>
      {role === "admin" ? (
        <button className="org-switch">
          <span className="org-avatar">MH</span>
          <span>
            <b>Maple Heights</b>
            <small>Bengaluru</small>
          </span>
          <Icon name="chevron" size={14} />
        </button>
      ) : (
        <div className="operator-tenant">
          <Icon name="shield" />
          <span>Global workspace</span>
        </div>
      )}
      <nav>
        {items.map(([icon, label]) => (
          <button
            key={label}
            className={page === label ? "active" : ""}
            onClick={() => setPage(label)}
          >
            <Icon name={icon} />
            <span>{label}</span>
            {label === "Overdue Dues" && <i>18</i>}
            {label === "Support" && <i>7</i>}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button>
          <Icon name="support" />
          <span>Help center</span>
        </button>
        <div className="sidebar-user">
          <Avatar name={role === "admin" ? "Rohan Shah" : "Kavya Rao"} small />
          <span>
            <b>{role === "admin" ? "Rohan Shah" : "Kavya Rao"}</b>
            <small>
              {role === "admin" ? "Administrator" : "Platform admin"}
            </small>
          </span>
          <Icon name="dots" />
        </div>
      </div>
    </aside>
  )
}

function DashboardShell({ role }: { role: "admin" | "operator" }) {
  const [page, setPage] = useState("Overview")
  return (
    <div className="dashboard">
      <Sidebar role={role} page={page} setPage={setPage} />
      <main className="dashboard-main">
        <div className="dashboard-topbar">
          <div className="topbar-search">
            <Icon name="search" size={16} />
            <span>
              Search{" "}
              {role === "admin"
                ? "residents, units, transactions"
                : "organizations, campaigns, tickets"}
            </span>
            <kbd>⌘ K</kbd>
          </div>
          <div className="topbar-actions">
            <button className="icon-button">
              <Icon name="support" />
            </button>
            <button className="icon-button">
              <Icon name="bell" />
              <span className="notification-dot" />
            </button>
          </div>
        </div>
        <div className="dashboard-content">
          {role === "admin" ? (
            <AdminPage page={page} setPage={setPage} />
          ) : (
            <OperatorPage page={page} setPage={setPage} />
          )}
        </div>
      </main>
    </div>
  )
}

function Chart({ operator = false }: { operator?: boolean }) {
  const points = operator
    ? "0,132 68,118 136,120 204,82 272,90 340,54 408,68 476,30 544,44 612,16"
    : "0,125 68,110 136,114 204,76 272,82 340,50 408,66 476,36 544,48 612,22"
  return (
    <div className="chart-wrap">
      <div className="chart-y">
        <span>100%</span>
        <span>75%</span>
        <span>50%</span>
        <span>25%</span>
      </div>
      <svg
        className="line-chart"
        viewBox="0 0 612 150"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={`fill-${operator}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f46e5" stopOpacity=".18" />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`M${points.replaceAll(" ", " L")} L612,150 L0,150 Z`}
          fill={`url(#fill-${operator})`}
          stroke="none"
        />
        <polyline
          points={points}
          fill="none"
          stroke="#4f46e5"
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
        />
        {points.split(" ").map((p, i) => {
          const [cx, cy] = p.split(",")
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r="3.5"
              fill="white"
              stroke="#4f46e5"
              strokeWidth="2"
            />
          )
        })}
      </svg>
      <div className="chart-x">
        <span>Jan</span>
        <span>Feb</span>
        <span>Mar</span>
        <span>Apr</span>
        <span>May</span>
        <span>Jun</span>
      </div>
    </div>
  )
}

function AdminPage({
  page,
  setPage,
}: {
  page: string
  setPage: (p: string) => void
}) {
  if (page === "Collections") return <AdminCollections setPage={setPage} />
  if (page === "Overdue Dues") return <AdminOverdue />
  if (page === "Billing") return <AdminBilling setPage={setPage} />
  if (page === "Buildings & Units") return <AdminBuildings />
  if (page === "Residents") return <AdminResidents />
  if (page === "Reports" || page === "Settings")
    return <AdminSimple page={page} />
  return <AdminOverview setPage={setPage} />
}

function AdminOverview({ setPage }: { setPage: (p: string) => void }) {
  return (
    <>
      <PageTitle
        title="Good morning, Rohan"
        subtitle="Here’s how collections are tracking for June 2025."
        actions={
          <>
            <Button variant="secondary" icon="download">
              Export
            </Button>
            <Button icon="plus" onClick={() => setPage("Billing")}>
              Generate invoices
            </Button>
          </>
        }
      />
      <div className="kpi-grid four">
        <KpiCard
          label="Total billed"
          value={money(1147500)}
          detail="255 units · June 2025"
          trend="+4.2%"
        />
        <KpiCard
          label="Collected"
          value={money(896400)}
          detail="210 of 255 units"
          trend="78.1%"
          tone="success"
        />
        <KpiCard
          label="Outstanding"
          value={money(251100)}
          detail="45 units remaining"
          trend="21.9%"
          tone="warning"
        />
        <KpiCard
          label="Overdue"
          value={money(78450)}
          detail="18 units · Past due"
          trend="Needs action"
          tone="danger"
        />
      </div>
      <div className="overview-grid">
        <div className="card chart-card">
          <div className="card-header">
            <div>
              <b>Collection performance</b>
              <span>Monthly collection rate</span>
            </div>
            <Segmented
              options={["6 months", "12 months"]}
              value="6 months"
              onChange={() => {}}
            />
          </div>
          <div className="chart-stat">
            <b>78.1%</b>
            <Badge tone="success">+6.8% vs May</Badge>
          </div>
          <Chart />
        </div>
        <div className="card unit-status">
          <div className="card-header">
            <div>
              <b>Unit payment status</b>
              <span>June billing cycle</span>
            </div>
            <button>
              <Icon name="dots" />
            </button>
          </div>
          <div className="donut-wrap">
            <div className="donut">
              <span>
                <b>255</b>
                <small>Total units</small>
              </span>
            </div>
            <div className="donut-legend">
              <div>
                <i className="paid" />
                <span>Paid</span>
                <b>210</b>
                <small>82.4%</small>
              </div>
              <div>
                <i className="pending" />
                <span>Pending</span>
                <b>27</b>
                <small>10.6%</small>
              </div>
              <div>
                <i className="overdue" />
                <span>Overdue</span>
                <b>18</b>
                <small>7.0%</small>
              </div>
            </div>
          </div>
          <Button
            variant="secondary"
            wide
            onClick={() => setPage("Overdue Dues")}
          >
            View overdue units
          </Button>
        </div>
      </div>
      <div className="card table-card">
        <div className="card-header">
          <div>
            <b>Recent transactions</b>
            <span>Latest payments across Maple Heights</span>
          </div>
          <Button variant="ghost" onClick={() => setPage("Collections")}>
            View all <Icon name="arrow" size={15} />
          </Button>
        </div>
        <TransactionTable compact />
      </div>
    </>
  )
}

const transactions = [
  [
    "Ananya Mehta",
    "B-1204",
    "NI25060834912",
    "₹4,250",
    "8 Jun, 9:42 AM",
    "UPI",
    "Paid",
  ],
  [
    "Vikram Nair",
    "A-0802",
    "NI25060834781",
    "₹4,800",
    "8 Jun, 9:18 AM",
    "Card",
    "Paid",
  ],
  [
    "Sneha Iyer",
    "C-0305",
    "NI25060834119",
    "₹4,250",
    "8 Jun, 8:51 AM",
    "UPI",
    "Pending",
  ],
  [
    "Arjun Malhotra",
    "B-0601",
    "NI25060733802",
    "₹8,500",
    "7 Jun, 7:34 PM",
    "Net banking",
    "Paid",
  ],
  [
    "Meera Joshi",
    "A-1103",
    "NI25060733174",
    "₹4,250",
    "7 Jun, 6:12 PM",
    "UPI",
    "Failed",
  ],
]

function TransactionTable({
  compact = false,
  onResolve,
}: {
  compact?: boolean
  onResolve?: () => void
}) {
  return (
    <div className="data-table">
      <div className="table-row table-head">
        <span>Resident / Unit</span>
        <span>Transaction ID</span>
        <span>Amount</span>
        <span>Date</span>
        <span>Method</span>
        <span>Status</span>
        <span />
      </div>
      {transactions.slice(0, compact ? 4 : 5).map((row, index) => (
        <div className="table-row" key={row[2]}>
          <span className="resident-cell">
            <Avatar name={row[0]} small />
            <span>
              <b>{row[0]}</b>
              <small>{row[1]}</small>
            </span>
          </span>
          <span className="mono">{row[2]}</span>
          <span>
            <b>{row[3]}</b>
          </span>
          <span>{row[4]}</span>
          <span>{row[5]}</span>
          <span>
            <Badge
              tone={
                row[6] === "Paid"
                  ? "success"
                  : row[6] === "Pending"
                    ? "warning"
                    : "danger"
              }
            >
              {row[6]}
            </Badge>
          </span>
          <span>
            <button onClick={index === 4 ? onResolve : undefined}>
              <Icon name="dots" />
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}

function AdminCollections({ setPage }: { setPage: (p: string) => void }) {
  const [resolve, setResolve] = useState(false)
  const [resolved, setResolved] = useState(false)
  const [offline, setOffline] = useState<"form" | "success" | null>(null)
  return (
    <>
      <PageTitle
        title="Collections"
        subtitle="Search, reconcile, and export all resident payments."
        actions={
          <>
            <Button variant="secondary" icon="download">
              Export CSV
            </Button>
            <Button icon="plus" onClick={() => setOffline("form")}>
              Record offline payment
            </Button>
          </>
        }
      />
      <div className="kpi-grid three slim">
        <KpiCard
          label="Collected this month"
          value={money(896400)}
          detail="210 transactions"
          trend="+6.8%"
          tone="success"
        />
        <KpiCard
          label="Awaiting settlement"
          value={money(38250)}
          detail="9 transactions"
          trend="T+1"
          tone="warning"
        />
        <KpiCard
          label="Needs review"
          value={money(12750)}
          detail="3 discrepancies"
          trend="Action needed"
          tone="danger"
        />
      </div>
      <div className="card table-card">
        <div className="table-tools">
          <div className="search-box">
            <Icon name="search" />
            <span>Search resident, unit or transaction ID…</span>
          </div>
          <Button variant="secondary">All statuses</Button>
          <Button variant="secondary">June 2025</Button>
        </div>
        <TransactionTable onResolve={() => setResolve(true)} />
        <div className="pagination">
          <span>Showing 1–5 of 210 transactions</span>
          <div>
            <Button variant="secondary" disabled>
              Previous
            </Button>
            <Button variant="secondary">Next</Button>
          </div>
        </div>
      </div>
      <div className="reconcile-banner">
        <span className="reconcile-icon">
          <Icon name="shield" />
        </span>
        <div>
          <b>Settlement reconciliation is up to date</b>
          <span>Last matched with Razorpay at 8 Jun, 10:15 AM</span>
        </div>
        <Button variant="secondary">View reconciliation</Button>
      </div>
      {resolve && (
        <Modal
          title={
            resolved ? "Discrepancy resolved" : "Resolve payment discrepancy"
          }
          onClose={() => setResolve(false)}
        >
          {resolved ? (
            <div className="modal-success">
              <div className="success-mark small">
                <Icon name="check" />
              </div>
              <b>Resolution recorded</b>
              <p>
                Transaction NI25060733174 was marked for gateway follow-up. The
                audit log has been updated.
              </p>
              <Button wide onClick={() => setResolve(false)}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <div className="discrepancy-summary">
                <Badge tone="danger">Failed</Badge>
                <b>Meera Joshi · A-1103</b>
                <span>{money(4250)} · NI25060733174</span>
              </div>
              <label className="field">
                <span>Issue type</span>
                <select defaultValue="gateway">
                  <option value="gateway">
                    Gateway shows payment, bank settlement missing
                  </option>
                  <option>Resident charged, invoice unpaid</option>
                </select>
              </label>
              <label className="field">
                <span>Resolution note</span>
                <textarea defaultValue="Verified gateway reference. Escalated to payment partner for settlement confirmation." />
              </label>
              <div className="modal-actions">
                <Button variant="secondary" onClick={() => setResolve(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setResolved(true)}>
                  Record resolution
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
      {offline && (
        <Modal
          title={
            offline === "success"
              ? "Payment recorded"
              : "Record offline payment"
          }
          onClose={() => setOffline(null)}
        >
          {offline === "success" ? (
            <FlowSuccess
              title="Offline payment added"
              copy="₹4,250 has been applied to unit C-0305. The resident ledger and audit log are updated."
              action="View collection"
              onDone={() => setOffline(null)}
            />
          ) : (
            <>
              <div className="form-grid">
                <label className="field">
                  <span>Resident or unit</span>
                  <input defaultValue="Sneha Iyer · C-0305" />
                </label>
                <label className="field">
                  <span>Amount</span>
                  <input defaultValue="₹4,250" />
                </label>
                <label className="field">
                  <span>Payment method</span>
                  <select defaultValue="bank">
                    <option value="bank">Bank transfer</option>
                    <option>Cheque</option>
                    <option>Cash</option>
                  </select>
                </label>
                <label className="field">
                  <span>Reference number</span>
                  <input defaultValue="NEFT2406081934" />
                </label>
                <label className="field full">
                  <span>Internal note</span>
                  <textarea defaultValue="Confirmed in association bank statement." />
                </label>
              </div>
              <div className="modal-actions">
                <Button variant="secondary" onClick={() => setOffline(null)}>
                  Cancel
                </Button>
                <Button onClick={() => setOffline("success")}>
                  Record payment
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  )
}

function AdminOverdue() {
  const [reminder, setReminder] = useState(false)
  return (
    <>
      <PageTitle
        title="Overdue dues"
        subtitle="Prioritize follow-ups and recover outstanding maintenance."
        actions={
          <Button icon="bell" onClick={() => setReminder(true)}>
            Send bulk reminder
          </Button>
        }
      />
      <div className="overdue-summary">
        <div>
          <span>Overdue amount</span>
          <b>{money(78450)}</b>
          <small>Across 18 units</small>
        </div>
        <div className="aging">
          <div>
            <span>1–7 days</span>
            <b>{money(34000)}</b>
            <i style={{ width: "43%" }} />
          </div>
          <div>
            <span>8–30 days</span>
            <b>{money(27450)}</b>
            <i style={{ width: "35%" }} />
          </div>
          <div>
            <span>30+ days</span>
            <b>{money(17000)}</b>
            <i style={{ width: "22%" }} />
          </div>
        </div>
      </div>
      <div className="card table-card">
        <div className="table-tools">
          <div className="search-box">
            <Icon name="search" />
            <span>Search resident or unit…</span>
          </div>
          <Button variant="secondary">Highest amount</Button>
          <Button variant="secondary">All buildings</Button>
        </div>
        <div className="data-table overdue-table">
          <div className="table-row table-head">
            <span>
              <input type="checkbox" />
            </span>
            <span>Resident / Unit</span>
            <span>Outstanding</span>
            <span>Overdue</span>
            <span>Last reminder</span>
            <span>Follow-up</span>
            <span />
          </div>
          {[
            [
              "Rahul Desai",
              "C-1402",
              "₹12,750",
              "38 days",
              "2 Jun",
              "Call scheduled",
            ],
            [
              "Neha Kapoor",
              "A-0407",
              "₹8,500",
              "22 days",
              "5 Jun",
              "No response",
            ],
            [
              "Amit Kulkarni",
              "B-0901",
              "₹8,500",
              "18 days",
              "6 Jun",
              "Promised 10 Jun",
            ],
            [
              "Divya Menon",
              "C-0604",
              "₹4,250",
              "12 days",
              "6 Jun",
              "Reminder sent",
            ],
            [
              "Sameer Khan",
              "A-0208",
              "₹4,250",
              "8 days",
              "7 Jun",
              "Not contacted",
            ],
          ].map((row, i) => (
            <div className="table-row" key={row[1]}>
              <span>
                <input type="checkbox" />
              </span>
              <span className="resident-cell">
                <Avatar name={row[0]} small />
                <span>
                  <b>{row[0]}</b>
                  <small>{row[1]}</small>
                </span>
              </span>
              <span>
                <b>{row[2]}</b>
              </span>
              <span>
                <Badge tone={i < 2 ? "danger" : "warning"}>{row[3]}</Badge>
              </span>
              <span>{row[4]}</span>
              <span>{row[5]}</span>
              <span>
                <Button variant="ghost" onClick={() => setReminder(true)}>
                  Remind
                </Button>
              </span>
            </div>
          ))}
        </div>
      </div>
      {reminder && (
        <Modal title="Send payment reminder" onClose={() => setReminder(false)}>
          <div className="reminder-preview">
            <span className="field-label">PREVIEW</span>
            <b>Maintenance payment overdue</b>
            <p>
              Hello Rahul, your maintenance payment of ₹12,750 for unit C-1402
              is overdue. Please pay at your earliest convenience.
            </p>
            <small>Official message from Maple Heights AOAA</small>
          </div>
          <label className="field">
            <span>Channels</span>
            <div className="check-options">
              <label>
                <input type="checkbox" defaultChecked /> WhatsApp
              </label>
              <label>
                <input type="checkbox" defaultChecked /> SMS
              </label>
              <label>
                <input type="checkbox" defaultChecked /> Email
              </label>
            </div>
          </label>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setReminder(false)}>
              Cancel
            </Button>
            <Button onClick={() => setReminder(false)}>Send reminder</Button>
          </div>
        </Modal>
      )}
    </>
  )
}

function AdminBilling({ setPage }: { setPage: (p: string) => void }) {
  const [step, setStep] = useState(1)
  return (
    <>
      <PageTitle
        title="Billing"
        subtitle="Configure charges and publish monthly invoices."
        actions={
          <Button icon="plus" onClick={() => setStep(2)}>
            Generate June invoices
          </Button>
        }
      />
      <div className="billing-run card">
        <div className="billing-status">
          <div className="run-icon">
            <Icon name="file" />
          </div>
          <div>
            <Badge tone={step === 3 ? "success" : "info"}>
              {step === 3 ? "Published" : "Draft"}
            </Badge>
            <b>June 2025 billing run</b>
            <span>255 units · Base charges and utility adjustments</span>
          </div>
        </div>
        <div className="billing-totals">
          <div>
            <span>Expected billing</span>
            <b>{money(1147500)}</b>
          </div>
          <div>
            <span>Units included</span>
            <b>255 / 255</b>
          </div>
          <Button variant="secondary" onClick={() => setStep(2)}>
            {step === 3 ? "View invoices" : "Preview run"}
          </Button>
        </div>
      </div>
      <div className="billing-grid">
        <div className="card">
          <div className="card-header">
            <div>
              <b>Monthly charge configuration</b>
              <span>Effective from June 2025</span>
            </div>
            <Button variant="ghost">Edit rules</Button>
          </div>
          {[
            ["Standard maintenance", "₹3.00 / sq. ft.", "255 units"],
            ["Water charges", "₹450 / unit", "255 units"],
            ["Sinking fund", "₹200 / unit", "255 units"],
            ["Late fee", "₹250 after due date", "As applicable"],
          ].map((x) => (
            <div className="rule-row" key={x[0]}>
              <div>
                <b>{x[0]}</b>
                <span>{x[2]}</span>
              </div>
              <b>{x[1]}</b>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-header">
            <div>
              <b>Recent billing runs</b>
              <span>Last 3 months</span>
            </div>
          </div>
          {["May 2025", "April 2025", "March 2025"].map((m, i) => (
            <div className="run-row" key={m}>
              <span className="run-check">
                <Icon name="check" />
              </span>
              <div>
                <b>{m}</b>
                <span>
                  Published {10 - i} {i ? "Apr" : "May"} 2025
                </span>
              </div>
              <b>{money(1100000 + i * 12500)}</b>
              <Icon name="chevron" size={15} />
            </div>
          ))}
        </div>
      </div>
      {step === 2 && (
        <Modal title="Preview June billing run" onClose={() => setStep(1)}>
          <div className="preview-stats">
            <div>
              <span>Invoices</span>
              <b>255</b>
            </div>
            <div>
              <span>Total value</span>
              <b>{money(1147500)}</b>
            </div>
            <div>
              <span>Exceptions</span>
              <b className="amber-text">2</b>
            </div>
          </div>
          <div className="info-callout">
            <Icon name="alert" />
            <span>
              <b>2 units need review</b>
              <small>
                Missing occupancy data. Standard charges will apply.
              </small>
            </span>
          </div>
          <label className="check-line">
            <input type="checkbox" defaultChecked /> Notify residents by push,
            email, and WhatsApp
          </label>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button
              onClick={() => {
                setStep(3)
                setPage("Collections")
              }}
            >
              Publish 255 invoices
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}

function AdminBuildings() {
  const [flow, setFlow] = useState<
    "details" | "units" | "success" | "import" | "manage" | null
  >(null)
  const [added, setAdded] = useState(false)
  const buildings = [
    ["Tower A", "84 units", "81 occupied"],
    ["Tower B", "87 units", "84 occupied"],
    ["Tower C", "84 units", "78 occupied"],
    ...(added ? [["Lakeview Block A", "48 units", "0 occupied"]] : []),
  ]
  return (
    <>
      <PageTitle
        title="Buildings & units"
        subtitle="Manage property structure, occupancy, and rates."
        actions={
          <>
            <Button
              variant="secondary"
              icon="download"
              onClick={() => setFlow("import")}
            >
              Import CSV
            </Button>
            <Button icon="plus" onClick={() => setFlow("details")}>
              Add apartment
            </Button>
          </>
        }
      />
      <div className="building-cards">
        {buildings.map((x, i) => (
          <div className="building-card card" key={x[0]}>
            <div className="building-visual">
              <Icon name="building" size={32} />
              <span>{String.fromCharCode(65 + i)}</span>
            </div>
            <div>
              <b>{x[0]}</b>
              <span>
                {x[1]} · {x[2]}
              </span>
              <div className="occupancy-bar">
                <i style={{ width: added && i === 3 ? "0%" : `${96 - i * 2}%` }} />
              </div>
              <small>{added && i === 3 ? 0 : 96 - i * 2}% occupied</small>
            </div>
            <Button variant="ghost" onClick={() => setFlow("manage")}>
              Manage <Icon name="chevron" size={14} />
            </Button>
          </div>
        ))}
      </div>
      <div className="card empty-state">
        <div className="empty-icon">
          <Icon name="plus" />
        </div>
        <b>Add another building</b>
        <p>Create floors and units, then invite residents to get started.</p>
        <Button variant="secondary" onClick={() => setFlow("details")}>
          Add building
        </Button>
      </div>
      {flow && (
        <Modal
          title={
            flow === "details"
              ? "Create apartment"
              : flow === "units"
                ? "Set up buildings and units"
                : flow === "import"
                  ? "Import units from CSV"
                  : flow === "manage"
                    ? "Manage Tower A"
                    : "Apartment created"
          }
          onClose={() => setFlow(null)}
        >
          {flow === "details" && (
            <>
              <div className="flow-steps">
                <b>1</b><span /><i>2</i><span /><i>3</i>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Apartment name</span>
                  <input defaultValue="Lakeview Residency" />
                </label>
                <label className="field">
                  <span>City</span>
                  <input defaultValue="Pune" />
                </label>
                <label className="field">
                  <span>Address</span>
                  <input defaultValue="Baner Road, Pune 411045" />
                </label>
                <label className="field">
                  <span>Billing start month</span>
                  <select><option>July 2025</option></select>
                </label>
              </div>
              <div className="modal-actions">
                <Button variant="secondary" onClick={() => setFlow(null)}>Cancel</Button>
                <Button onClick={() => setFlow("units")}>Continue to units</Button>
              </div>
            </>
          )}
          {flow === "units" && (
            <>
              <div className="flow-steps">
                <b>1</b><span className="done" /><b>2</b><span /><i>3</i>
              </div>
              <div className="unit-builder">
                <div className="unit-builder-head">
                  <div><b>Block A</b><span>48 units will be created</span></div>
                  <Badge tone="info">Auto-generate</Badge>
                </div>
                <div className="form-grid">
                  <label className="field"><span>Floors</span><input defaultValue="12" /></label>
                  <label className="field"><span>Units per floor</span><input defaultValue="4" /></label>
                  <label className="field"><span>Unit prefix</span><input defaultValue="A" /></label>
                  <label className="field"><span>Number format</span><select><option>A-0101, A-0102…</option></select></label>
                </div>
              </div>
              <label className="check-line">
                <input type="checkbox" defaultChecked /> Apply standard maintenance rate of ₹3.00 per sq. ft.
              </label>
              <div className="modal-actions">
                <Button variant="secondary" onClick={() => setFlow("details")}>Back</Button>
                <Button onClick={() => { setAdded(true); setFlow("success") }}>Create 48 units</Button>
              </div>
            </>
          )}
          {flow === "success" && (
            <FlowSuccess
              title="Lakeview Residency is ready"
              copy="Block A and 48 units were created. You can now assign residents or add another building."
              action="View apartment"
              onDone={() => setFlow(null)}
            />
          )}
          {flow === "import" && (
            <>
              <div className="upload-zone">
                <Icon name="download" size={24} />
                <b>Drop a CSV file here</b>
                <span>or choose a file · Maximum 5 MB</span>
                <Button variant="secondary">Choose file</Button>
              </div>
              <div className="info-callout"><Icon name="file" /><span><b>Need the format?</b><small>Download the unit import template with sample rows.</small></span></div>
              <div className="modal-actions"><Button variant="secondary" onClick={() => setFlow(null)}>Cancel</Button><Button onClick={() => setFlow("success")}>Import sample file</Button></div>
            </>
          )}
          {flow === "manage" && (
            <>
              <div className="preview-stats">
                <div><span>Units</span><b>84</b></div>
                <div><span>Occupied</span><b>81</b></div>
                <div><span>Vacant</span><b>3</b></div>
              </div>
              <div className="form-grid">
                <label className="field"><span>Building name</span><input defaultValue="Tower A" /></label>
                <label className="field"><span>Maintenance rate</span><input defaultValue="₹3.00 / sq. ft." /></label>
              </div>
              <div className="modal-actions"><Button variant="secondary" onClick={() => setFlow(null)}>Close</Button><Button onClick={() => setFlow(null)}>Save changes</Button></div>
            </>
          )}
        </Modal>
      )}
    </>
  )
}

function AdminResidents() {
  const [invite, setInvite] = useState<"form" | "success" | "profile" | null>(
    null,
  )
  const [invited, setInvited] = useState(false)
  const residents = [
    ...transactions.map((x, i) => ({
      name: x[0],
      unit: x[1],
      role: i === 0 ? "Owner" : "Tenant",
      phone: `+91 98${`76543${210 + i}`}`,
      joined: `${12 + i} Jan 2024`,
      overdue: i === 4,
    })),
    ...(invited
      ? [
          {
            name: "Priya Sharma",
            unit: "A-0101",
            role: "Owner",
            phone: "+91 98765 43210",
            joined: "Invite pending",
            overdue: false,
          },
        ]
      : []),
  ]
  return (
    <>
      <PageTitle
        title="Residents"
        subtitle="Manage access and resident payment history."
        actions={
          <Button icon="plus" onClick={() => setInvite("form")}>
            Invite residents
          </Button>
        }
      />
      <div className="card table-card">
        <div className="table-tools">
          <div className="search-box">
            <Icon name="search" />
            <span>Search residents…</span>
          </div>
          <Button variant="secondary">All buildings</Button>
          <Button variant="secondary">Occupancy</Button>
        </div>
        <div className="data-table resident-table">
          <div className="table-row table-head">
            <span>Resident</span>
            <span>Unit</span>
            <span>Contact</span>
            <span>Joined</span>
            <span>Payment status</span>
            <span />
          </div>
          {residents.map((resident) => (
            <div className="table-row" key={resident.name}>
              <span className="resident-cell">
                <Avatar name={resident.name} small />
                <span>
                  <b>{resident.name}</b>
                  <small>{resident.role}</small>
                </span>
              </span>
              <span>
                <b>{resident.unit}</b>
              </span>
              <span>{resident.phone}</span>
              <span>{resident.joined}</span>
              <span>
                <Badge tone={resident.overdue ? "danger" : invited && resident.name === "Priya Sharma" ? "warning" : "success"}>
                  {resident.overdue
                    ? "Overdue"
                    : invited && resident.name === "Priya Sharma"
                      ? "Invited"
                      : "Up to date"}
                </Badge>
              </span>
              <span>
                <button
                  className="row-menu"
                  onClick={() => setInvite("profile")}
                >
                  <Icon name="dots" />
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
      {invite && (
        <Modal
          title={
            invite === "form"
              ? "Invite resident"
              : invite === "profile"
                ? "Resident details"
                : "Invitation sent"
          }
          onClose={() => setInvite(null)}
        >
          {invite === "form" && (
            <>
              <div className="form-grid">
                <label className="field">
                  <span>Full name</span>
                  <input defaultValue="Priya Sharma" />
                </label>
                <label className="field">
                  <span>Mobile number</span>
                  <input defaultValue="+91 98765 43210" />
                </label>
                <label className="field">
                  <span>Building and unit</span>
                  <select defaultValue="a101">
                    <option value="a101">Tower A · A-0101</option>
                    <option>Tower B · B-0203</option>
                  </select>
                </label>
                <label className="field">
                  <span>Occupancy type</span>
                  <select><option>Owner</option><option>Tenant</option></select>
                </label>
                <label className="field full">
                  <span>Email address</span>
                  <input defaultValue="priya.sharma@example.com" />
                </label>
              </div>
              <div className="check-options resident-channels">
                <label><input type="checkbox" defaultChecked /> WhatsApp</label>
                <label><input type="checkbox" defaultChecked /> SMS</label>
                <label><input type="checkbox" defaultChecked /> Email</label>
              </div>
              <div className="modal-actions">
                <Button variant="secondary" onClick={() => setInvite(null)}>Cancel</Button>
                <Button onClick={() => { setInvited(true); setInvite("success") }}>Send invitation</Button>
              </div>
            </>
          )}
          {invite === "success" && (
            <FlowSuccess
              title="Priya has been invited"
              copy="An activation link was sent by WhatsApp, SMS, and email. Access is limited to unit A-0101."
              action="Done"
              onDone={() => setInvite(null)}
            />
          )}
          {invite === "profile" && (
            <>
              <div className="resident-detail">
                <Avatar name="Ananya Mehta" />
                <div><b>Ananya Mehta</b><span>Owner · B-1204 · Active</span></div>
                <Badge tone="success">Up to date</Badge>
              </div>
              <div className="preview-stats">
                <div><span>Outstanding</span><b>₹0</b></div>
                <div><span>Payments</span><b>18</b></div>
                <div><span>Access</span><b>Active</b></div>
              </div>
              <div className="modal-actions"><Button variant="secondary" onClick={() => setInvite(null)}>Close</Button><Button>Send message</Button></div>
            </>
          )}
        </Modal>
      )}
    </>
  )
}

function AdminSimple({ page }: { page: string }) {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <>
      <PageTitle
        title={page}
        subtitle={
          page === "Reports"
            ? "Financial reporting and reconciliation exports."
            : "Organization, billing, permissions, and integrations."
        }
      />
      <div className="simple-grid">
        {(page === "Reports"
          ? [
              [
                "chart",
                "Collection report",
                "Payments, dues, and collection trends",
              ],
              [
                "wallet",
                "Settlement reconciliation",
                "Gateway payouts matched to collections",
              ],
              [
                "file",
                "Outstanding dues report",
                "Ageing and follow-up performance",
              ],
            ]
          : [
              [
                "building",
                "Organization settings",
                "Maple Heights profile and communication",
              ],
              ["file", "Billing rules", "Charges, due dates, and late fees"],
              ["users", "Team and permissions", "Roles and access controls"],
              [
                "shield",
                "Payment integrations",
                "Razorpay and bank settlement",
              ],
            ]
        ).map((x) => (
          <button
            className="setting-card card"
            key={x[1]}
            onClick={() => setSelected(x[1])}
          >
            <span>
              <Icon name={x[0]} />
            </span>
            <div>
              <b>{x[1]}</b>
              <p>{x[2]}</p>
            </div>
            <Icon name="chevron" />
          </button>
        ))}
      </div>
      {selected && (
        <Modal title={selected} onClose={() => setSelected(null)}>
          {page === "Reports" ? (
            <>
              <div className="preview-stats">
                <div><span>Period</span><b>June 2025</b></div>
                <div><span>Records</span><b>255</b></div>
                <div><span>Format</span><b>PDF + CSV</b></div>
              </div>
              <label className="field"><span>Date range</span><select><option>1 Jun – 30 Jun 2025</option></select></label>
              <div className="modal-actions"><Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button><Button icon="download" onClick={() => setSelected(null)}>Generate report</Button></div>
            </>
          ) : (
            <>
              <div className="form-grid">
                <label className="field"><span>Configuration</span><input defaultValue={selected} /></label>
                <label className="field"><span>Status</span><select><option>Active</option><option>Disabled</option></select></label>
                <label className="field full"><span>Administrative note</span><textarea defaultValue="Managed by Maple Heights administrators." /></label>
              </div>
              <div className="modal-actions"><Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button><Button onClick={() => setSelected(null)}>Save changes</Button></div>
            </>
          )}
        </Modal>
      )}
    </>
  )
}

function OperatorPage({
  page,
  setPage,
}: {
  page: string
  setPage: (p: string) => void
}) {
  if (page === "Organizations") return <OperatorOrganizations />
  if (page === "Ad Campaigns") return <OperatorCampaigns />
  if (page === "Monetization") return <OperatorMonetization />
  if (page !== "Overview") return <OperatorOperations page={page} />
  return <OperatorOverview setPage={setPage} />
}

function OperatorOverview({ setPage }: { setPage: (p: string) => void }) {
  return (
    <>
      <PageTitle
        title="Platform overview"
        subtitle="Operational and revenue health across Nivasa."
        actions={
          <>
            <Badge tone="success">All systems operational</Badge>
            <Button icon="plus" onClick={() => setPage("Organizations")}>
              Onboard organization
            </Button>
          </>
        }
      />
      <div className="isolation-banner">
        <Icon name="shield" />
        <div>
          <b>Tenant data isolation enforced</b>
          <span>
            Viewing aggregate platform metrics. Resident-level data requires
            scoped organization access.
          </span>
        </div>
        <button>View policy</button>
      </div>
      <div className="kpi-grid four">
        <KpiCard
          label="Active organizations"
          value="148"
          detail="12 onboarding"
          trend="+9 this month"
          tone="success"
        />
        <KpiCard
          label="Residents"
          value="24,680"
          detail="21,942 active users"
          trend="+5.4%"
        />
        <KpiCard
          label="Units managed"
          value="18,420"
          detail="Across 12 cities"
          trend="+814"
        />
        <KpiCard
          label="Transaction volume"
          value={money(84200000)}
          detail="Maintenance collections"
          trend="+12.8%"
          tone="success"
        />
      </div>
      <div className="revenue-strip">
        <div className="revenue-label">
          <span>PLATFORM REVENUE · JUNE</span>
          <b>{money(1246800)}</b>
        </div>
        <div>
          <span>SaaS subscriptions</span>
          <b>{money(864000)}</b>
          <small>69.3%</small>
        </div>
        <div>
          <span>Service fees</span>
          <b>{money(228400)}</b>
          <small>18.3%</small>
        </div>
        <div>
          <span>Advertising revenue</span>
          <b>{money(154400)}</b>
          <small>12.4%</small>
        </div>
        <div className="not-revenue">
          <Icon name="alert" />
          <span>
            <b>{money(84200000)}</b>
            <small>Tenant collections · Not platform revenue</small>
          </span>
        </div>
      </div>
      <div className="overview-grid operator-grid">
        <div className="card chart-card">
          <div className="card-header">
            <div>
              <b>Platform growth</b>
              <span>Monthly active organizations</span>
            </div>
            <Segmented
              options={["Organizations", "Revenue"]}
              value="Organizations"
              onChange={() => {}}
            />
          </div>
          <div className="chart-stat">
            <b>148</b>
            <Badge tone="success">+28.7% YoY</Badge>
          </div>
          <Chart operator />
        </div>
        <div className="card system-health">
          <div className="card-header">
            <div>
              <b>System health</b>
              <span>Live service status</span>
            </div>
          </div>
          {[
            ["Payments API", "99.99%", "success"],
            ["UPI gateway", "99.97%", "success"],
            ["Notifications", "99.91%", "success"],
            ["Reconciliation", "Delayed 8m", "warning"],
          ].map((x) => (
            <div className="health-row" key={x[0]}>
              <span>
                <i className={x[2]} />
                {x[0]}
              </span>
              <b>{x[1]}</b>
            </div>
          ))}
          <Button variant="secondary" wide>
            View system status
          </Button>
        </div>
      </div>
      <div className="card table-card">
        <div className="card-header">
          <div>
            <b>Organizations requiring attention</b>
            <span>Onboarding and operational exceptions</span>
          </div>
          <Button variant="ghost" onClick={() => setPage("Organizations")}>
            View all <Icon name="arrow" size={15} />
          </Button>
        </div>
        <OrganizationTable compact />
      </div>
    </>
  )
}

const organizations = [
  ["Greenview Residency", "Pune", "384", "Growth", "Active", "98%"],
  ["Lakefront Enclave", "Hyderabad", "612", "Scale", "Onboarding", "72%"],
  ["Silver Oak Apartments", "Bengaluru", "248", "Starter", "Active", "94%"],
  ["Palm Meadows CHS", "Mumbai", "920", "Scale", "Review", "38%"],
  ["Aarav Heights", "Ahmedabad", "176", "Starter", "Suspended", "100%"],
]
function OrganizationTable({ compact = false }: { compact?: boolean }) {
  return (
    <div className="data-table org-table">
      <div className="table-row table-head">
        <span>Organization</span>
        <span>Units</span>
        <span>Plan</span>
        <span>Status</span>
        <span>Onboarding</span>
        <span />
      </div>
      {organizations.slice(0, compact ? 4 : 5).map((x, i) => (
        <div className="table-row" key={x[0]}>
          <span className="org-name">
            <span className="org-avatar">
              {x[0]
                .split(" ")
                .map((w) => w[0])
                .slice(0, 2)
                .join("")}
            </span>
            <span>
              <b>{x[0]}</b>
              <small>{x[1]}</small>
            </span>
          </span>
          <span>{x[2]}</span>
          <span>
            <b>{x[3]}</b>
          </span>
          <span>
            <Badge
              tone={
                x[4] === "Active"
                  ? "success"
                  : x[4] === "Suspended"
                    ? "danger"
                    : "warning"
              }
            >
              {x[4]}
            </Badge>
          </span>
          <span>
            <div className="progress-cell">
              <i>
                <em style={{ width: x[5] }} />
              </i>
              <small>{x[5]}</small>
            </div>
          </span>
          <span>
            <Icon name="dots" />
          </span>
        </div>
      ))}
    </div>
  )
}

function OperatorOrganizations() {
  const [modal, setModal] = useState(false)
  const [created, setCreated] = useState(false)
  return (
    <>
      <PageTitle
        title="Organizations"
        subtitle="Onboard and manage apartment customers."
        actions={
          <Button icon="plus" onClick={() => setModal(true)}>
            Onboard organization
          </Button>
        }
      />
      <div className="kpi-grid three slim">
        <KpiCard
          label="Total organizations"
          value="160"
          detail="148 active"
          trend="+9 this month"
          tone="success"
        />
        <KpiCard
          label="In onboarding"
          value="12"
          detail="5 need attention"
          trend="Avg. 4.2 days"
          tone="warning"
        />
        <KpiCard
          label="Monthly recurring revenue"
          value={money(864000)}
          detail="Subscription revenue only"
          trend="+8.4%"
          tone="success"
        />
      </div>
      <div className="card table-card">
        <div className="table-tools">
          <div className="search-box">
            <Icon name="search" />
            <span>Search organizations…</span>
          </div>
          <Button variant="secondary">All plans</Button>
          <Button variant="secondary">All statuses</Button>
        </div>
        <OrganizationTable />
      </div>
      {modal && (
        <Modal
          title={created ? "Organization created" : "Onboard organization"}
          onClose={() => setModal(false)}
        >
          {created ? (
            <div className="modal-success">
              <div className="success-mark small">
                <Icon name="check" />
              </div>
              <b>Lakeview Residency is ready</b>
              <p>
                The organization workspace is isolated and an activation link
                has been sent to the administrator.
              </p>
              <div className="activation-line">
                <span>Activation status</span>
                <Badge tone="warning">Invite sent</Badge>
              </div>
              <Button wide onClick={() => setModal(false)}>
                Monitor activation
              </Button>
            </div>
          ) : (
            <>
              <div className="form-grid">
                <label className="field">
                  <span>Organization name</span>
                  <input defaultValue="Lakeview Residency" />
                </label>
                <label className="field">
                  <span>City</span>
                  <input defaultValue="Pune" />
                </label>
                <label className="field">
                  <span>Admin email</span>
                  <input defaultValue="admin@lakeview.in" />
                </label>
                <label className="field">
                  <span>Estimated units</span>
                  <input defaultValue="216" />
                </label>
                <label className="field full">
                  <span>Plan</span>
                  <select defaultValue="growth">
                    <option value="starter">Starter · ₹1,499/month</option>
                    <option value="growth">Growth · ₹3,999/month</option>
                    <option value="scale">Scale · Custom</option>
                  </select>
                </label>
              </div>
              <div className="tenant-safe">
                <Icon name="shield" />
                <span>
                  A dedicated tenant workspace will be created with strict data
                  isolation.
                </span>
              </div>
              <div className="modal-actions">
                <Button variant="secondary" onClick={() => setModal(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setCreated(true)}>
                  Create and send invite
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  )
}

function OperatorCampaigns() {
  const [modal, setModal] = useState(false)
  const [published, setPublished] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null)
  return (
    <>
      <PageTitle
        title="Ad campaigns"
        subtitle="Trust-first sponsored placements for resident surfaces."
        actions={
          <Button
            icon="plus"
            onClick={() => {
              setSelectedCampaign(null)
              setPublished(false)
              setModal(true)
            }}
          >
            Create campaign
          </Button>
        }
      />
      <div className="ad-principles">
        <Icon name="shield" />
        <div>
          <b>Resident trust policy active</b>
          <span>
            No checkout placements · No sensitive payment targeting · All ads
            clearly labeled
          </span>
        </div>
        <Badge tone="success">Compliant</Badge>
      </div>
      <div className="kpi-grid four slim">
        <KpiCard
          label="Active campaigns"
          value="18"
          detail="6 advertisers"
          trend="+3"
        />
        <KpiCard
          label="Impressions"
          value="1.42M"
          detail="This month"
          trend="+18.2%"
          tone="success"
        />
        <KpiCard
          label="Clicks"
          value="28,460"
          detail="2.00% CTR"
          trend="+0.21%"
          tone="success"
        />
        <KpiCard
          label="Ad revenue"
          value={money(154400)}
          detail="Platform revenue"
          trend="+12.4%"
          tone="success"
        />
      </div>
      <div className="campaign-grid">
        {[
          [
            "UrbanCare Summer Service",
            "Home services",
            "Resident home · Variant B",
            "148,420",
            "2.4%",
            "Active",
          ],
          [
            "AirFiber Broadband",
            "Internet",
            "Resident home · Variant A",
            "96,180",
            "1.8%",
            "Active",
          ],
          [
            "Sparkle Home Cleaning",
            "Cleaning",
            "Resident home · Variant A",
            "—",
            "—",
            "Draft",
          ],
        ].map((x) => (
          <div className="campaign card" key={x[0]}>
            <div className="campaign-top">
              <span className="campaign-brand">{x[0][0]}</span>
              <Badge tone={x[5] === "Active" ? "success" : "neutral"}>
                {x[5]}
              </Badge>
            </div>
            <b>{x[0]}</b>
            <span>
              {x[1]} · {x[2]}
            </span>
            <div className="campaign-metrics">
              <div>
                <small>Impressions</small>
                <b>{x[3]}</b>
              </div>
              <div>
                <small>CTR</small>
                <b>{x[4]}</b>
              </div>
            </div>
            <Button
              variant="secondary"
              wide
              onClick={() => {
                setSelectedCampaign(x[0])
                setModal(true)
              }}
            >
              {x[5] === "Draft" ? "Continue setup" : "View analytics"}
            </Button>
          </div>
        ))}
      </div>
      {modal && (
        <Modal
          title={
            selectedCampaign
              ? "Campaign performance"
              : published
                ? "Campaign published"
                : "Create ad campaign"
          }
          onClose={() => setModal(false)}
        >
          {selectedCampaign ? (
            <>
              <div className="campaign-detail-head">
                <span className="campaign-brand">{selectedCampaign[0]}</span>
                <div><b>{selectedCampaign}</b><span>Resident home placement</span></div>
                <Badge tone="success">Active</Badge>
              </div>
              <div className="preview-stats">
                <div><span>Impressions</span><b>148.4K</b></div>
                <div><span>Clicks</span><b>3,562</b></div>
                <div><span>CTR</span><b>2.4%</b></div>
              </div>
              <div className="tenant-safe"><Icon name="shield" /><span>Frequency caps and resident trust policy checks are active.</span></div>
              <div className="modal-actions"><Button variant="secondary" onClick={() => setModal(false)}>Close</Button><Button onClick={() => setModal(false)}>Edit campaign</Button></div>
            </>
          ) : published ? (
            <div className="modal-success">
              <div className="success-mark small">
                <Icon name="check" />
              </div>
              <b>Campaign is now live</b>
              <p>
                AC Care Bengaluru will appear in the recommendation placement
                with a cap of 2 impressions per resident per week.
              </p>
              <Button wide onClick={() => setModal(false)}>
                View campaign analytics
              </Button>
            </div>
          ) : (
            <>
              <div className="form-grid">
                <label className="field full">
                  <span>Campaign name</span>
                  <input defaultValue="AC Care Bengaluru" />
                </label>
                <label className="field">
                  <span>Placement</span>
                  <select>
                    <option>Home · Below announcements</option>
                  </select>
                </label>
                <label className="field">
                  <span>Frequency cap</span>
                  <select>
                    <option>2 per resident / week</option>
                  </select>
                </label>
              </div>
              <div className="ad-preview">
                <span className="field-label">RESIDENT PREVIEW</span>
                <SponsoredCard variant="B" />
              </div>
              <div className="modal-actions">
                <Button variant="secondary" onClick={() => setModal(false)}>
                  Save draft
                </Button>
                <Button onClick={() => setPublished(true)}>
                  Publish campaign
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  )
}

function OperatorMonetization() {
  const [plan, setPlan] = useState<string | null>(null)
  return (
    <>
      <PageTitle
        title="Monetization"
        subtitle="Manage transparent, sustainable platform revenue."
      />
      <div className="revenue-separation">
        <div>
          <span>Recognized platform revenue</span>
          <b>{money(1246800)}</b>
          <small>Subscriptions + service fees + ads</small>
        </div>
        <div className="separation-mark">≠</div>
        <div>
          <span>Maintenance collections processed</span>
          <b>{money(84200000)}</b>
          <small>Tenant funds · Never platform revenue</small>
        </div>
      </div>
      <div className="pricing-grid">
        {[
          ["Starter", "₹1,499", "Up to 200 units"],
          ["Growth", "₹3,999", "Up to 750 units"],
          ["Scale", "Custom", "Unlimited units"],
        ].map((x, i) => (
          <div
            className={`price-card card ${i === 1 ? "featured" : ""}`}
            key={x[0]}
          >
            {i === 1 && <Badge tone="info">Most popular</Badge>}
            <b>{x[0]}</b>
            <div>
              <strong>{x[1]}</strong>
              <span>/ month</span>
            </div>
            <p>{x[2]} · Core billing, collections, resident app, reports.</p>
            <Button
              variant={i === 1 ? "primary" : "secondary"}
              wide
              onClick={() => setPlan(x[0])}
            >
              Manage plan
            </Button>
          </div>
        ))}
      </div>
      {plan && (
        <Modal title={`Manage ${plan} plan`} onClose={() => setPlan(null)}>
          <div className="form-grid">
            <label className="field"><span>Monthly price</span><input defaultValue={plan === "Starter" ? "₹1,499" : plan === "Growth" ? "₹3,999" : "Custom"} /></label>
            <label className="field"><span>Unit allowance</span><input defaultValue={plan === "Starter" ? "200" : plan === "Growth" ? "750" : "Unlimited"} /></label>
            <label className="field full"><span>Included capabilities</span><textarea defaultValue="Billing, collections, resident app, reports, and support." /></label>
          </div>
          <div className="modal-actions"><Button variant="secondary" onClick={() => setPlan(null)}>Cancel</Button><Button onClick={() => setPlan(null)}>Save plan</Button></div>
        </Modal>
      )}
    </>
  )
}

function OperatorOperations({ page }: { page: string }) {
  const [workspace, setWorkspace] = useState(false)
  const map: Record<string, [string, string, string][]> = {
    Transactions: [
      ["Payments processed", "₹8.42 Cr", "Maintenance collections"],
      ["Failed payments", "0.42%", "Within threshold"],
      ["Pending settlements", "₹12.8 L", "T+1 processing"],
    ],
    Support: [
      ["Open tickets", "47", "7 high priority"],
      ["First response", "18 min", "Target under 30 min"],
      ["Resolution SLA", "96.4%", "Last 30 days"],
    ],
    "Audit Logs": [
      ["Events today", "2,841", "Across all tenants"],
      ["Admin actions", "392", "Privileged operations"],
      ["Security alerts", "0", "No active threats"],
    ],
    Settings: [
      ["Platform configuration", "Healthy", "Production"],
      ["Access policies", "Enforced", "RBAC + tenant scope"],
      ["Integrations", "12 active", "2 sandbox"],
    ],
  }
  return (
    <>
      <PageTitle
        title={page}
        subtitle={
          page === "Transactions"
            ? "Monitor gateways, settlements, and payment issues."
            : page === "Support"
              ? "Resolve organization and resident support requests."
              : page === "Audit Logs"
                ? "Review immutable platform and tenant-scoped activity."
                : "Configure platform access, integrations, and policies."
        }
      />
      <div className="kpi-grid three">
        {map[page].map((x, i) => (
          <KpiCard
            key={x[0]}
            label={x[0]}
            value={x[1]}
            detail={x[2]}
            tone={i === 0 ? "info" : "neutral"}
          />
        ))}
      </div>
      <div className="card empty-state large">
        <div className="empty-icon">
          <Icon
            name={
              page === "Support"
                ? "support"
                : page === "Audit Logs"
                  ? "audit"
                  : "settings"
            }
          />
        </div>
        <b>{page} workspace</b>
        <p>
          Use filters and scoped access controls to inspect operational data
          without exposing cross-tenant resident information.
        </p>
        <Button variant="secondary" onClick={() => setWorkspace(true)}>
          Open workspace
        </Button>
      </div>
      {workspace && (
        <Modal title={`${page} workspace`} onClose={() => setWorkspace(false)}>
          <div className="form-grid">
            <label className="field"><span>Organization scope</span><select><option>All organizations</option><option>Greenview Residency</option></select></label>
            <label className="field"><span>Time range</span><select><option>Last 30 days</option><option>Today</option></select></label>
            <label className="field full"><span>Search</span><input placeholder={`Search ${page.toLowerCase()}…`} /></label>
          </div>
          <div className="tenant-safe"><Icon name="shield" /><span>Results remain tenant-scoped and all access is written to the audit log.</span></div>
          <div className="modal-actions"><Button variant="secondary" onClick={() => setWorkspace(false)}>Cancel</Button><Button onClick={() => setWorkspace(false)}>Apply filters</Button></div>
        </Modal>
      )}
    </>
  )
}

function FlowSuccess({
  title,
  copy,
  action,
  onDone,
}: {
  title: string
  copy: string
  action: string
  onDone: () => void
}) {
  return (
    <div className="modal-success">
      <div className="success-mark small">
        <Icon name="check" />
      </div>
      <b>{title}</b>
      <p>{copy}</p>
      <Button wide onClick={onDone}>{action}</Button>
    </div>
  )
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <b>{title}</b>
          <button onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export default function App() {
  const [role, setRole] = useState<Role>("resident")
  const [signedIn, setSignedIn] = useState(false)

  if (!signedIn)
    return (
      <SignInScreen
        role={role}
        setRole={setRole}
        onSignIn={() => setSignedIn(true)}
      />
    )

  return (
    <div className="app">
      <TopRoleSwitcher
        role={role}
        setRole={setRole}
        onSignOut={() => setSignedIn(false)}
      />
      {role === "resident" ? <ResidentApp /> : <DashboardShell role={role} />}
    </div>
  )
}
