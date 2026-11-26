// Single place for the backend URL.
// Falls back to localhost:3001 so the app still works if .env is missing.
// Trailing slashes are removed so we never build ".com//api/...".
export const API_URL = (import.meta.env.VITE_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');

// Safe JSON reader: if the server returns HTML (wrong URL / crashed server),
// we show a readable message instead of "Unexpected token '<'".
export async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Cannot reach the API at ${API_URL} (got a non-JSON response, status ${res.status}). Is the backend running and VITE_BASE_URL correct?`);
  }
}
