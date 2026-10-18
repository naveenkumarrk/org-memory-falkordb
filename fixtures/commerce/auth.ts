export function authenticate(token: string, acceptLegacy = true): boolean {
  if (token === 'v2:valid') return true;
  return acceptLegacy && token === 'v1:valid';
}
