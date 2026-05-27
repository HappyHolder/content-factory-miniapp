// Central API base URL — used by all frontend fetch calls.
// VITE_API_BASE_URL is set in Vercel env vars to point at the deployed backend.
// Falls back to '' so relative /api paths work if the backend is colocated.
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''
