# YouTube API Remediation Checklist (NASFAQ)

Date: February 9, 2026  
Source: `NASFAQ_ ToS Violations Report V.1.pdf`

## Scope
This checklist maps each cited policy item to concrete remediation actions and evidence locations in this repository.

## Policy Mapping

1. `III.D.1c` (Accessing YouTube API Services)
- Requirement: Confirm whether multiple Google Cloud project numbers are used for this API Client and provide all related project numbers.
- Action: Manual response required to Google/YouTube compliance review.
- Status: Pending manual submission.
- Evidence: Include current project number `793306964069` and list any additional project IDs if applicable.

2. `III.A.1` (Terms must bind user to YouTube ToS)
- Requirement: Terms must state that users are bound by YouTube Terms of Service.
- Action: Added explicit clause with link to `https://www.youtube.com/t/terms`.
- Status: Implemented.
- Evidence: `client/app/terms/page.tsx`

3. `III.A.2a` (Privacy Policy exists)
- Requirement: API client must have a privacy policy.
- Action: Added dedicated Privacy Policy page.
- Status: Implemented.
- Evidence: `client/app/privacy/page.tsx`

4. `III.A.2b` (Disclose use of YouTube API Services)
- Requirement: Privacy Policy must disclose YouTube API Services usage.
- Action: Added explicit disclosure sentence.
- Status: Implemented.
- Evidence: `client/app/privacy/page.tsx`

5. `III.A.2c` (Google Privacy Policy link)
- Requirement: Privacy Policy must reference and link to Google Privacy Policy.
- Action: Added direct link to `http://www.google.com/policies/privacy`.
- Status: Implemented.
- Evidence: `client/app/privacy/page.tsx`

6. `III.A.2d` (What data is accessed/collected/stored/used)
- Requirement: Explain user/API data categories handled by the API client.
- Action: Added data categories section.
- Status: Implemented.
- Evidence: `client/app/privacy/page.tsx`

7. `III.A.2e` (How data is used, processed, shared)
- Requirement: Explain data usage/processing/sharing, including internal/external parties.
- Action: Added sections for use and sharing.
- Status: Implemented.
- Evidence: `client/app/privacy/page.tsx`

8. `III.A.2g` (Cookies/device storage disclosure)
- Requirement: Disclose cookies and similar technologies.
- Action: Added cookies and device storage section.
- Status: Implemented.
- Evidence: `client/app/privacy/page.tsx`

9. `III.A.2h` (Stored data deletion + revocation procedure)
- Requirement: Explain deletion procedure and include Google revocation page.
- Action: Added deletion request path and revocation link.
- Status: Implemented.
- Evidence: `client/app/privacy/page.tsx`

10. `III.A.2i` (Contact information)
- Requirement: Provide contact information.
- Action: Added contact email in Terms and Privacy pages.
- Status: Implemented.
- Evidence: `client/app/terms/page.tsx`, `client/app/privacy/page.tsx`

11. `III.E.4a-g` (Authorization token handling)
- Requirement: If storing authorization tokens, storage and use must be necessary and consistent with active-user consent and law.
- Action: Verify actual OAuth/token flows in production.
- Status: Pending verification and, if needed, implementation.
- Evidence to provide:
- If no user OAuth is used, explicitly state that no user authorization tokens are stored.
- If OAuth is used, document retention TTL, encryption at rest, scope minimization, deletion/revocation path, and lawful basis.

12. `III.E.4h` (Derived metrics replacing/creating unavailable YouTube data)
- Requirement: Do not use YouTube API to provide independent/derived metrics that replace unavailable YouTube API data.
- Action: Audit UI and API outputs for non-compliant derived metrics.
- Status: Pending product/legal review.
- Evidence to provide:
- Enumerated metric list exposed in UI/API.
- Confirmation that metrics are direct YouTube fields or policy-compliant transforms.

## Visibility Requirements
- Added persistent legal links site-wide:
- `Terms of Use`: `/terms`
- `Privacy Policy`: `/privacy`
- Evidence: `client/app/layout.tsx`

## Manual Follow-ups Before Resubmission
1. Confirm and submit all Google Cloud project numbers associated with NASFAQ.
2. Replace `privacy@nasfaq.com` with monitored production contact if different.
3. Complete `III.E.4a-g` token-handling declaration with production evidence.
4. Complete `III.E.4h` derived-metrics audit and retain reviewer notes/screenshots.
