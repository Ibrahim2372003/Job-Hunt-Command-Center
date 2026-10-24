import test from "node:test";
import assert from "node:assert/strict";
import { findGroundingIssues, enforceGrounding, extractNumbers, extractTerms } from "../src/grounding.js";

const JD = "We need a backend engineer with Kubernetes, Terraform and AWS experience. Improve latency by 40%.";

test("grounding: a pure rephrase with no new facts is accepted", () => {
  const issues = findGroundingIssues({
    original: "Built REST APIs in Node.js serving 2,000 requests per second.",
    tailored: "Delivered REST APIs using Node.js, handling 2,000 requests per second.",
    jobDescription: JD,
  });
  assert.deepEqual(issues, []);
});

test("grounding: a fabricated metric is flagged as new_number", () => {
  const issues = findGroundingIssues({
    original: "Improved API performance.",
    tailored: "Improved API performance by 40%.",
    jobDescription: JD,
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, "new_number");
  assert.equal(issues[0].value, "40%");
  assert.equal(issues[0].inJobDescription, true, "the invented number was copied from the job description");
});

test("grounding: copying a JD skill the user never listed is flagged as keyword stuffing", () => {
  const issues = findGroundingIssues({
    original: "Deployed services to cloud servers.",
    tailored: "Deployed services to cloud servers using Kubernetes and Terraform on AWS.",
    jobDescription: JD,
  });
  const values = issues.map((i) => i.value).sort();
  assert.deepEqual(values, ["AWS", "Kubernetes", "Terraform"]);
  assert.ok(issues.every((i) => i.type === "new_term" && i.inJobDescription === true));
});

test("grounding: a new term not even in the JD is still flagged, with inJobDescription=false", () => {
  const [issue] = findGroundingIssues({
    original: "Wrote backend services.",
    tailored: "Wrote backend services at Google.",
    jobDescription: JD,
  });
  assert.equal(issue.value, "Google");
  assert.equal(issue.inJobDescription, false);
});

test("grounding: sentence-initial capitals and ordinary words are not treated as new terms", () => {
  const issues = findGroundingIssues({
    original: "wrote tests. reduced bugs.",
    tailored: "Wrote tests. Reduced bugs.",
    jobDescription: "",
  });
  assert.deepEqual(issues, []);
});

test("grounding: terms already in the original are fine, including plural/singular variants", () => {
  const issues = findGroundingIssues({
    original: "Designed PostgreSQL schemas and REST API endpoints.",
    tailored: "Designed PostgreSQL schemas and a REST APIs layer.",
    jobDescription: "",
  });
  assert.deepEqual(issues, []);
});

test("grounding: number formats are normalized ($1,000 == $1000, 5 % == 5%)", () => {
  assert.deepEqual([...extractNumbers("saved $1,000 and cut cost 5 %")].sort(), ["1000", "5%"]);
  assert.equal(findGroundingIssues({ original: "Saved $1,000.", tailored: "Saved $1000.", jobDescription: "" }).length, 0);
});

test("grounding: digits inside tokens (S3, EC2) are terms, not stray numbers", () => {
  assert.deepEqual(extractTerms("Stored files in S3 and ran EC2 instances."), ["S3", "EC2"]);
  assert.equal(extractNumbers("Stored files in S3 and ran EC2 instances.").size, 0);
});

test("enforceGrounding: reverts only the offending bullet and reports why", () => {
  const baseBullets = ["Built APIs in Node.js.", "Mentored two junior developers."];
  const tailoredBullets = ["Built APIs in Node.js on Kubernetes.", "Mentored two junior developers on code quality."];
  const { bullets, reports } = enforceGrounding({ baseBullets, tailoredBullets, jobDescription: JD });

  assert.equal(bullets[0], baseBullets[0], "ungrounded bullet is reverted to the user's original");
  assert.equal(bullets[1], tailoredBullets[1], "grounded bullet is kept");
  assert.equal(reports[0].status, "reverted_to_original");
  assert.equal(reports[0].rejectedText, tailoredBullets[0]);
  assert.equal(reports[0].issues[0].value, "Kubernetes");
  assert.equal(reports[1].status, "accepted");
});

test("enforceGrounding: refuses misaligned arrays rather than guessing", () => {
  assert.throws(() => enforceGrounding({ baseBullets: ["a"], tailoredBullets: ["a", "b"] }), /index-aligned/);
});
