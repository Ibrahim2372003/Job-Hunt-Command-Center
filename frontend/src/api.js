const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

/**
 * Thin wrapper, not a client library — just attaches the Authorization
 * header when a token is present and centralizes API_URL, so App.jsx
 * doesn't repeat `fetch(`${API_URL}...`)` with manual headers at every
 * call site.
 */
export async function apiFetch(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch() itself rejected — network failure, server unreachable,
    // or (the actual bug here) a CORS block. No response ever came
    // back. Return a normalized failure instead of throwing, so every
    // caller's existing `if (!ok) { ... }` handling — which is what
    // resets their loading/submitting state — runs instead of being
    // skipped by an unhandled rejection. This is what was leaving the
    // UI stuck on "Adding..."/"Loading..." forever with no error
    // shown.
    return { ok: false, status: 0, data: { error: "network_error", message: "Could not reach the server. Check your connection and try again." } };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, status: res.status, data: { error: "invalid_response", message: "The server returned an unexpected response." } };
  }

  return { ok: res.ok, status: res.status, data };
}
