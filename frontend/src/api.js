const API_URL = import.meta.env?.VITE_API_URL || "http://localhost:5000";

function isAbort(err) {
  return err?.name === "AbortError";
}

const NETWORK_FAILURE = {
  ok: false,
  status: 0,
  data: { error: "network_error", message: "Could not reach the server. Check your connection and try again." },
};

/**
 * Thin wrapper, not a client library — just attaches the Authorization
 * header when a token is present and centralizes API_URL, so callers
 * don't repeat `fetch(`${API_URL}...`)` with manual headers.
 *
 * Never throws: every failure (network, CORS block, abort, non-JSON
 * body) comes back as `{ ok: false, status, data }` so callers' existing
 * `if (!ok)` handling always runs and loading states are always reset.
 * `aborted: true` is set when the caller cancelled via `signal`.
 */
export async function apiFetch(path, { method = "GET", body, token, signal } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    // fetch() rejected: network failure, unreachable server, CORS
    // block, or a deliberate abort. No response came back.
    if (isAbort(err)) return { ok: false, status: 0, aborted: true, data: { error: "aborted", message: "Request cancelled." } };
    return { ...NETWORK_FAILURE };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    if (isAbort(err)) return { ok: false, status: 0, aborted: true, data: { error: "aborted", message: "Request cancelled." } };
    return { ok: false, status: res.status, data: { error: "invalid_response", message: "The server returned an unexpected response." } };
  }

  return { ok: res.ok, status: res.status, data };
}

/**
 * Authenticated binary fetch for the PDF endpoint. Deliberately separate
 * from apiFetch (which always calls res.json()). On success returns
 * `{ ok: true, status, blob }`; on any failure returns the same
 * `{ ok: false, status, data: { error, message } }` shape as apiFetch.
 * A 200 whose Content-Type is not application/pdf is treated as a
 * failure rather than handing the user a wrong file.
 */
export async function apiFetchBlob(path, { token, signal } = {}) {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, { method: "GET", headers, signal });
  } catch (err) {
    if (isAbort(err)) return { ok: false, status: 0, aborted: true, data: { error: "aborted", message: "Request cancelled." } };
    return { ...NETWORK_FAILURE };
  }

  if (!res.ok) {
    let data;
    try {
      data = await res.json();
    } catch {
      data = { error: "request_failed", message: "The server could not return the file." };
    }
    return { ok: false, status: res.status, data };
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/pdf")) {
    return { ok: false, status: res.status, data: { error: "invalid_response", message: "The server did not return a PDF." } };
  }

  try {
    const blob = await res.blob();
    return { ok: true, status: res.status, blob };
  } catch (err) {
    if (isAbort(err)) return { ok: false, status: 0, aborted: true, data: { error: "aborted", message: "Request cancelled." } };
    return { ok: false, status: res.status, data: { error: "invalid_response", message: "The download was interrupted. Please try again." } };
  }
}

/**
 * Hands a Blob to the browser as a file download, then releases the
 * object URL so the PDF bytes don't stay pinned in memory. The delay
 * before revoking is deliberate: some browsers start the download
 * asynchronously after click(), and revoking synchronously can cancel it.
 */
export function saveBlob(blob, filename, { revokeAfterMs = 10_000 } = {}) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), revokeAfterMs);
}
