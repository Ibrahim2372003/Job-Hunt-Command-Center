import { useState } from "react";

const STATUSES = ["SAVED", "APPLIED", "INTERVIEW", "OFFER", "REJECTED"];
const EMPTY_VALUES = { company: "", role: "", jobUrl: "", jobDescription: "", status: "SAVED" };

/**
 * One form, two modes. Deliberately reads `initialValues` only once,
 * at mount, via useState's lazy form — no effect-based resyncing.
 * The parent (App.jsx) is responsible for giving this component a
 * `key` that changes exactly when the form should reset (switching
 * which application is being edited, cancelling, or a successful
 * save) and stays the SAME through everything else (in particular, a
 * failed save). React remounts on key change, which resets local
 * state cleanly; when the key doesn't change, this component's state
 * — including whatever the user has typed — is left completely
 * alone, which is what keeps a failed save from silently discarding
 * in-progress edits.
 */
export default function ApplicationForm({ mode = "add", initialValues, onSubmit, onCancel, submitting, errors }) {
  const [values, setValues] = useState(initialValues ?? EMPTY_VALUES);

  function updateField(field) {
    return (event) => setValues((prev) => ({ ...prev, [field]: event.target.value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(values);
  }

  const isEdit = mode === "edit";

  return (
    <form onSubmit={handleSubmit} className="card card-padded" aria-label={isEdit ? "Edit application" : "Add application"}>
      <div className="field-row">
        <div className="field">
          <label htmlFor="app-company">Company</label>
          <input id="app-company" value={values.company} onChange={updateField("company")} required />
        </div>
        <div className="field">
          <label htmlFor="app-role">Role</label>
          <input id="app-role" value={values.role} onChange={updateField("role")} required />
        </div>
      </div>

      <div className="field">
        <label htmlFor="app-jobUrl">Job URL (optional)</label>
        <input id="app-jobUrl" type="url" value={values.jobUrl} onChange={updateField("jobUrl")} placeholder="https://" />
      </div>

      <div className="field">
        <label htmlFor="app-jobDescription">Job description</label>
        <textarea id="app-jobDescription" value={values.jobDescription} onChange={updateField("jobDescription")} required rows={4} />
      </div>

      <div className="field">
        <label htmlFor="app-status">Status</label>
        <select id="app-status" value={values.status} onChange={updateField("status")}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Saving..." : isEdit ? "Save changes" : "Add application"}
        </button>
        {isEdit && (
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        )}
      </div>

      {errors && errors.length > 0 && (
        <ul className="error-list" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
