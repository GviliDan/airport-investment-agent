/**
 * Runtime location of the backend. Read per call (never at module load or build time) so the same
 * image works in any environment. Server-side only: the browser never learns this URL.
 */
export function getApiUrl(): string {
  const url = process.env['API_URL'];
  if (url) return url.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('API_URL must be set in production.');
  }
  return 'http://localhost:3001';
}
