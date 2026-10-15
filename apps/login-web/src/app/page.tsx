import SignInScreen from '../features/sign-in/sign-in-screen'

function signInUrl(name: 'resident' | 'admin') {
  const configured = name === 'resident' ? process.env.RESIDENT_WEB_PUBLIC_URL : process.env.ADMIN_WEB_PUBLIC_URL
  if (!configured) throw new Error(`${name.toUpperCase()}_WEB_PUBLIC_URL is required`)

  const target = new URL(configured)
  if (target.protocol !== 'https:' && target.hostname !== 'localhost') {
    throw new Error('Experience URLs must use HTTPS outside local development')
  }

  return new URL(name === 'admin' ? '/dashboard' : '/', target).toString()
}

export default function LoginPage() {
  return <SignInScreen residentSignInUrl={signInUrl('resident')} adminSignInUrl={signInUrl('admin')} />
}
