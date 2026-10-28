// Deploy as an Auth0 Post Login Action. Configure RESIDENT_CLIENT_ID and RESIDENT_CONNECTION secrets.
exports.onExecutePostLogin = async (event, api) => {
  if (event.client.client_id !== event.secrets.RESIDENT_CLIENT_ID) return;
  if (!event.secrets.RESIDENT_CONNECTION || event.connection.name !== event.secrets.RESIDENT_CONNECTION || event.user.email_verified !== true) {
    api.access.deny('Use the resident database connection and verify your email.');
    return;
  }
  const primary = (event.authentication?.methods || [])
    .filter((method) => ['email', 'passkey', 'pwd'].includes(method.name))
    .map((method) => Date.parse(method.timestamp))
    .filter(Number.isFinite);
  // Never substitute the refresh/exchange time for the original login time.
  // Missing original authentication proof fails closed after session revocation.
  if (primary.length) {
    api.accessToken.setCustomClaim('https://myapartment.block9/login_at', Math.max(...primary) / 1000);
  }
};
