import { useState, useEffect } from "react";
import { apiFetch } from "./api.js";

const STATUSES = ["SAVED", "APPLIED", "INTERVIEW", "OFFER", "REJECTED"];
const emptyForm = { company: "", role: "", jobUrl: "", jobDescription: "", status: "SAVED" };
const TOKEN_STORAGE_KEY = "jobhunt_token";

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [userEmail, setUserEmail] = useState(null);

  function handleAuthSuccess(newToken, email) {
    localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    setToken(newToken);
    setUserEmail(email);
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setUserEmail(null);
  }

  if (!token) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }

  return <ApplicationsScreen token={token} userEmail={userEmail} onLogout={handleLogout} />;
}

function AuthScreen({ onAuthSuccess }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setErrors([]);
    const path = mode === "login" ? "/auth/login" : "/auth/signup";
    const { ok, data } = await apiFetch(path, { method: "POST", body: { email, password } });
    setSubmitting(false);
    if (!ok) {
      setErrors(data.messages || [data.message || "Something went wrong."]);
      return;
    }
    onAuthSuccess(data.token, data.user.email);
  }

  return (
    <div style={{ maxWidth: 360, margin: "4rem auto", fontFamily: "sans-serif", padding: "0 1rem" }}>
      <h1>Job Hunt Command Center</h1>
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <button type="button" onClick={() => setMode("login")} disabled={mode === "login"}>
          Log in
        </button>
        <button type="button" onClick={() => setMode("signup")} disabled={mode === "signup"}>
          Sign up
        </button>
      </div>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          type="password"
          placeholder={mode === "signup" ? "Password (min 8 characters)" : "Password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? "..." : mode === "login" ? "Log in" : "Sign up"}
        </button>
        {errors.length > 0 && (
          <ul style={{ color: "#b00020", margin: 0 }}>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </form>
    </div>
  );
}

function ApplicationsScreen({ token, userEmail, onLogout }) {
  const [applications, setApplications] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState([]);
  const [loadError, setLoadError] = useState(null);

  async function loadApplications() {
    setLoading(true);
    setLoadError(null);
    const { ok, status, data } = await apiFetch("/applications", { token });
    if (!ok) {
      if (status === 401) return onLogout(); // token expired/invalid — back to login
      setLoadError(data.message || `Server responded ${status}`);
    } else {
      setApplications(data);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setErrors([]);
    const { ok, status, data } = await apiFetch("/applications", { method: "POST", body: form, token });
    setSubmitting(false);
    if (!ok) {
      if (status === 401) return onLogout();
      setErrors(data.messages || [data.message || "Something went wrong."]);
      return;
    }
    setForm(emptyForm);
    await loadApplications();
  }

  function updateField(field) {
    return (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));
  }

  return (
    <div style={{ maxWidth: 640, margin: "2rem auto", fontFamily: "sans-serif", padding: "0 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Job Hunt Command Center</h1>
        <button type="button" onClick={onLogout}>
          Log out{userEmail ? ` (${userEmail})` : ""}
        </button>
      </div>
      <p style={{ color: "#555" }}>M3 — signed in, applications are private to your account.</p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "2rem" }}>
        <input placeholder="Company" value={form.company} onChange={updateField("company")} required />
        <input placeholder="Role" value={form.role} onChange={updateField("role")} required />
        <input placeholder="Job URL (optional)" value={form.jobUrl} onChange={updateField("jobUrl")} />
        <textarea placeholder="Job description" value={form.jobDescription} onChange={updateField("jobDescription")} required rows={4} />
        <select value={form.status} onChange={updateField("status")}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="submit" disabled={submitting}>
          {submitting ? "Adding..." : "Add application"}
        </button>
        {errors.length > 0 && (
          <ul style={{ color: "#b00020", margin: 0 }}>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </form>

      <h2>Applications</h2>
      {loading && <p>Loading...</p>}
      {loadError && <p style={{ color: "#b00020" }}>Could not load applications: {loadError}</p>}
      {!loading && !loadError && applications.length === 0 && <p>No applications yet.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {applications.map((app) => (
          <li key={app.id} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "0.75rem", marginBottom: "0.5rem" }}>
            <strong>
              {app.role} @ {app.company}
            </strong>{" "}
            — {app.status}
            {app.jobUrl && (
              <div>
                <a href={app.jobUrl} target="_blank" rel="noreferrer">
                  {app.jobUrl}
                </a>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
