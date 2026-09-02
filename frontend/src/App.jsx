import { useState, useEffect, useMemo } from "react";
import { apiFetch } from "./api.js";
import ApplicationForm from "./components/ApplicationForm.jsx";
import ApplicationCard from "./components/ApplicationCard.jsx";
import LoadingState from "./components/LoadingState.jsx";
import EmptyState from "./components/EmptyState.jsx";
import ErrorMessage from "./components/ErrorMessage.jsx";

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
    <div className="auth-shell">
      <h1 style={{ marginBottom: "1.5rem" }}>Job Hunt Command Center</h1>
      <div className="auth-tabs">
        <button type="button" className="btn btn-secondary" onClick={() => setMode("login")} disabled={mode === "login"}>
          Log in
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setMode("signup")} disabled={mode === "signup"}>
          Sign up
        </button>
      </div>
      <form onSubmit={handleSubmit} className="card card-padded" aria-label={mode === "login" ? "Log in" : "Sign up"}>
        <div className="field">
          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            type="password"
            placeholder={mode === "signup" ? "Min 8 characters" : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "..." : mode === "login" ? "Log in" : "Sign up"}
          </button>
        </div>
        {errors.length > 0 && (
          <ul className="error-list" role="alert">
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [editingApplication, setEditingApplication] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState([]);
  const [addFormResetCount, setAddFormResetCount] = useState(0);

  const [deletingId, setDeletingId] = useState(null);
  const [actionError, setActionError] = useState(null);

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

  async function handleFormSubmit(values) {
    setFormSubmitting(true);
    setFormErrors([]);
    setActionError(null);

    if (editingApplication) {
      const { ok, status, data } = await apiFetch(`/applications/${editingApplication.id}`, { method: "PATCH", body: values, token });
      setFormSubmitting(false);
      if (!ok) {
        if (status === 401) return onLogout();
        setFormErrors(data.messages || [data.message || "Something went wrong."]);
        return; // stay in edit mode; the form's own state (what the user typed) is untouched
      }
      setApplications((prev) => prev.map((a) => (a.id === data.id ? data : a)));
      setEditingApplication(null);
    } else {
      const { ok, status, data } = await apiFetch("/applications", { method: "POST", body: values, token });
      setFormSubmitting(false);
      if (!ok) {
        if (status === 401) return onLogout();
        setFormErrors(data.messages || [data.message || "Something went wrong."]);
        return; // preserve entered values — form is not remounted on failure
      }
      setApplications((prev) => [data, ...prev]);
      setAddFormResetCount((n) => n + 1); // forces a fresh, empty form after a successful add
    }
  }

  function handleEditClick(application) {
    setFormErrors([]);
    setActionError(null);
    setEditingApplication(application);
  }

  function handleCancelEdit() {
    setFormErrors([]);
    setEditingApplication(null);
  }

  async function handleDelete(application) {
    if (deletingId) return; // a delete is already in flight; ignore duplicate clicks
    const confirmed = window.confirm(`Delete the application for ${application.role} at ${application.company}? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingId(application.id);
    setActionError(null);
    const { ok, status, data } = await apiFetch(`/applications/${application.id}`, { method: "DELETE", token });
    setDeletingId(null);

    if (!ok) {
      if (status === 401) return onLogout();
      setActionError(data.message || "Could not delete the application.");
      return; // application stays visible — deletion did not happen
    }
    setApplications((prev) => prev.filter((a) => a.id !== application.id));
  }

  // A stable-until-it-should-change key: switching which application
  // is being edited (or leaving edit mode) changes this, which is
  // exactly when ApplicationForm should remount and reset. A failed
  // save changes neither editingApplication.id nor addFormResetCount,
  // so the key — and therefore the form's in-progress state — stays
  // untouched.
  const formKey = editingApplication ? `edit-${editingApplication.id}` : `add-${addFormResetCount}`;
  const formInitialValues = useMemo(() => {
    if (!editingApplication) return undefined;
    const { company, role, jobUrl, jobDescription, status } = editingApplication;
    return { company, role, jobUrl: jobUrl ?? "", jobDescription, status };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingApplication?.id]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Job Hunt Command Center</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {userEmail && <span className="user-email">{userEmail}</span>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>

      <ApplicationForm
        key={formKey}
        mode={editingApplication ? "edit" : "add"}
        initialValues={formInitialValues}
        onSubmit={handleFormSubmit}
        onCancel={handleCancelEdit}
        submitting={formSubmitting}
        errors={formErrors}
      />

      <h2 className="section-title">Applications</h2>

      <ErrorMessage message={actionError} />

      {loading && <LoadingState label="Loading applications..." />}
      {loadError && <ErrorMessage message={`Could not load applications: ${loadError}`} />}
      {!loading && !loadError && applications.length === 0 && (
        <EmptyState message="No applications yet. Add your first application above." />
      )}

      {!loading && !loadError && applications.length > 0 && (
        <ul className="applications-list">
          {applications.map((application) => (
            <ApplicationCard
              key={application.id}
              application={application}
              onEdit={handleEditClick}
              onDelete={handleDelete}
              deleting={deletingId === application.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
