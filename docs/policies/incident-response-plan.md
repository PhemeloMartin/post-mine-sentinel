# Information-security incident response plan

Based on the NIST SP 800-61 lifecycle: **prepare → detect & analyse → contain, eradicate & recover → post-incident activity**.

## 1. Severity levels

| Level | Examples | Response time |
|---|---|---|
| SEV-1 | Leak of active-site locations; signing key or site key compromise; evidence tampering | 15 min, 24/7 |
| SEV-2 | Spoofed or replayed frames at a site; console account takeover; DLQ growing | 1 h |
| SEV-3 | Single node theft; failed login bursts | Next business day |

## 2. Roles
Incident commander (on-call SRE lead) · security lead · Information Officer (POPIA) · communications · legal counsel · DMPR liaison.

## 3. Playbooks
* **Site key compromise:** rotate the site key in Key Vault (HSM), re-provision nodes, invalidate old keys in ingest, review alerts from the affected window, and report to the regional SOC.
* **Evidence-signing key compromise:** revoke and publish the revocation; rotate; re-sign open-case bundles with the new key; notify the NPA of affected cases.
* **Location data leak:** assume the sites are compromised; increase physical response readiness; alert SAPS; preserve logs; trace via the audit chain (who viewed what, when).
* **Account takeover:** disable the account; revoke sessions (rotate the JWT secret if needed); review that user's audit trail; enforce MFA.
* **Spoofing or replay at a site:** confirm via the `frames_auth_failed` and `frames_replayed` metrics; check for rogue transmitters; physically inspect.

## 4. Notification (POPIA s22, Cybercrimes Act)
Where personal information of staff or data subjects is involved, notify the **Information Regulator** and affected data subjects as soon as reasonably possible after discovery. Report cybercrimes to SAPS where required. Record every notification in the incident log.

## 5. Evidence preservation
Snapshot logs, export the audit chain (verify hashes), and preserve container images and digests. Chain of custody follows the case-service rules.

## 6. Post-incident
A blameless review within 5 working days, with action items tracked to closure, ADR updates and test cases added for the failure mode.
