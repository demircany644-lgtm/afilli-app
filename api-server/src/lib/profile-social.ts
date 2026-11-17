/** Personal profile destinations, never arbitrary external links or credentials. */
export function profileSocialUrl(value: string | null, platform: 'facebook' | 'x'): string | null {
  if (!value?.trim()) return null;
  const url = new URL(value.trim());
  const hosts = platform === 'facebook'
    ? ['facebook.com', 'www.facebook.com', 'm.facebook.com']
    : ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'];
  if (value.length > 300 || url.protocol !== 'https:' || url.username || url.password || url.port
    || !hosts.includes(url.hostname) || !url.pathname.replaceAll('/', '').trim()) {
    throw new Error('Geçersiz bağlantı');
  }
  if (platform === 'x' && !/^\/[A-Za-z0-9_]{1,15}\/?$/.test(url.pathname)) throw new Error('Geçersiz bağlantı');
  if (platform === 'facebook' && /^\/(l\.php|login|sharer|dialog)(\/|$)/i.test(url.pathname)) throw new Error('Geçersiz bağlantı');
  return url.href;
}
