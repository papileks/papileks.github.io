---
layout: page
title: ReloSafe SRD
permalink: /relosafe/requirements/
---

# ReloSafe — System Requirements Document
**One-Click Address Change Platform**

| | |
|---|---|
| Document ID | RS-SRD-001 |
| Version | 0.2 (Draft) |
| Date | 2026-10-12 |
| Status | For Review |
| Owner | Product (TBD — name required before v1.0) |
| Approvers | Product, Engineering, Legal/Privacy, Fraud & Risk, Security |

### Change History

| Version | Date | Summary |
|---|---|---|
| 0.1 | 2026-07-03 | Initial draft |
| 0.2 | 2026-10-12 | Review fixes: hold period before high-risk execution and revert flow; protected-mover path; USPS/NCOA assumptions corrected; at-most-once execution with reconciliation; re-consent on channel fallback; package-closure-based retention; vendor deletion; new state machine; measurable parameters (Appendix A); traceability (Appendix B); prototype scope (Section 11). Changed or new IDs are marked **[v0.2]**. |

---

## 1. Purpose & Scope

### 1.1 Purpose
This document sets out the system requirements for ReloSafe. ReloSafe is a privacy-first platform that lets a user update their mailing and residential address across many institutions (financial, government, utility, subscription, healthcare, insurance) through one verified workflow.

### 1.2 Problem Statement
The average U.S. mover must notify 15–40 entities of an address change one by one. Each entity has its own process (web form, phone call, mailed letter, in-person visit), its own authentication requirements and its own lag time. Missed updates cause lost mail, missed bills, service interruptions, identity-theft exposure and compliance issues, such as missing the deadlines for vehicle and voter registration.

### 1.3 Product Vision
"One Move, Zero Stress." The user verifies their identity once, confirms their new address once and chooses which entities to notify. ReloSafe then carries out and tracks every change to completion. It keeps the least data necessary for the shortest time necessary (ephemeral by design).

**"One click" means one authorization step [v0.2].** Some changes cannot finish in the same session:
- verification by mail,
- the fraud hold period (FR-FRD-006),
- entity-side challenges.

The product shall state these waits honestly and never hide them.

### 1.4 In Scope (MVP; Phase 2 boundaries noted)
- Identity and address verification
- Entity catalog (top 100 entities by user frequency) and connection management
- Address-change execution (API, partner integration, assisted change, user-guided fallback)
- Status tracking dashboard ("My Status")
- USPS Change of Address through the **user-guided** channel [v0.2]
- Fraud controls: hold period, old-address notice, dispute and revert, protected-mover path [v0.2]
- Notifications and audit trail
- Data minimization and deletion lifecycle, including deletion at subprocessors [v0.2]

### 1.5 Out of Scope (MVP)
- Physical moving services (truck booking, movers marketplace)
- Mail scanning or a virtual mailbox
- International relocations (Phase 3)
- Business or commercial address changes (Phase 3)
- Email-inbox discovery (Phase 2; it depends on a Google restricted-scope security assessment) [v0.2]
- Storing third-party login credentials (prohibited at MVP; see FR-EXE-002) [v0.2]
- Catalog beyond the top 100 entities (Phase 2) [v0.2]

---

## 2. Stakeholders & Actors

| Actor | Description |
|---|---|
| Mover (Primary User) | Individual relocating; owns the address-change request |
| Protected Mover [v0.2] | A mover whose safety depends on keeping their new address hidden from people at the old address (for example, domestic-violence survivors and Address Confidentiality Program participants) |
| Household Member | Secondary user included in a shared move (spouse, dependents) |
| Entity / Institution | Bank, credit card issuer, insurer, utility, DMV, IRS, subscription service, etc. |
| Integration Partner | API providers (for example, banking data aggregators, identity verification vendors, address validation vendors) |
| Subprocessor [v0.2] | Any vendor that receives personal data from ReloSafe (IDV, print/mail, aggregator, notifications, payments) |
| Support Agent | ReloSafe staff who handle assisted changes, disputes and protected-mover reviews |
| System Administrator | Manages the entity catalog, integration health and compliance operations |
| Regulator / Auditor | GDPR/CCPA/GLBA oversight; requires audit evidence |

---

## 3. Definitions

| Term | Definition |
|---|---|
| Entity | Any organization holding the user's address on file |
| Change Order | A single instruction to update the user's address at one entity |
| Revert Order [v0.2] | A Change Order that restores the old address at an entity, raised only by an upheld dispute |
| Move Package | The set of Change Orders associated with one relocation event |
| High-Risk Entity [v0.2] | An entity in the Financial, Government, Insurance or Employer/Payroll category, or any entity the catalog flags as an account-takeover target |
| Hold Period [v0.2] | Waiting period between authorization and release of High-Risk Change Orders, while the old-address notice is in transit (Appendix A) |
| Dispute Window [v0.2] | Period after authorization during which a dispute can lock the package and trigger Revert Orders (Appendix A) |
| Package Closure [v0.2] | The point at which every Change Order is terminal, the Dispute Window has ended and propagation checks are complete. The retention clock starts here. |
| Audience Rank [v0.2] | Ordering of execution channels by who can see the user's data: guided (0: the user only) < API (1: the entity's system) < partner (2: partner and entity) < assisted (3: a ReloSafe agent and the entity) |
| NCOA | USPS National Change of Address database (list-hygiene product; see NFR-CMP-003) |
| IDV | Identity Verification |
| Ephemeral Data | User data kept only until Package Closure plus the user's retention window |
| Execution Channel | The method used to make a change: API, partner rail, assisted change or user-guided |

---

## 4. Functional Requirements

### 4.1 Identity & Account (IDV)

| ID | Requirement | Priority |
|---|---|---|
| FR-IDV-001 | The system shall verify the user's identity before executing any Change Order, using a NIST 800-63A IAL2-equivalent process (government ID + liveness/selfie match, or equivalent). | Must |
| FR-IDV-002 | The system shall verify the user's link to the *current* (old) address through at least one independent signal: credit header data, a utility record, a micro-verification letter or a bank-linked address match. **NCOA data shall not be used for this check** (NFR-CMP-003). [v0.2] | Must |
| FR-IDV-003 | The system shall check that the *new* address is valid and deliverable using CASS/DPV validation, and show the standardized result. | Must |
| FR-IDV-004 | Before releasing High-Risk Change Orders, the system shall verify that the user controls the new address. Accepted evidence before the move: a signed lease, a closing disclosure or deed, or an employer relocation letter. Accepted evidence after the move: a utility activation record or a mailed code. For future-dated moves, evidence from before the move is enough; a mailed code may be added after the effective date if the risk score requires it. [v0.2] | Must |
| FR-IDV-005 | The system shall require multi-factor authentication for every session login and step-up MFA before authorizing a Move Package. | Must |
| FR-IDV-006 | The system shall let a primary user add household members to a Move Package. Each adult household member shall complete their own identity verification. Joint accounts require consent from every adult holder. | Should |
| FR-IDV-007 | If a Move Package is changed after authorization, the system shall require step-up MFA. It shall also require fresh proof of control of the new address (FR-IDV-004) when the new address is edited. Full IAL2 re-verification is required only when the risk score crosses the step-up threshold (Appendix A). [v0.2] | Must |

### 4.2 Entity Catalog & Discovery

| ID | Requirement | Priority |
|---|---|---|
| FR-CAT-001 | At MVP the system shall keep a catalog of the **top 100 entities by user frequency**, growing to 1,000+ in Phase 2. Each catalog record holds: category, risk class, ordered execution channels, required fields, address type accepted (residential / mailing / both), expected completion SLA, confirmation method, and whether delegated changes are permitted. [v0.2] | Must |
| FR-CAT-002 | The system shall suggest candidate entities through opt-in bank-account aggregation that detects billers, with explicit consent for each source. Email-inbox discovery is Phase 2. [v0.2] | Should |
| FR-CAT-003 | The system shall let the user add an entity that is not in the catalog. Such entities shall be sent to the user-guided channel (generated letter or instructions) unless a support agent confirms that delegated changes are permitted. [v0.2] | Must |
| FR-CAT-004 | The system shall group entities by category (Financial, Government, Utilities, Insurance, Healthcare, Subscriptions, Employer/Payroll, Other). Within each group they shall be sorted by (1) statutory deadline, then (2) risk class, then (3) catalog SLA. [v0.2] | Must |
| FR-CAT-005 | The system shall flag entities that have statutory deadlines, showing the deadline as a date. Examples: vehicle registration (varies by state; often 10–30 days) and voter registration. Immigration filings (for example, USCIS AR-11) shall appear only if the user turns on a generic "I have federal immigration filings" option. The system shall not ask for or store immigration status. [v0.2] | Must |
| FR-CAT-006 | The system shall track integration health for each entity. When the preferred channel is degraded or disabled by a kill switch, the system shall fall back to the next channel, **subject to FR-MOV-007**. [v0.2] | Should |
| FR-CAT-007 | **[v0.2]** Government entities (DMV, voter registration, IRS, USCIS, USPS) shall default to the user-guided channel. Delegated execution needs a legal review recorded in the catalog record for each agency. | Must |

### 4.3 Move Package Creation & Authorization

| ID | Requirement | Priority |
|---|---|---|
| FR-MOV-001 | The system shall let the user create a Move Package with: old address, new address, address type (residential, mailing or both), effective date (past, present or future) and the chosen entities. | Must |
| FR-MOV-002 | The system shall support future-dated execution. A Change Order is released on or after the later of (a) the effective date and (b) the end of the Hold Period for High-Risk entities. [v0.2] | Must |
| FR-MOV-003 | The system shall show one explicit authorization screen before anything runs. For each entity it shall show the data fields to be shared, the primary channel and its audience, and any statutory deadline. It shall also show the Hold Period end date and the Dispute Window end date. Consent shall be recorded with a timestamp, the screen version shown and the authorized channel audience rank for each Change Order. [v0.2] | Must |
| FR-MOV-004 | The system shall generate a signed Letter of Authorization (LOA) for each entity that needs written consent to act on the user's behalf. | Must |
| FR-MOV-005 | The system shall let the user cancel or change any Change Order that has not yet been submitted. Executed changes can only be undone through a dispute (FR-FRD-007) or a correction order (FR-EXE-008). [v0.2] | Must |
| FR-MOV-006 | The system shall respect the address type each entity uses. Government entities that need a residential address shall get one; a PO Box or mail-receiving agency address shall not be sent to them. [v0.2: raised from Should] | Must |
| FR-MOV-007 | **[v0.2]** If a Change Order must switch to a channel with a **higher Audience Rank** than the user approved, it shall move to `Awaiting Consent`. The user then either approves the new channel and audience or chooses the user-guided channel. Fallback to an equal or lower rank needs no new consent but shall be logged and shown. | Must |
| FR-MOV-008 | **[v0.2]** Before authorization, the system shall show the standardized new address and have the user confirm it field by field (including the unit or apartment number). | Must |

### 4.4 Execution Engine

| ID | Requirement | Priority |
|---|---|---|
| FR-EXE-001 | The system shall execute Change Orders using the first available channel in the entity's catalog order: (1) direct entity API, (2) integration-partner rail, (3) assisted change (agent or RPA under an LOA, where the entity's terms of service permit it), (4) user-guided (pre-filled instructions, deep link, or a generated letter or PDF). | Must |
| FR-EXE-002 | The system shall **not store third-party login credentials** at MVP. Where access is needed, it shall use OAuth or other delegated, scoped, revocable tokens kept per NFR-SEC-004. Entities that only allow credentialed access shall use the user-guided channel. [v0.2] | Must |
| FR-EXE-003 | The system shall retry failed submissions with exponential backoff, up to the retry limit (Appendix A). After the limit it shall fall back to the next channel (subject to FR-MOV-007) and notify the user. **No retry shall be attempted while the result of the previous attempt is unknown** (FR-EXE-009). [v0.2] | Must |
| FR-EXE-004 | The system shall store a confirmation artifact for every confirmed Change Order: an API response ID, a confirmation number, or a receipt or screenshot for assisted changes. For user-guided orders, the user enters the confirmation number. | Must |
| FR-EXE-005 | The system shall support USPS Change of Address through the **user-guided** channel: a deep link to the official USPS flow (which includes USPS's own identity-verification fee), pre-filled instructions and a place to record the USPS confirmation number. Direct filing by ReloSafe is out of scope unless a USPS partnership is signed (Section 8, item 2). [v0.2] | Must |
| FR-EXE-006 | The system shall enforce rate limits and execution windows for each entity (for example, business hours for assisted changes). | Should |
| FR-EXE-007 | The system shall detect entity-side verification challenges (for example, "the bank will call you" or "a code was mailed to your old address") and show them as user action items. | Must |
| FR-EXE-008 | **[v0.2]** The system shall support Correction Orders that fix a wrong address already submitted to an entity, for example a wrong unit number. Correction Orders follow the normal channel rules and skip the Hold Period only if the address change is limited to the unit/secondary line. | Must |
| FR-EXE-009 | **[v0.2]** When a submission's result is unknown (timeout, a failed RPA session or an ambiguous response), the Change Order shall move to `Outcome Unknown`. The system shall then check the entity's records (a status query, the confirmation channel, or a support check) and record whether the change was applied before any retry is allowed. | Must |
| FR-EXE-010 | **[v0.2]** Agents performing assisted changes shall identify themselves as authorized representatives acting under the user's LOA. They shall never pretend to be the user. | Must |

### 4.5 Status Tracking & Notifications

| ID | Requirement | Priority |
|---|---|---|
| FR-STA-001 | The system shall provide a "My Status" dashboard showing each Change Order's state according to the state machine in Section 4.10. [v0.2] | Must |
| FR-STA-002 | The system shall notify the user (push, email or SMS, as the user prefers) when a Change Order enters `Awaiting User Action`, `Awaiting Consent`, `Failed` or `Expired`, when the Hold Period ends and at Package Closure. Notifications shall not contain the new address. [v0.2] | Must |
| FR-STA-003 | The system shall show a completion score (confirmed ÷ non-cancelled Change Orders) and, for each entity, an estimated time to complete based on catalog SLAs and the Hold Period. [v0.2] | Should |
| FR-STA-004 | The system shall provide an exportable summary report (PDF and machine-readable JSON) of all changes and their confirmation artifacts. It shall be available until PII deletion, and the user shall be reminded 7 days before deletion. [v0.2] | Should |
| FR-STA-005 | Where a data source exists, the system shall verify propagation at the check interval in Appendix A, for example by re-querying aggregator data. It shall flag differences as user action items. | Could |

### 4.6 Privacy, Consent & Data Lifecycle

| ID | Requirement | Priority |
|---|---|---|
| FR-PRV-001 | The system shall collect only the fields the chosen entities need (data minimization). Before authorization it shall show exactly which fields go to which entity. | Must |
| FR-PRV-002 | The system shall delete Move Package PII once the user's retention window has passed **after Package Closure** (default 30 days; the user can choose 0–90 days). Only a non-PII audit skeleton shall be kept. Because Package Closure always waits for the Dispute Window and propagation checks to finish, choosing 0 days never cuts short fraud protection or verification. [v0.2] | Must |
| FR-PRV-003 | The system shall let the user delete their data immediately (right to erasure) and export it (right to portability) under GDPR/CCPA. If a user asks for erasure while the Dispute Window is open, the system shall explain that ending fraud protection early cannot be undone and ask the user to confirm. [v0.2] | Must |
| FR-PRV-004 | The system shall get separate consent for each discovery connection and let the user withdraw it at any time. Withdrawing consent deletes all data from that source. | Must |
| FR-PRV-005 | The system shall never sell Move Package data, share it for advertising, or use it for anything other than carrying out and supporting the move. Every data store and read path shall check a purpose tag, and reads without an allowed purpose shall be refused and logged. [v0.2: method specified] | Must |
| FR-PRV-006 | The system shall keep an immutable audit log of consents and actions: who authorized what, when, and to whom data was sent. Retained audit records are pseudonymous and keyed to the package ID. At Package Closure the user receives a **closure receipt** (package ID + access code) that lets them view the skeleton after deletion. The legal basis for keeping it (legal obligation and fraud prevention, including the CCPA security/fraud exception) shall be documented in the RoPA (Record of Processing Activities). [v0.2] | Must |
| FR-PRV-007 | **[v0.2]** Deletion shall reach every subprocessor (IDV, print/mail, aggregator, notification, payments). The system shall send a deletion request through each vendor's contractual interface and record its confirmation. ID images and selfies shall be deleted by the IDV vendor within the period set in its contract (Appendix A). | Must |
| FR-PRV-008 | **[v0.2]** Sensitive data classes (biometric templates, immigration-filing flags, protected-mover status) shall be tagged `SENSITIVE_PII`. They are visible only to the roles that need them. | Must |

### 4.7 Fraud & Abuse Prevention

| ID | Requirement | Priority |
|---|---|---|
| FR-FRD-001 | The system shall give every Move Package an account-takeover and address-fraud risk score. Inputs include velocity, device fingerprint, mismatched old-address signals and destination types that receive mail on someone's behalf (mail-receiving agencies, mail drops). **Demographic or ZIP-code features that could act as proxies for protected classes shall not be used.** The model shall be tested for disparate impact before launch and every quarter after. [v0.2] | Must |
| FR-FRD-002 | When a Move Package is authorized, the system shall send a notice to the old address (a physical letter) and to all verified contact channels. The notice explains how to dispute or stop the move. **It shall never include the new address or the list of entities.** Protected movers use FR-FRD-008 instead. [v0.2] | Must |
| FR-FRD-003 | The system shall send moves involving known fraud-list addresses to manual review. A mail-receiving agency or PO Box destination alone shall trigger review, not a block, so that military, mobile and protected movers are not excluded. [v0.2] | Must |
| FR-FRD-004 | A dispute shall lock the Move Package against further changes. All Change Orders not yet submitted shall move to `Locked`. | Must |
| FR-FRD-005 | The system shall report suspected identity fraud as the law and partner agreements require. | Should |
| FR-FRD-006 | **[v0.2]** High-Risk Change Orders that ReloSafe executes (API, partner or assisted channel) shall not be released until the Hold Period ends (Appendix A). The period is longer when the risk score is high. User-guided orders are exempt, because the user submits them directly to the entity, which runs its own verification; this also protects short statutory deadlines. Non-high-risk orders may be released right away. | Must |
| FR-FRD-007 | **[v0.2]** If a dispute is upheld, the system shall create a Revert Order for every Change Order already confirmed in that package. Revert Orders skip the Hold Period and are tracked to completion. If the dispute is rejected, locked orders return to their previous state. | Must |
| FR-FRD-008 | **[v0.2] Protected-mover path:** the user may ask for protected-mover handling. The request is reviewed by a trained agent and supported by alternative proof (for example, an Address Confidentiality Program card or an advocate letter). Once approved: (a) the old-address letter is suppressed and notices go only to verified contact channels; (b) the Hold Period still applies; (c) where an Address Confidentiality Program substitute address exists, it is used for government entities; (d) protected-mover status is `SENSITIVE_PII`. | Must |

### 4.8 Support & Assisted Operations

| ID | Requirement | Priority |
|---|---|---|
| FR-SUP-001 | The system shall give support agents a work queue for assisted Change Orders. It shall show only the minimum PII that entity's process needs, and log every access. | Must |
| FR-SUP-002 | The system shall support secure messaging between the user and an agent within a Change Order. | Should |
| FR-SUP-003 | The system shall give the user pre-written scripts and letters for entities where the user must act personally, such as some government agencies. | Must |
| FR-SUP-004 | **[v0.2]** The system shall give agents a dispute-investigation queue and a protected-mover review queue, each with set response times (Appendix A). | Must |

### 4.9 Fees & Payments [v0.2]

| ID | Requirement | Priority |
|---|---|---|
| FR-PAY-001 | The system shall show the total fee before authorization and charge only after authorization. Third-party fees, such as the USPS identity-verification fee, are paid by the user directly to that third party. | Must |
| FR-PAY-002 | The system shall refund the service fee in proportion to Change Orders that end in `Failed` or `Expired` through no fault of the user, and in full when a dispute is upheld. | Should |
| FR-PAY-003 | Card data shall be tokenized by the payments processor. ReloSafe systems shall never store card numbers (PCI SAQ-A scope). | Must |

### 4.10 Change Order State Machine [v0.2]

| State | Meaning | Allowed next states |
|---|---|---|
| Draft | Selected but not authorized | Authorized, Cancelled |
| Authorized | Consent captured | On Hold, Scheduled, Awaiting User Action (guided), Cancelled |
| On Hold | High-risk order waiting for the Hold Period to end | Scheduled, Locked, Cancelled |
| Scheduled | Waiting for the effective date, backoff or a channel to become available | In Progress, Awaiting User Action, Awaiting Consent, Locked, Cancelled, Failed (no channel left) |
| In Progress | Submission in flight | Confirmed, Outcome Unknown, Scheduled (retry), Awaiting User Action, Awaiting Consent, Failed |
| Outcome Unknown | Result of the submission is unclear | Confirmed (found applied), Scheduled (confirmed not applied), Failed |
| Awaiting User Action | User must act (guided channel, entity challenge, propagation discrepancy) | Confirmed, Scheduled, Expired, Cancelled, Locked |
| Awaiting Consent | Fallback needs a wider data audience | Scheduled (consent granted), Awaiting User Action (user chose guided), Cancelled, Locked, Expired |
| Locked | Package under dispute | Previous non-terminal state: On Hold, Scheduled, Awaiting User Action or Awaiting Consent (dispute rejected); Cancelled (dispute upheld) |
| Confirmed | Change applied, artifact stored | Reverted (dispute upheld) |
| Failed / Expired / Cancelled / Reverted | Terminal | — |

Every transition shall be stored as an event with a timestamp, actor, reason and channel (NFR-REL-002).

---

## 5. Non-Functional Requirements

Priorities: **M** = MVP gate, **S** = target for MVP but not a gate, **P2** = Phase 2. [v0.2]

### 5.1 Security

| ID | Requirement | Pri |
|---|---|---|
| NFR-SEC-001 | All PII shall be encrypted at rest (AES-256 or stronger), using a separate envelope key for each package, and in transit (TLS 1.3). Backups, search indexes and analytics copies shall be encrypted with the same package keys. [v0.2] | M |
| NFR-SEC-002 | Internal access to PII shall follow least-privilege, role-based access control. Every access shall be logged and able to trigger alerts. | M |
| NFR-SEC-003 | The system shall have independent penetration testing before GA and at least once a year after. GA requires **zero open critical or high findings**. SOC 2 Type I at GA; SOC 2 Type II within 12 months of GA. [v0.2] | M |
| NFR-SEC-004 | Secrets and delegated tokens shall be kept in a vault managed by a hardware-backed KMS/HSM. No secrets in code, logs or configuration. | M |
| NFR-SEC-005 | The system shall detect unusual internal data access (insider threat) and unusual user session behavior. | S |
| NFR-SEC-006 | Retention expiry shall be enforced by destroying the package key (crypto-shredding), so data in every copy, backups included, becomes unreadable. | M |

### 5.2 Privacy & Compliance

| ID | Requirement | Pri |
|---|---|---|
| NFR-CMP-001 | The system shall comply with GDPR, CCPA/CPRA and applicable U.S. state privacy laws. A DPIA (Data Protection Impact Assessment) shall be completed before GA. | M |
| NFR-CMP-002 | Handling of financial data shall comply with the GLBA Safeguards Rule. Aggregator connections shall use token-based, consented, revocable access following FDX standards, whatever the final form of the CFPB Section 1033 rule. [v0.2] | M |
| NFR-CMP-003 | Any use of USPS products shall follow their license terms. NCOALink data, if licensed, shall be used only to update ReloSafe's own contact records (list hygiene). It shall not be used for identity, move verification or product features without written compliance approval. [v0.2] | M |
| NFR-CMP-004 | The system shall keep a RoPA and honor Do-Not-Sell/Share signals (GPC, Global Privacy Control). | M |
| NFR-CMP-005 | Assisted changes shall be made only under a documented LOA and within each entity's terms of service. Entities that prohibit delegated changes shall be sent to the user-guided channel. | M |
| NFR-CMP-006 | **[v0.2]** Assisted changes shall comply with the GLBA §521 rule against pretexting (see FR-EXE-010). | M |

### 5.3 Availability, Performance, Scalability

| ID | Requirement | Pri |
|---|---|---|
| NFR-PRF-001 | Core user-facing services shall be available 99.9% of each month. A degraded execution engine shall not lose accepted Change Orders (durable queue). | M |
| NFR-PRF-002 | Dashboard interactions shall have a p95 server response under 500 ms. Each step of the authorization flow shall complete in under 3 s end to end. | M |
| NFR-PRF-003 | **[v0.2]** Design targets (assumptions to confirm by forecast): 20,000 new Move Packages per day, 400,000 Change Order submissions per day, 5,000 concurrent user sessions. Peak season (May–Sept) is 3× these numbers. | M |
| NFR-PRF-004 | Address validation responses (CASS/DPV) p95 < 800 ms. | S |
| NFR-PRF-005 | **[v0.2]** Change Orders shall be submitted **at most once** for each attempt, carrying an idempotency key wherever the entity supports one. Duplicate submissions shall be prevented by the `Outcome Unknown` reconciliation step (FR-EXE-009), not by blind retries. | M |

### 5.4 Reliability & Data Integrity

| ID | Requirement | Pri |
|---|---|---|
| NFR-REL-001 | Core services shall have RPO ≤ 5 minutes and **RTO ≤ 30 minutes**, so a single incident fits within the 99.9% monthly availability budget. [v0.2] | M |
| NFR-REL-002 | Every Change Order shall have a complete, append-only state history (event-sourced or equivalent). Execution is effectively once: at most once per attempt, plus reconciliation. [v0.2] | M |
| NFR-REL-003 | Confirmation artifacts shall be kept under the retention policy and made tamper-evident with a hash chain. | M |

### 5.5 Usability & Accessibility

| ID | Requirement | Pri |
|---|---|---|
| NFR-USE-001 | The product shall meet WCAG 2.2 AA. | M |
| NFR-USE-002 | A first-time user shall be able to complete the active steps of the main path (verify → addresses → select entities → authorize) in under 15 minutes. Waiting for mail, the Hold Period and entity processing are not counted, but shall be shown with their expected durations. [v0.2] | M |
| NFR-USE-003 | Mobile-responsive web at MVP; native apps in Phase 2. | M / P2 |
| NFR-USE-004 | English at MVP; Spanish in Phase 2. | M / P2 |

### 5.6 Observability & Operations

| ID | Requirement | Pri |
|---|---|---|
| NFR-OPS-001 | Integration dashboards for each entity: success rate, latency, fallback rate, Outcome Unknown rate and SLA breach alerts. [v0.2] | M |
| NFR-OPS-002 | Distributed tracing across the execution pipeline, with PII removed from logs and traces. | M |
| NFR-OPS-003 | Feature flags and per-entity, per-channel kill switches, so a failing integration can be turned off without a deploy. | M |

---

## 6. Interfaces & Integrations (ICD Summary)

| Interface | Direction | Purpose | Notes |
|---|---|---|---|
| Address validation (CASS/DPV) | Outbound | Address validation and standardization | Licensed vendor or direct |
| USPS Change of Address | User-guided deep link | Official mail forwarding | ReloSafe does not file; the user records the confirmation number [v0.2] |
| USPS NCOALink (optional) | Outbound | List hygiene for ReloSafe's own contact records only | Not used for identity or move verification [v0.2] |
| Identity Verification Vendor | Outbound | ID document and biometric IDV, watchlists | IAL2-capable; deletion must be guaranteed by contract [v0.2] |
| Banking Aggregator (FDX) | Outbound | Biller discovery; address confirmation | Explicit consent; token-based |
| Entity Direct APIs | Outbound | Address updates where supported | ICD for each entity kept in the catalog; idempotency key support recorded [v0.2] |
| Email Provider (OAuth) | Outbound | Subscription discovery (opt-in) | **Phase 2**; needs Google restricted-scope assessment [v0.2] |
| Notification Services | Outbound | Email, SMS, push | No new address in message bodies [v0.2] |
| Print/Mail Vendor | Outbound | Physical letters (old-address notice, LOAs, agency letters) | Proof of mailing returned [v0.2] |
| Payments Processor | Outbound | Service fees | Tokenized; PCI SAQ-A |

---

## 7. Data Model (Key Objects)

- **User**: identity status, contact channels, consents, protected-mover flag (`SENSITIVE_PII`)
- **Move Package**: old and new address, address type, effective date, state, authorization record, risk score, Hold Period end, Dispute Window end, closure time
- **Change Order**: kind (change / revert / correction), entity ref, channel, consented audience rank, state, event history, artifacts, attempt count, idempotency key
- **Entity Catalog Record**: risk class, channels, field requirements, address type, SLA, delegation permitted, health and kill switches
- **Consent Record**: scope, source, screen version, timestamp, revocation
- **Audit Event**: immutable, purpose-tagged, pseudonymous after deletion
- **Deletion Record** [v0.2]: package ID, key-destruction timestamp, confirmation from each subprocessor

Retention classes:
- `EPHEMERAL_PII`: deleted at Package Closure + the retention window.
- `SENSITIVE_PII`: same as `EPHEMERAL_PII`, with stricter access.
- `AUDIT_SKELETON`: 7 years, no raw PII.
- `OPERATIONAL`: 90 days, no PII.

---

## 8. Assumptions & Dependencies

1. A useful share of the top 100 entities offer address-change APIs or accept partner-rail updates. The rest can be reached through assisted or user-guided channels. **Target to confirm: ≥ 40% API/partner coverage for the top 100.**
2. **USPS:** ReloSafe cannot file USPS Change of Address on the user's behalf without a partnership. The MVP plans for the user-guided channel. A partnership is upside, not a dependency. [v0.2]
3. Entities' terms of service allow LOA-based delegated changes for a meaningful share of the catalog. Legal review for each entity category is required before launch.
4. The IDV vendor achieves a first-attempt pass rate above 90% for the target population and agrees to contractual deletion within the period in Appendix A.
5. Users are willing to complete one IAL2 verification in exchange for one-step authorization and a visible Hold Period.
6. **[v0.2]** Bank-aggregation discovery works under FDX-standard, token-based access, whatever the final form of the Section 1033 rule.
7. **[v0.2]** Trained staff and partner advocates are available to review protected-mover requests within the response time in Appendix A.

## 9. Open Issues / Risks

| # | Risk / Question | Mitigation | Requirements |
|---|---|---|---|
| 1 | Entities refusing third-party changes (especially banks) | Partner rails, user-guided deep links, pre-filled sessions | FR-EXE-001, FR-CAT-001 |
| 2 | Liability for address fraud (account-takeover vector) | Hold Period, old-address notice, dispute and revert, risk scoring | FR-FRD-001…008 |
| 3 | Assisted/RPA changes vs. entity terms of service | Legal review gate for each entity; kill switch; prefer official channels; no pretexting | NFR-CMP-005/006, FR-EXE-010 |
| 4 | USPS licensing and data-use limits | USPS Change of Address is user-guided; NCOA used only for list hygiene | FR-EXE-005, NFR-CMP-003 |
| 5 | Cost of building the catalog | Top 100 at MVP; long tail through user-guided templates | FR-CAT-001, FR-CAT-003 |
| 6 | Household edge cases (name changes, joint accounts) | Separate IDV for each person; consent from every joint holder; name changes in Phase 2 | FR-IDV-006 |
| 7 | **[v0.2]** Old-address notice puts protected movers at risk | Protected-mover path; the notice never reveals the new address | FR-FRD-002, FR-FRD-008 |
| 8 | **[v0.2]** Risk scoring produces disparate impact | No demographic/ZIP features; disparate-impact testing every quarter | FR-FRD-001 |
| 9 | **[v0.2]** Duplicate submissions after timeouts | Outcome Unknown reconciliation; idempotency keys | FR-EXE-009, NFR-PRF-005 |
| 10 | **[v0.2]** Personal data left at subprocessors after deletion | Contractual deletion with confirmation for each vendor | FR-PRV-007 |
| 11 | **[v0.2]** Changes in the Section 1033 rule | Requirement doesn't depend on the rule (FDX, token-based) | NFR-CMP-002 |

## 10. Acceptance Criteria (MVP Exit) [v0.2]

Measured on a pilot cohort of **at least 50 verified users**:

1. **Coverage and completion.** Each pilot package covers ≥ 20 entities across ≥ 4 categories. Across the cohort, ≥ 80% of API, partner and assisted Change Orders reach `Confirmed` within 14 days after the Hold Period ends, without escalation to exception handling. User-guided completion rates are reported separately.
2. **USPS Change of Address.** ≥ 90% of users who opt in finish the guided USPS flow and record a confirmation number in the product.
3. **Old-address notice.** For 100% of authorized packages that are not protected movers, the old-address notice is **mailed, with proof of mailing from the vendor**, within 1 business day of authorization. For 100% of protected-mover packages, no old-address letter is sent.
4. **Hold Period.** No High-Risk Change Order is submitted before its Hold Period ends (verified from event logs).
5. **No duplicate submissions.** Zero duplicate submissions at entities across the cohort (verified by reconciliation).
6. **Deletion.** PII deletion at retention expiry is verified end to end, including backups (by crypto-shredding) and deletion confirmations from every subprocessor.
7. **Security.** SOC 2 Type I passed; pen-test critical and high findings = 0 at GA.
8. **Accessibility.** WCAG 2.2 AA audit passed on the main path.

## 11. Prototype Scope (P0) [v0.2]

A clickable, client-side prototype (`/relosafe/`) checks the main path and the v0.2 controls with users before integration work starts. It uses **simulated** vendors and **fictional** institutions and doesn't send or receive real data.

| Prototype covers | Requirements |
|---|---|
| Simulated IDV and MFA step | FR-IDV-001, FR-IDV-005 |
| Address entry, mock validation, field-by-field read-back, address type, mail-receiving agency/PO Box review flag | FR-IDV-003, FR-MOV-006, FR-MOV-008, FR-FRD-003 |
| Catalog grouped by category, sorted by deadline/risk/SLA, deadline flags | FR-CAT-004, FR-CAT-005, FR-CAT-007 |
| Authorization screen with fields per entity, channel audience, Hold and Dispute dates, retention choice | FR-MOV-003, FR-PRV-001, FR-PRV-002 |
| Risk score without demographic features; longer hold above the threshold | FR-FRD-001, FR-FRD-006 |
| Simulated clock that runs the state machine: hold, retries with backoff, Outcome Unknown reconciliation, entity challenges, guided tasks | §4.10, FR-EXE-003, FR-EXE-007, FR-EXE-009 |
| Kill switches for each entity that force channel fallback, and re-consent when the audience widens | FR-CAT-006, FR-MOV-007, NFR-OPS-003 |
| Old-address notice preview (no new address) and protected-mover suppression | FR-FRD-002, FR-FRD-008 |
| Dispute → lock → revert orders; reject → unlock | FR-FRD-004, FR-FRD-007 |
| Completion score, JSON export, audit log, Package Closure, retention countdown, immediate erasure with closure receipt | FR-STA-003, FR-STA-004, FR-PRV-003, FR-PRV-006 |

Not in the prototype: real IDV, payments, notifications, entity integrations, the agent console, encryption and server-side storage.

---

## Appendix A — Configurable Parameters [v0.2]

| Parameter | Default | Range / Note | Used by |
|---|---|---|---|
| Hold Period (High-Risk entities) | 7 days | 5–10; 10 when risk score ≥ step-up threshold | FR-FRD-006 |
| Dispute Window | 30 days from authorization | — | FR-FRD-004/007, Package Closure |
| Risk step-up threshold | 60 / 100 | Tuned on pilot data | FR-FRD-001, FR-IDV-007 |
| Retry limit per channel | 3 attempts | Backoff 1, 2, 4 days (simulated); production uses hours | FR-EXE-003 |
| Outcome Unknown reconciliation | Within 1 business day | Escalate to support after 3 days | FR-EXE-009 |
| User action / consent timeout | 30 days | Then `Expired` | §4.10 |
| Propagation check | 14 days after Confirmed | — | FR-STA-005 |
| PII retention after Package Closure | 30 days | 0–90 days, user-configurable | FR-PRV-002 |
| IDV vendor deletion of images | ≤ 7 days after IDV decision | Contractual | FR-PRV-007 |
| Dispute investigation response | 1 business day | — | FR-SUP-004 |
| Protected-mover review response | 1 business day | — | FR-FRD-008 |

## Appendix B — Traceability: Acceptance Criteria → Requirements [v0.2]

| Acceptance criterion | Requirements |
|---|---|
| 1 Coverage and completion | FR-CAT-001, FR-EXE-001…004, FR-STA-001/003 |
| 2 USPS Change of Address | FR-EXE-005 |
| 3 Old-address notice | FR-FRD-002, FR-FRD-008 |
| 4 Hold Period | FR-FRD-006, FR-MOV-002 |
| 5 No duplicate submissions | FR-EXE-009, NFR-PRF-005, NFR-REL-002 |
| 6 Deletion | FR-PRV-002, FR-PRV-007, NFR-SEC-006 |
| 7 Security | NFR-SEC-001…006 |
| 8 Accessibility | NFR-USE-001 |
