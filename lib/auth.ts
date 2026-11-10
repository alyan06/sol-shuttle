/** Single-user lock. With no APP_PASSCODE set (local development) everything is open. */
export function passcodeRequired(): boolean {
  return Boolean(process.env.APP_PASSCODE);
}

export function allowed(request: Request): boolean {
  const passcode = process.env.APP_PASSCODE;
  return !passcode || request.headers.get('x-passcode') === passcode;
}
