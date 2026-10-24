import { useState } from "react";
import StatusBadge from "./StatusBadge.jsx";
import TailorPanel from "./TailorPanel.jsx";
import ReportPanel from "./ReportPanel.jsx";

// Only ever render a URL as a clickable link if it's a genuine
// http(s) URL — guards against both a malformed string breaking
// anything and a crafted `javascript:` value being clicked as a link.
function isSafeHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export default function ApplicationCard({ application, token, onUnauthorized, onEdit, onDelete, deleting }) {
  // The AI tools mount on first open (so listing applications doesn't fire a
  // report-status request per card) and then stay mounted while collapsed, so
  // typed bullets, results, and an in-progress report poll are not lost.
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const toolsId = `ai-tools-${application.id}`;

  function toggleTools() {
    setOpen((o) => !o);
    setEverOpened(true);
  }
  const hasUrl = Boolean(application.jobUrl);
  const hasSafeUrl = hasUrl && isSafeHttpUrl(application.jobUrl);

  return (
    <li className="card application-card">
      <div className="application-card-top">
        <div className="application-card-title">
          <h3>{application.role}</h3>
          <div className="company">{application.company}</div>
        </div>
        <div className="application-card-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(application)}>
            Edit
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => onDelete(application)} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      <div>
        <StatusBadge status={application.status} />
      </div>

      {hasUrl && (
        <div className="application-card-link">
          {hasSafeUrl ? (
            // Never render the raw URL text — only ever this fixed
            // label — so no string, however long or malformed, can
            // ever expand the card. overflow-wrap/word-break in
            // index.css is a second, independent guard for the rare
            // case a legitimate-but-unbroken URL still ends up
            // rendered somewhere.
            <a href={application.jobUrl} target="_blank" rel="noreferrer" aria-label={`View job posting for ${application.company}`}>
              View job posting
            </a>
          ) : (
            <span className="company">Job link provided is not a valid web address.</span>
          )}
        </div>
      )}

      <div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={toggleTools} aria-expanded={open} aria-controls={toolsId}>
          {open ? "Hide AI tools" : "AI tools"}
        </button>
      </div>

      <div id={toolsId} className="ai-tools" hidden={!open}>
        {everOpened && (
          <>
            <TailorPanel application={application} token={token} onUnauthorized={onUnauthorized} />
            <ReportPanel application={application} token={token} onUnauthorized={onUnauthorized} />
          </>
        )}
      </div>
    </li>
  );
}
