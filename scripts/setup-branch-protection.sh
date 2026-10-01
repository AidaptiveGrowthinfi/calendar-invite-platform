#!/usr/bin/env bash
#
# Applies the `main` ruleset. Run once, after the repository exists.
#
#   ./scripts/setup-branch-protection.sh <owner>/<repo>
#
# Rulesets are included for PUBLIC repositories on GitHub Free and GitHub Free
# for organizations. On a private repository this call fails, and the failure
# is the plan, not the script.
#
# What this buys: the CI gates stop being advisory. Without it every check in
# .github/workflows/ci.yml still runs and still reports, and nothing prevents a
# merge while they are red.
set -euo pipefail

REPO="${1:-}"
if [[ -z "$REPO" ]]; then
  echo "usage: $0 <owner>/<repo>" >&2
  exit 1
fi

echo "Applying the main ruleset to ${REPO}..."

# Required status checks are named by their JOB NAME as GitHub sees it, which
# is the `name:` field in the workflow, not the job key. If a check name here
# does not match a real job, the ruleset waits for a check that never arrives
# and every pull request blocks forever - so these must stay in step with
# .github/workflows/ci.yml.
gh api --method POST "repos/${REPO}/rulesets" \
  --header 'Accept: application/vnd.github+json' \
  --input - <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Build and unit tests" },
          { "context": "Gate 2: tenant isolation (ADR 0052 req 7)" },
          { "context": "Gate 5: no ungenerated migration" },
          { "context": "Frozen invariants" }
        ]
      }
    }
  ]
}
JSON

echo
echo "Done. Two things worth knowing:"
echo
echo "  * required_approving_review_count is 1 and code-owner review is on."
echo "    .github/CODEOWNERS names both of you on every path, so every change"
echo "    is approved by whichever of you did not write it. If that is too"
echo "    heavy while the foundation is still moving, set the count to 0 - the"
echo "    status checks are the part that matters and they still apply."
echo
echo "  * A code owner without write access is silently ignored. Both"
echo "    accounts must have write access (the engineers team) before this"
echo "    ruleset is useful; otherwise pull requests wait for an approval"
echo "    nobody is able to give."
echo
echo "The four placeholder gate jobs (E2, E6, E7, E8) are deliberately NOT"
echo "required. They assert nothing yet; requiring them would train you both to"
echo "read a green check that means nothing. Add each one here when its ticket"
echo "lands."
