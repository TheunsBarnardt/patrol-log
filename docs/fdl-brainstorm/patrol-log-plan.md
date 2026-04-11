# Patrol Log — FDL Brainstorm Plan

> **DRAFT — review artifact only.** This file exists so you can review the design in ultraplan / a browser before blueprints are generated. The terminal artifact of the brainstorm is the set of blueprint YAML files in `blueprints/`. Once those are created and validated, this file can be deleted or archived. Do not edit the blueprints by editing this file.

**Source of truth for review**: this document.
**Next step after approval**: `/fdl-create` per blueprint → writes YAML → `node scripts/validate.js` → `node scripts/completeness-check.js`.

---

## Cross-cutting concerns (apply to all blueprints)

- **Auth prerequisite.** Every blueprint except `auth/patroller-login` requires an authenticated session with a valid device token.
- **Append-only + cryptographic seal.** Patrol records (`workflow/commence-patrol` and `workflow/stand-down-patrol`) are append-only while `state = active` and cryptographically sealed on transition to `stood_down`. Any post-seal edit must be recorded as a separate correction record with actor and reason — never as a silent mutation.
- **POPIA audit log.** Every read of `residents-directory` (search term, result count, tap-to-call target), every search of `members-directory`, and every write to a patrol record is audit-logged with actor call sign, device id, timestamp, and ip.
- **SARS logbook alignment.** Patrol records carry `start_location`, `end_location`, `odometer_start`, `odometer_end`, `distance_km` (computed = end − start), `sars_purpose`, `sars_compliant` (boolean). Records where `sars_compliant = false` are still retained but are excluded from tax-claim reports.
- **Location privacy.** Live location heartbeats live only in an ephemeral cache while the patrol is `active`. They are purged from the live cache within 5 s of stand-down. The full polyline persists on the sealed patrol record for audit only (not live).
- **Anti-scraping.** All directory reads (`residents`, `members`, `emergency`) are rate-limited to 30 queries/min/user.
- **Device-bound sessions.** Login is WhatsApp-style: first login issues a device token stored on the device; subsequent app opens auto-resume. Manual logout or admin force-revoke ends the session.

---

## 1 — `auth/patroller-login`

**Problem.** Only authorized CPF patrollers may log patrols or see resident/member PII. An unauthenticated or deactivated user must never reach the home screen.

**Fields**

| Field          | Type   | Required | Notes                                                    |
| -------------- | ------ | -------- | -------------------------------------------------------- |
| `call_sign`    | string | yes      | Uppercase alphanumeric, e.g. `WV46`                      |
| `password`     | string | yes      | Plain at submit; hashed argon2id at rest                 |
| `access_level` | enum   | —        | `call_centre_agent`, `patroller`, `sector_lead`, `admin` |
| `organization` | string | —        | e.g. `CPF`                                               |
| `sector`       | string | —        | e.g. `Wierdabrug Sector 1`                               |
| `province`     | string | —        | e.g. `Gauteng`                                           |
| `device_id`    | string | yes      | Issued/verified at login                                 |
| `device_token` | string | —        | Long-lived, rotatable, returned on success               |

**Success outcomes**

- Given valid `call_sign` + `password` + a fresh `device_id` → session established, `device_token` issued and returned, profile fields loaded onto home dashboard (matches screen 2 — `Access Level: Call Centre Agent / Wierdabrug Sector 1 / CPF / Gauteng`).
- Given a previously issued `device_token` still valid on app open → auto-resume to home dashboard without re-prompting.

**Failure outcomes**

| Code                  | Trigger                                    |
| --------------------- | ------------------------------------------ |
| `INVALID_CREDENTIALS` | call sign or password wrong                |
| `ACCOUNT_INACTIVE`    | patroller record flagged inactive by admin |
| `MISSING_INPUT`       | call sign or password empty                |
| `RATE_LIMITED`        | >5 attempts per 15 min per call sign or ip |
| `LOCKED_OUT`          | 10 consecutive failures → 30 min lockout   |
| `DEVICE_REVOKED`      | admin has revoked this `device_id`         |

**Security rules**

- MUST: passwords hashed with argon2id; never stored plaintext.
- MUST: rate limit 5 attempts / 15 min per `(call_sign, ip)` pair.
- MUST: lockout after 10 consecutive failures; auto-unlock after 30 min.
- MUST: `device_token` is opaque, revocable server-side, rotatable.
- SHOULD: audit log every attempt (success + failure) with call sign, ip, device id.
- MAY: MFA for `admin` access level (future — explicitly deferred).

**Related:** none (this is the entry point for all others).

---

## 2 — `workflow/commence-patrol`

**Problem.** A CPF must know in real time _who_ is on patrol, _where_ they started, _what_ mode (foot / vehicle / static), _what_ vehicle, and _when_ — for dispatch, incident response, SARS logbook, and duty-roster compliance. Without a commence record, nobody can prove later that a given patroller was on duty at a given time.

**Fields**

| Field                          | Type                                         | Required    | Notes                                                                             |
| ------------------------------ | -------------------------------------------- | ----------- | --------------------------------------------------------------------------------- |
| `patrol_id`                    | uuid                                         | yes         | Server-generated                                                                  |
| `primary_patroller_call_sign`  | string                                       | yes         | From session                                                                      |
| `joined_patroller_call_signs`  | array<string>                                | no          | May be empty                                                                      |
| `joined_patroller_start_times` | map<call_sign, timestamp>                    | —           | Server-set per joined patroller                                                   |
| `patrol_type`                  | enum                                         | yes         | `foot`, `vehicle`, `static`                                                       |
| `patrol_vehicle`               | string                                       | conditional | Required when `patrol_type = vehicle`                                             |
| `odometer_start`               | number                                       | conditional | Required when `patrol_vehicle` present; ≥ last recorded odometer for that vehicle |
| `start_time`                   | timestamp                                    | yes         | Server-set; never client-controlled                                               |
| `start_location`               | object `{lat, lng, accuracy_m, captured_at}` | no          | Captured from device GPS; missing → `sars_compliant = false`                      |
| `sars_purpose`                 | string                                       | yes         | Defaults to `"CPF sector patrol"`                                                 |
| `sars_compliant`               | boolean                                      | yes         | `true` iff `start_location` present and `accuracy_m ≤ 100`                        |
| `sector`                       | string                                       | yes         | Derived from primary patroller's profile                                          |
| `state`                        | enum                                         | yes         | `active` (only value at commence)                                                 |

**Success outcomes**

- Given an authenticated `patroller`, `sector_lead`, or `admin` with no active patrol, AND valid `patrol_type`, AND — when `patrol_type = vehicle` — a valid `patrol_vehicle` not already on another active patrol, AND `odometer_start` ≥ the vehicle's last recorded reading → a new patrol record is created with `state = active`, `start_time = now` (server), `start_location` captured from device, any joined patroller call signs linked, `sars_compliant` set according to location quality.
- Given joined patrollers selected → each gets their own `start_time` in `joined_patroller_start_times` (enables independent stand-down per screen 4).
- Given the record is written → the home screen shows `Stand down from patrol` as the active option.

**Failure outcomes**

| Code                           | Trigger                                                                    |
| ------------------------------ | -------------------------------------------------------------------------- |
| `UNAUTHORIZED`                 | Access level `call_centre_agent` cannot commence (dispatch role)           |
| `ALREADY_ON_PATROL`            | Primary is already on an active patrol                                     |
| `INVALID_PATROL_TYPE`          | `patrol_type` not in enum                                                  |
| `VEHICLE_REQUIRED`             | `patrol_type = vehicle` but `patrol_vehicle` missing                       |
| `INVALID_VEHICLE`              | Vehicle not registered or not available for this sector                    |
| `VEHICLE_IN_USE`               | Vehicle already on another active patrol                                   |
| `ODOMETER_START_INVALID`       | Negative, non-numeric, or lower than last recorded reading                 |
| `JOINED_PATROLLER_UNAVAILABLE` | A selected joined patroller is on a different active patrol or is inactive |

**Security rules**

- MUST: only `patroller`, `sector_lead`, `admin` may commence. `call_centre_agent` is dispatch-only and is rejected.
- MUST: `start_time` is server-assigned, never client-supplied.
- MUST: vehicle allocation is atomic (SELECT FOR UPDATE or equivalent) to prevent double-booking under race.
- MUST: patrol record is append-only while `state = active`.
- SHOULD: audit log with `patrol_id`, `primary_call_sign`, `device_id`.

**Related:** `auth/patroller-login`.

---

## 3 — `workflow/stand-down-patrol`

**Problem.** Every patrol that commenced must be closed out so duty logs balance, SARS-valid KMs are recorded against the right vehicle, and the vehicle becomes available for the next crew. Stand-down works per-individual: a joined patroller can leave early without ending the patrol, and — per the user's explicit requirement — the primary can stand down while joined patrollers continue under a newly nominated primary.

**Fields**

| Field              | Type                                         | Required    | Notes                                                                                                     |
| ------------------ | -------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| `patrol_id`        | uuid                                         | yes         | Must reference an `active` patrol                                                                         |
| `actor_call_sign`  | string                                       | yes         | From session                                                                                              |
| `role`             | enum                                         | yes         | `primary` or `joined` — derived from patrol record                                                        |
| `odometer_end`     | number                                       | conditional | Required when `role = primary` and patrol has a vehicle; must be > `odometer_start`                       |
| `distance_km`      | number                                       | computed    | `odometer_end − odometer_start`, server-computed, not user-entered                                        |
| `end_time`         | timestamp                                    | yes         | Server-set                                                                                                |
| `end_location`     | object `{lat, lng, accuracy_m, captured_at}` | no          | Like start_location: missing or inaccurate → flips `sars_compliant` to false                              |
| `reason`           | enum                                         | no          | `shift_end`, `emergency`, `vehicle_issue`, `personal` (optional dropdown)                                 |
| `handoff`          | object                                       | no          | `{new_primary_call_sign, continue_vehicle: bool, new_vehicle?}` — only when primary nominates a successor |
| `record_seal_hash` | string                                       | yes         | Cryptographic hash over the full record written at stand-down                                             |

**Success outcomes — three distinct transitions**

**3a — Joined patroller stands down early**

- Given a joined patroller on an active patrol taps Stand Down → their personal `end_time` is recorded in the patrol record, they are removed from the active crew, the patrol's `state` stays `active`, the primary keeps driving. No odometer required for joined patrollers.

**3b — Primary stands down, patrol closes**

- Given the primary taps Stand Down, enters `odometer_end`, provides `end_location`, and does NOT nominate a handoff → the patrol transitions `active → stood_down`, `end_time = now`, `distance_km` is computed, vehicle is released, record is sealed (`record_seal_hash` written), any still-active joined patrollers are auto-stood-down with the same `end_time`.

**3c — Primary stands down with handoff to new primary**

- Given the primary taps Stand Down, enters `odometer_end`, provides `end_location`, AND nominates a joined patroller in `handoff.new_primary_call_sign`, AND that nominee is eligible (active account, correct access level, on this patrol, not already primary elsewhere) → the current patrol closes atomically (sealed with its KMs), AND a new patrol record is commenced with the nominee as primary, the same or a new vehicle, the nominee's own `odometer_start` (re-prompted), and remaining joined patrollers transferred. Continuous coverage, clean audit chain.

**Failure outcomes**

| Code                           | Trigger                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `NOT_ON_PATROL`                | Actor is not part of any active patrol                                              |
| `ALREADY_STOOD_DOWN`           | Idempotent guard — double-tap no-op                                                 |
| `ODOMETER_END_REQUIRED`        | Primary stand-down on a vehicle patrol without `odometer_end`                       |
| `ODOMETER_END_LESS_THAN_START` | `odometer_end < odometer_start` — physical impossibility                            |
| `ODOMETER_END_INVALID`         | Non-numeric or absurdly large                                                       |
| `HANDOFF_NEW_PRIMARY_INVALID`  | Nominee inactive, wrong access level, already primary elsewhere, not on this patrol |
| `HANDOFF_NO_CANDIDATES`        | Handoff requested but no eligible joined patrollers remain                          |
| `UNAUTHORIZED`                 | Actor trying to stand down another patroller without admin/sector_lead role         |

**Security rules**

- MUST: actor must be a member of the patrol being stood down, OR have `sector_lead`/`admin` access level. Admins may force-close abandoned patrols with `reason` logged.
- MUST: `end_time` and `distance_km` are server-assigned. The UI field "KM's Traveled" on screen 4 becomes **read-only / computed** from `odometer_end − odometer_start`.
- MUST: idempotency — same `(patrol_id, actor_call_sign)` stand-down is a no-op if already processed.
- MUST: patrol record is sealed at stand-down; `record_seal_hash` is written over all fields. Any downstream edit must be a separate correction record.
- SHOULD: audit log every stand-down, especially handoffs (who handed to whom, why).

**Related:** `auth/patroller-login`, `workflow/commence-patrol`.

---

## 4 — `data/hotspots-map`

**Problem.** Patrollers and dispatch need to see _where_ incidents are concentrating over a chosen time window so patrol routes can be planned to intercept rather than react. A spreadsheet of coordinates is useless in the field; the map makes clustering immediately visible (screen 5 shows ~14 orange pins clustered in Valhalla and Glen Lauriston).

**Fields** (this is a query, not an entity)

| Field                 | Type  | Required | Notes                                                                                 |
| --------------------- | ----- | -------- | ------------------------------------------------------------------------------------- |
| `period`              | enum  | yes      | `today`, `7d`, `30d`, `90d` — preset range from "From period" / "To period" dropdowns |
| Response: `incidents` | array | —        | `{lat, lng, incident_id, type, severity, occurred_at}` per match                      |

**Success outcomes**

- Given a valid `period` → all incidents from the external incidents API with `occurred_at` in that window are returned as geo-points; the map renders them with clustering where density is high.
- Given no incidents match → empty-state map renders with "No incidents in this period" message (not an error).
- Given a pin is tapped → incident summary shows type, time, severity. Full details require elevated access.

**Failure outcomes**

| Code                        | Trigger                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `INVALID_PERIOD`            | Period not in the enum                                                                               |
| `INCIDENTS_API_UNAVAILABLE` | Upstream incidents service down → fall back to cached data if available, degrade to list view if not |
| `MAP_PROVIDER_UNAVAILABLE`  | Tile provider unavailable → show list-only view                                                      |
| `UNAUTHENTICATED`           | No valid session                                                                                     |

**Security rules**

- MUST: read-only; this blueprint never writes.
- MUST: any authenticated patroller sees any sector's hotspots (per user's explicit decision — no sector scoping on hotspots).
- MUST: cache results for 5 minutes per `period` to reduce load on the incidents API.
- SHOULD: redact incident details for types marked sensitive (domestic violence, minors) unless viewer has `sector_lead`+ clearance.
- SHOULD: exact coordinates (per user decision) — no fuzzing.

**Related:** `auth/patroller-login`, `integration/incidents-api` (external, contract-only — not brainstormed in this round).

---

## 5 — `data/residents-directory`

**Problem.** Mid-patrol, a CPF member needs to contact a resident at a specific address — to verify an alarm, report damage, or ask about a suspicious vehicle. A spreadsheet is too slow; the directory must be searchable and phone-callable in one tap, scoped to the patroller's sector.

**Fields**

| Field                        | Type   | Required | Notes                               |
| ---------------------------- | ------ | -------- | ----------------------------------- |
| `search_term`                | string | no       | Min 2 chars when present            |
| `sector`                     | string | —        | Derived from session                |
| Response item: `resident_id` | uuid   | —        | Not displayed; used for audit       |
| Response item: `name`        | string | —        | Displayed                           |
| Response item: `phone`       | string | —        | Displayed; tap-to-call              |
| Response item: `address`     | string | —        | Displayed verbatim (matches mockup) |

**Success outcomes**

- Given an authenticated patroller enters a search term → residents in their sector matching on name, phone, or address are returned (three-line card matches screen 6).
- Given no search term → full resident list for the sector returned, paginated.
- Given a card is tapped → native dialer opens with the phone number; the tap event is audit-logged.

**Failure outcomes**

| Code                    | Trigger                                                                           |
| ----------------------- | --------------------------------------------------------------------------------- |
| `UNAUTHORIZED`          | Not authenticated                                                                 |
| `NO_RESULTS`            | Zero matches (rendered as empty state, not error toast)                           |
| `SEARCH_TERM_TOO_SHORT` | <2 chars when a term is supplied                                                  |
| `RATE_LIMITED`          | >30 queries/min per user — anti-scraping                                          |
| `SYNC_UNAVAILABLE`      | Resident store offline → fall back to last known encrypted local cache if present |

**Security rules**

- MUST: authenticated patroller only.
- MUST: sector-scoped — patrollers only see residents in their assigned sector (POPIA data minimization).
- MUST: rate limit 30 searches / min per user.
- MUST: audit log every search (term, user, timestamp) AND every tap-to-call (resident_id, user, timestamp) for POPIA access records.
- MUST: response never includes ID number, birthdate, or any PII beyond `name`, `phone`, `address`, even if present in the source store.
- SHOULD: on-device cache encrypted at rest, wiped on logout.
- SHOULD: server cache 5 min per `(sector, term)` tuple.

**Related:** `auth/patroller-login`.

---

## 6 — `data/members-directory`

**Problem.** A patroller needs to reach a fellow CPF member by phone during an operation — to coordinate backup, hand off an incident, or reach a specific officer who has context on a repeat caller. Additionally, per user decision, next-of-kin contacts for each member live on this directory (not on the emergency list).

**Fields**

| Field                         | Type          | Required | Notes                                                               |
| ----------------------------- | ------------- | -------- | ------------------------------------------------------------------- |
| `search_term`                 | string        | no       | Min 2 chars when present                                            |
| Response item: `member_id`    | uuid          | —        | Audit only                                                          |
| Response item: `name`         | string        | —        | Displayed                                                           |
| Response item: `call_sign`    | string        | —        | Displayed (e.g. `WC29`)                                             |
| Response item: `phone`        | string        | —        | Displayed; tap-to-call                                              |
| Response item: `address`      | string        | —        | Displayed verbatim (matches mockup)                                 |
| Response item: `sector`       | string        | —        | Displayed                                                           |
| Response item: `access_level` | enum          | —        | Displayed as role badge                                             |
| Response item: `is_on_duty`   | boolean       | —        | Computed by joining against live-patroller-map cache                |
| Response item: `next_of_kin`  | array<object> | —        | `{name, relationship, phone, alternate_phone}` — expandable section |

**Success outcomes**

- Given an authenticated patroller enters a search term → members in their sector matching name, call sign, or phone are returned.
- Given no search term → full sector members list returned, paginated, sorted with on-duty members first.
- Given a card is tapped → dialer opens.
- Given the next-of-kin section is expanded → NoK entries are shown; tap-to-call on a NoK number is logged against the current active patrol if one exists.

**Failure outcomes**

| Code                     | Trigger                                                                       |
| ------------------------ | ----------------------------------------------------------------------------- |
| `UNAUTHORIZED`           | Not authenticated                                                             |
| `NO_RESULTS`             | Zero matches                                                                  |
| `SEARCH_TERM_TOO_SHORT`  | <2 chars when supplied                                                        |
| `RATE_LIMITED`           | >30/min                                                                       |
| `MEMBER_INACTIVE_HIDDEN` | Suspended members silently excluded (soft filter, not error surfaced to user) |

**Security rules**

- MUST: authenticated CPF members only; no cross-CPF visibility.
- MUST: sector-scoped for viewing (same rule as residents).
- MUST: inactive/suspended members excluded from all results.
- MUST: rate limit 30 searches/min.
- MUST: audit log all searches and all tap-to-call events (including NoK calls).
- MUST: directory is **read-only** for all users. Profile editing is a separate follow-up blueprint (`data/member-profile-admin-edit`) restricted to admins of the same sector as the target member.
- SHOULD: `is_on_duty` joined from the live-patroller-map ephemeral cache; stale-indicator if no heartbeat in >2 min.

**Related:** `auth/patroller-login`, `data/live-patroller-map`.

**Follow-up blueprint noted:** `data/member-profile-admin-edit`.

---

## 7 — `data/emergency-contacts-directory`

**Problem.** When a patroller is confronting a real incident — a fire, a gunshot victim, a barricaded suspect — they need to reach the right emergency _service_ in under three seconds. The app must present a tiny, curated, sector-aware list of services that works **even when the network is bad**, because emergencies often coincide with bad reception.

The list is for services (SAPS station, ambulance, fire brigade, armed response, hospital, ops room, vet, tow, poison control) — **not** civilian next-of-kin. Per user decision, next-of-kin lives on the Members list.

**Fields**

| Field              | Type          | Required | Notes                                                                                                            |
| ------------------ | ------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `service_id`       | uuid          | —        |                                                                                                                  |
| `name`             | string        | yes      | e.g. `Valhalla SAPS`                                                                                             |
| `service_type`     | enum          | yes      | `police`, `ambulance`, `fire`, `armed_response`, `hospital`, `ops_room`, `vet`, `tow`, `poison_control`, `other` |
| `primary_number`   | string        | yes      |                                                                                                                  |
| `secondary_number` | string        | no       | After-hours line, specific operator, etc.                                                                        |
| `address`          | string        | no       | Tappable to open maps                                                                                            |
| `sector`           | array<string> | no       | Sectors this service covers (an ambulance covers many)                                                           |
| `verified_at`      | timestamp     | yes      | Drives the stale-verification warning                                                                            |
| `priority`         | integer       | yes      | Sort order, admin-tunable                                                                                        |
| `sensitive`        | boolean       | no       | If true, hidden from non-patroller access levels                                                                 |

**Success outcomes**

- Given an authenticated patroller opens the screen → the full emergency contact list for their CPF is shown with no search required. List is pre-sorted by `priority`.
- Given the user's current location is known → sector-local services (nearest police, fire, hospital) pinned to top.
- Given the user taps a service → native dialer opens with `primary_number` (no confirmation dialog — the emergency _is_ the confirmation).
- Given the dial-out succeeds AND the user has an active patrol → an escalation event `{patrol_id, service_id, service_name, called_at}` is appended to the patrol record as evidence of escalation.
- Given the device is offline → the last-known encrypted cache is served; banner indicates "offline — last updated X min ago".

**Failure outcomes**

| Code                        | Trigger                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHORIZED`              | Not authenticated. (Even in emergencies we do not open an unauth door — the phone's native 10111 dial-out is the fallback.) |
| `SERVICE_NUMBER_UNVERIFIED` | `verified_at` older than 90 days → shown as a warning badge, not a block                                                    |
| `NO_SERVICES_CONFIGURED`    | Empty state with "ask your admin to configure emergency contacts"                                                           |
| `SYNC_UNAVAILABLE`          | Remote store offline AND no local cache → hard failure, surface native 10111 prompt                                         |

**Security rules**

- MUST: full contact list cached on device, encrypted at rest, refreshed on every app open when online.
- MUST: any authenticated user may view (no sector scoping — if you're helping out in a neighbour sector you still need the numbers).
- MUST: tap-to-call auto-logs to the active patrol record as an escalation event when one exists.
- MUST: service records are admin-maintained only; no patroller edits.
- SHOULD: list sorted with most-likely-needed services first (police, EMS, fire).
- SHOULD: services with `sensitive = true` hidden from non-patroller access levels.

**Related:** `auth/patroller-login`, `workflow/stand-down-patrol` (escalation events attach to the active patrol).

---

## 8 — `data/live-patroller-map` (new — not in the original 8 mockups)

**Problem.** An active patroller — and dispatch — needs Uber-style situational awareness: _who else is out there right now, and where?_ This enables backup requests, cross-patrol coordination, and faster dispatch to incidents. Distinct from `hotspots-map` (which shows _historical incidents_) — this shows _current colleagues_.

**Fields**

Ingestion (heartbeat):

| Field        | Type      | Required | Notes                                          |
| ------------ | --------- | -------- | ---------------------------------------------- |
| `patrol_id`  | uuid      | yes      | Must reference a patrol in `state = active`    |
| `call_sign`  | string    | yes      | From device session                            |
| `lat`        | number    | yes      |                                                |
| `lng`        | number    | yes      |                                                |
| `heading`    | number    | no       | Degrees                                        |
| `speed`      | number    | no       | km/h                                           |
| `accuracy_m` | number    | yes      | GPS horizontal accuracy                        |
| `timestamp`  | timestamp | yes      | Device-provided; server corrects obvious drift |
| `signature`  | string    | yes      | Device key signature over the heartbeat        |

Subscription (viewer):

| Field            | Type   | Notes                                                                                       |
| ---------------- | ------ | ------------------------------------------------------------------------------------------- |
| `scope`          | enum   | `sector` (patrollers) or `cpf` (dispatch) — derived from viewer's access level              |
| Response per pin | object | `{call_sign, patrol_type, vehicle, lat, lng, heading, last_update, duration_on_patrol_min}` |

**Success outcomes**

- Given an active patroller in sector X → the map shows pins for all other active patrollers in sector X, refreshing every 30 s.
- Given a `call_centre_agent` (dispatch) → the map shows pins for all active patrollers across every sector of their CPF.
- Given a pin is tapped → call sign, patrol type, vehicle, minutes on patrol, and seconds since last heartbeat are displayed.
- Given a patroller stands down → their pin is removed from the live cache within 5 s.

**Failure outcomes**

| Code                     | Trigger                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `UNAUTHORIZED`           | Not authenticated, or not on an active patrol AND not dispatch                                                                 |
| `LOCATION_STALE`         | Viewer sees a pin whose last heartbeat is >2 min old → pin greys out (not removed) — tells you the patroller is in a dead zone |
| `REALTIME_CHANNEL_DOWN`  | Websocket unavailable → fall back to polling every 30 s (degraded, not an error to the user)                                   |
| `HEARTBEAT_RATE_LIMITED` | A client sending heartbeats faster than 1 per 20 s is throttled — anti-spam                                                    |
| `NO_ACTIVE_PATROLS`      | Empty map, empty-state message (not an error)                                                                                  |

**Security rules**

- MUST: pin only visible while its patroller's patrol is `active`. Stood-down patrols are purged from live cache within 5 s.
- MUST: patrollers scoped to same-sector visibility. Dispatch (`call_centre_agent`) scoped to whole-CPF visibility. No cross-CPF visibility.
- MUST: heartbeat rate limited to 1 per 20 s per `patrol_id`.
- MUST: live cache is ephemeral — wiped on stand-down. Historical polyline lives on the sealed patrol record (feature 3), not in the live cache.
- MUST: heartbeats signed with the device key issued at login, so a malicious client cannot forge another patroller's location.
- SHOULD: dispatch's viewing events are audit-logged (who looked at whom, when).

**Related:** `auth/patroller-login`, `workflow/commence-patrol`, `workflow/stand-down-patrol`.

---

## Follow-ups (not in this brainstorm batch)

1. **`data/member-profile-admin-edit`** — sector-scoped admin-only edit path for member records. Triggered by the Feature 6 decision "only admin and only admins of own sector".
2. **`integration/incidents-api`** — contract-only blueprint for the external data source read by `hotspots-map`. Models the request/response shape the hotspots blueprint depends on, without specifying the external service.
3. **Mockup gaps to fix in the iPhone 16 & 17 Pro designs** before implementation:
   - Screen 3 (Commence Patrol): add `Odometer start` numeric field.
   - Screen 4 (Stand Down): "KM's Traveled" becomes read-only / computed; add `Odometer end` input; add SARS-compliance indicator (✓ or ! badge); add start/end location indicators.
   - Screen 7 (Members): add on-duty badge and next-of-kin expand section.
   - **New screen**: Live Patroller Map — missing from the mockups entirely.

---

## Self-review checklist (SKILL.md Step 8)

| Check                           | 1    | 2        | 3        | 4    | 5    | 6      | 7      | 8         |
| ------------------------------- | ---- | -------- | -------- | ---- | ---- | ------ | ------ | --------- |
| Kebab-case name                 | ✓    | ✓        | ✓        | ✓    | ✓    | ✓      | ✓      | ✓         |
| Valid FDL category              | auth | workflow | workflow | data | data | data   | data   | data      |
| At least one success outcome    | ✓    | ✓ ×3     | ✓ ×3     | ✓    | ✓    | ✓      | ✓      | ✓         |
| At least one failure outcome    | 6    | 8        | 8        | 4    | 5    | 5      | 4      | 5         |
| Every failure has an error code | ✓    | ✓        | ✓        | ✓    | ✓    | ✓      | ✓      | ✓         |
| At least one security rule      | ✓    | ✓        | ✓        | ✓    | ✓    | ✓      | ✓      | ✓         |
| `related:` populated            | n/a  | → 1      | → 1, 2   | → 1  | → 1  | → 1, 8 | → 1, 3 | → 1, 2, 3 |
| No placeholder language         | ✓    | ✓        | ✓        | ✓    | ✓    | ✓      | ✓      | ✓         |

All eight blueprints pass the internal completeness gate. Ready for `/fdl-create` handoff on your approval.

---
