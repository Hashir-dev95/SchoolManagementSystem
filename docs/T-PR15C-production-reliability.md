# T-PR15C — Production Reliability + Host Controls

Branch: `feture`. Foundations: `e153078e4f02a7608f70bae20bfc4210a63d3669`
and `aabfec2f60ba4c4a94dae07a47a0ecc37e2ba432`.
No staging, commit or push. T-PR15D and T-PR16+ remain out of scope.

**Final closure verdict: READY TO COMMIT.** The final closure review below
supersedes the implementation-only checklist and original validation counts.

## Architecture and operational policies

School-App remains the authority/control plane; ZEGOCLOUD supplies media transport.
Waiting is enforced for every Student join, including direct join-token requests:
an active explicit StudentEnrollment permits requesting admission, never a media
credential. Only an admitted participant can obtain/renew the existing receive-only
Token04. There is no restricted-but-listening provider room hidden behind waiting UI.
Waiting clients have no engine, preview, publishing or capture permission request.

One Mongo presence row per lesson/actor stores admission, bounded transition history,
lease ownership, reported connection state, hand state, timestamps, reconnect count
and durable provider enforcement work. No RTC token/JWT is stored in it: login
ownership uses a one-way JWT digest and an ephemeral connection correlation key.
The key is not an authentication credential. Presence is an operational hint from
authenticated clients, not provider-attested attendance or proof of watching.
It never writes formal Attendance. There is no public provider callback endpoint.

Admission states are waiting/admitted/rejected/removed/left. Rejection/removal is
terminal for this lesson. A deliberate leave requires fresh admission on return.
Duplicate requests/actions do not duplicate logical identities or transition events.
History retains the latest 100 meaningful transitions, with cumulative reconnect
count and first/last timestamps retained. There is a 500-actor capacity per lesson,
including host, so the host list is complete within the explicit capacity.

Only one connection can hold a lesson/actor lease. Same connection + authenticated
login can retry and renew. A different screen/device/login must wait until the
issued credential expires plus a five-second enforcement grace. Waiting leases last
30 seconds and renew on polling. Explicit leave does not prematurely free an issued
credential's lease. Stale takeover preserves logical presence; an explicit previous
leave resets admission to waiting. No engine/login/publish retry creates a new
school occurrence or new provider identity.

Current approved substitute authority is reused through T-PR15A's occurrence fences.
A substitute who starts the occurrence owns its host controls. An original Teacher
cannot moderate it. If authority changes after an occurrence is already live, neither
actor can silently take over the immutable host record: maintenance closes the old
occurrence and media. A later timetable occurrence can be started normally. There is
no same-occurrence host transfer/restart; the existing owner's End remains a safe
teardown operation. Revoked login, assignment, substitute, enrollment or session
authority denies future issuance/moderation and closes clients on revalidation.

Admission, moderation, presence, hand state and issuance use existing occurrence,
Branch, user/login, lesson, catalog and enrollment transaction fences. Mongo unique
indexes are installed before traffic, even with autoIndex disabled. Correctness
does not depend on process-local locks. Credential issuance has a shared persisted
10-per-minute allowance per actor/lesson; changing hand/admission state has a
500 ms cooldown per target. Replayed no-op actions do not add history. Polling is
serialized at five-second intervals and closes after three verification failures.

SDK reconnect notifications become reconnecting/recovered states, with backend
admission and credential revalidation, a five-second request gate, and a 30-second
media recovery deadline. Recovery reuses the same engine, school session, actor,
presence and provider identity. SDK transport recovery can occur before a backend
round trip finishes; it is not itself school authorization. Failed verification
closes media. Existing short token TTL remains 30–600 seconds and scheduled-end
capped; no long-lived credentials or token-policy relaxation was added.

Both Teacher capture and Student waiting/media ownership close on backgrounding.
Foreground requires reopening through school authorization; no silent recapture
or republishing. Network quality is normalized as good/fair/poor/unavailable; poor
quality shows a textual recommendation. Teachers can explicitly turn camera off
and continue audio. Student publishing remains disabled, so remote force-mute and
camera moderation controls would be misleading and are not offered. Chat is
deferred: discovery found no existing classroom chat requirement/transport to reuse;
no second general messaging platform or transcript behavior is introduced.

## Provider enforcement and operational limits

Official sources inspected on 2026-10-21:

- [KickoutUser](https://www.zegocloud.com/docs/live-streaming-server/api-reference/room/kick-out-user)
- [SetForbidUserRule](https://www.zegocloud.com/docs/live-streaming-server/api-reference/room/forbid-user-rule/set-forbid-user-rule)
- [Server API authentication](https://www.zegocloud.com/docs/live-streaming-server/api-reference/accessing-server-apis)
- [React Native quality monitoring](https://www.zegocloud.com/docs/live-streaming-rn/communication/monitor-stream-quality)

The network control adapter is separate from the pure Token04 signer. Removal first
commits backend denial and durable enforcement work, then attempts a room/user login
ban through the remaining credential lifetime and independently attempts a kick.
Each HTTPS request has a five-second timeout, fixed provider origin and no redirect.
Raw provider responses/errors, signed URLs, tokens and secrets are not logged.
Confirmation requires both operations to succeed. A failed ban still attempts kick.
Removed users cannot obtain another school credential. Backend End closes presence
and queues the same enforcement mechanism for issued identities.

Maintenance runs every ten seconds on each server, rotating authority checks across
100 active identities and draining up to 50 enforcement jobs. Persisted job claims
expire after fifteen seconds for crash recovery; repeated provider operations are
safe. Failed jobs retry until credential expiry, then become expired. Maintenance
also closes an occurrence when its immutable host loses authority. Provider network
calls never run in retryable transaction callbacks. Local worker overlap suppression
is only an efficiency guard; durable state supplies cross-instance correctness.

Provider controls require account entitlements and are subject to provider quotas
(including room/user ban-rule capacity). No live account calls were made in tests.
An unavailable/quota-limited provider leaves enforcement unconfirmed, rather than
pretending removal was instantaneous; short expiry, denied renewal and client
disconnect remain the fallback. Fleet deployment must size/rate operational workers
within account quotas; sustained failures are visible as failed enforcement states.
This is not a claim of device-tested instantaneous eviction.

Structured logs contain operation/session/role/latency/timestamp or aggregate job
counts and sanitized failure categories. Presence timestamps/counters supply join,
admission and reconnect diagnostics without private chat content or duplicated PII.
Teacher roster DTOs contain school display names and classroom-safe states only;
Students receive only their own presence. No opaque provider identity is displayed.

## Implementation review checklist (before closure)

| Item | Result |
| --- | --- |
| A. Repository discovery | Existing Express/Mongoose transaction fences, index bootstrap, Hira UI and RN SDK reused. No Redis/queue/shared logger/rate-limit or session chat infrastructure found. |
| B–C. Waiting/admission | Backend state; no credential before admission; waiting/admitted/rejected/removed/left transitions. |
| D–E. Presence/Attendance | Durable unique actor/lesson record; bounded history; authenticated client reports only; no Attendance mutation. |
| F–G. Duplicate joins/hosts | Durable connection/login lease through token expiry plus grace; no silent second-device takeover. |
| H. Substitute host | Exact occurrence authority revalidated; active immutable ownership loss closes occurrence instead of transferring. |
| I–K. Participants/admit/reject/remove | Safe named host roster; current host only; idempotent terminal decisions; durable provider enforcement and truthful feedback. |
| L. Force mute | No fake remote-mute control: Students have enforced publish=0 and no local publish path. |
| M. Hand raise | Admitted Student raise/lower; host acknowledgement; actor/session scoped; idempotent; invalid after End. |
| N. Chat | Deferred after product/infrastructure discovery; no chat or transcript infrastructure added. |
| O–R. Reconnect/authority/renewal/revocation | Normalized states, same identity, bounded recovery, existing authorized issuance, local teardown on denial; official server ban/kick with durable retries. |
| S. End | Ended backend state prevents admission/renewal/rejoin; closes presence and host capture; queues media eviction. |
| T–W. Lifecycle/network/audio/quality | Close owned classroom on background; explicit reopen; normalized quality labels; visible Teacher camera-off audio fallback. |
| X–Y. Observability/rates | Privacy-safe structured operations; presence diagnostics; persisted issuance allowance and transition cooldowns. |
| Z–AB. Concurrency/idempotency/races | Shared Mongo fences/uniqueness; cross-process Student/host ownership, moderation/substitute, reconnect/End/withdrawal plus admit/reject, admit/End and rejoin/remove cases. |
| AC–AE. UI/accessibility/RTL | Compact Hira classroom cards, named admit/reject/remove/hand actions; destructive confirmation; textual states; shared button roles/disabled semantics/44-point targets; no new physical-direction layout. |
| AF. APIs | POST admission, classroom heartbeat/list, participant moderate and hand; start/join-token require connectionId. Strict body/query contracts; no unrestricted CRUD. |
| AG–AH. Privacy/storage | Safe DTOs, no email/phone/admission number/token/JWT/provider secret; unique presence record and bounded transition history. |
| AI. Callbacks | Deferred; no unauthenticated or unsigned ingestion. Client connection state is explicitly a reported hint. |
| AJ. Backend focused | PASS: 72 live-lesson cases plus one server-control adapter case, all included in the final regression run. |
| AK. Backend regressions | PASS: 248/248 across live lessons/provider control/bootstrap/RBAC/timetable/substitute/enrollment. |
| AL. Frontend focused | PASS: 50/50 across six live-room/API/permission/discovery suites. |
| AM. Frontend regressions | PASS: 54 suites, 508/508 tests. Frontend scoped TypeScript and changed-file ESLint pass. |
| AN. Provider adapter | Mocked network quality/reconnect/deadline/removal, exact server signature/room/user parameters, ban plus independent kick, sanitized failure and durable post-commit enforcement cases pass. |
| AO. Android/build | assembleDebug PASS, 155 tasks; production Metro bundle PASS. Native/dependency files are unchanged from T-PR15B. |
| AP. iOS | IOS PRE-RELEASE VALIDATION REQUIRED. Static configuration checked; no Pod/Xcode/runtime PASS on Windows. |
| AQ. Devices | PRE-RELEASE DEVICE VALIDATION REQUIRED. No real media enforcement or device behavior claimed. |
| AR. Exact files | Manifest below. |
| AS–AT. Mixed files/hunks | None; no initially dirty file edited, so no mixed-file hunks. |
| AU. Preservation | All 51 tracked dirty patches captured at T-PR15C start unchanged, including the original 50 and approval-scope formatting; index empty; HEAD unchanged. Artifacts excluded. |
| AV. Safety diagnostic | safety-alert.controller.ts:47 TS2322 remains UNRELATED RELEASE GATE; not fixed. |
| AW. Exclusions | No recording start/stop/task/webhook/storage, R2/Cloudinary, Recording Library, playback/transcript/captions/notes/AI/publishing/archival or formal attendance automation. |
| AX. Remaining blockers | No demonstrated T-PR15C code/security/data-integrity blocker. Account entitlement/quota, device media and iOS checks remain pre-release gates. |
| AY. Final verdict | READY FOR REVIEW |

## Exact T-PR15C manifest

1. `__tests__/live-room-controller.test.ts`
2. `__tests__/live-room-screen.test.tsx`
3. `__tests__/zego-live-client.test.ts`
4. `backend/src/models/liveLessonSession.ts`
5. `backend/src/routes/live-lesson.routes.ts`
6. `backend/src/server.ts`
7. `backend/src/services/live-lesson.service.ts`
8. `backend/tests/helpers/live-lesson-worker.ts`
9. `backend/tests/live-lesson.security.test.ts`
10. `src/screens/liveLessons/LiveLessonRoomScreen.tsx`
11. `src/services/liveLessons/LiveRoomController.ts`
12. `src/services/liveLessons/liveLessonService.ts`
13. `src/services/liveLessons/rtc/ZegoLiveLessonClient.ts`
14. `src/services/liveLessons/rtc/types.ts`
15. `backend/src/models/liveLessonPresence.ts`
16. `backend/src/services/live-classroom-state.ts`
17. `backend/src/services/rtc/zego-room-control.ts`
18. `backend/tests/zego-room-control.test.ts`
19. `docs/T-PR15C-production-reliability.md`

## Pre-release validation

**PRE-RELEASE DEVICE VALIDATION REQUIRED**: real waiting-room behavior, two-device
Teacher/Student flow, drop/reconnect, audio-only fallback, speaker routing,
background/foreground, moderation/ban/kick enforcement, prompts, weak network,
RTL and accessibility. Provider entitlements/quotas must be exercised with the
configured account. No production media validation is claimed.

**IOS PRE-RELEASE VALIDATION REQUIRED**: macOS Pod install, Xcode compilation and
iOS device media/permissions/lifecycle behavior.

## Implementation validation evidence (before closure)

Final evidence is stored under `.validation-tpr15c/` and is not a feature artifact
to stage:

- `frontend-focused-final.log`: six suites, 50/50 PASS.
- `frontend-full.log`: 54 suites, 508/508 PASS.
- `backend-final.log`: six files, 248/248 PASS (72 live-lesson, one provider-control,
  175 existing security/academic regressions). This is a complete successful run.
- `frontend-typescript.log`: scoped frontend config PASS; same scope used in T-PR15B.
- `backend-typescript.log`: only the known safety-controller TS2322; not a backend
  compile PASS and not fixed here.
- `eslint.log`: changed feature code, zero errors/warnings.
- `android-build.log`: offline assembleDebug PASS, 155 tasks.
- `metro.log`: final production Android bundle PASS.
- `preservation.json`, `before.patch`, `before-status.txt`: 51/51 original dirty
  tracked patches preserved, no mixed files, no unexpected tracked changes,
  index empty, HEAD unchanged.
- `final-source-sha256.json`: feature source bytes captured before final validation;
  verified unchanged after all final tests. Native config/dependencies separately
  verified unchanged from the closed T-PR15B foundation. `git diff --check` PASS.

The first expanded frontend run found one assertion depending on a rendered text
node's trailing whitespace after formatting. The assertion was corrected to check
the stable label; the full final run passed. No timeout/authority guard was weakened.
`adb devices` could not initialize its user directory in this Windows sandbox;
no current device or media PASS is inferred from that probe.

**READY FOR REVIEW**

## Final T-PR15C closure review — 2026-10-21

This section supersedes the implementation verdict and validation counts above.
The exact 19-file manifest is unchanged. No staging, commit, push, T-PR15D or
T-PR16 work was performed. Closure fixes remain inside the existing manifest.

Three correctness findings were addressed:

1. A reproduced stale maintenance snapshot could end a freshly reclaimed,
   authorized host connection. Lease-owner changes and credential issuance now
   advance the presence revision checked by maintenance. Enforcement completion
   also checks the revision/current work state so an old result cannot mark a
   new credential generation as evicted.
2. A reproduced delayed ban response could start a kick after its credential
   expired, when a later connection becomes eligible. The adapter now refuses to
   begin expired work or start that late kick. It does not claim confirmation
   when the required operations were not completed.
3. Action/state validation used String coercion, which accepted array-shaped
   input as a valid action name and could select another transition. Exact string
   types are now required; malformed types return 400 without changing state.

The maintenance query initially scanned all 5,000 synthetic records and performed
a blocking sort to return 100. A measured, targeted admission/checkedAt index now
returns the same 100 with 100 examined keys/documents and no blocking sort. No
speculative infrastructure or other provider capability was added.

| Item | Closure finding |
| --- | --- |
| A. Exact boundary | All 19 listed files belong to live-class reliability/controls, focused verification or documentation. No unrelated hunks or phase leakage. |
| B. Waiting security | PASS. Current explicit enrollment before request; no credential before admission, including direct join-token. Waiting never prepares an RTC engine. Students cannot self-admit or undo rejection/removal. |
| C. Presence model | PASS. Unique lesson/actor record, bounded history, connection hints, hand state, timestamps, reconnect count, lease/login digest and enforcement status. No JWT, RTC token or server secret is stored in presence; correlation alone cannot authenticate. |
| D. Attendance boundary | PASS. Neither new backend service nor client/provider callbacks import or write formal Attendance. Presence reports only affect LiveLessonPresence. |
| E. Duplicate connections | PASS. Persisted connection/login ownership through credential expiry plus grace; another device cannot replace an unexpired lease. Same owner can retry/renew. New ownership/credentials invalidate stale maintenance generations. Provider identity stays actor/session scoped. |
| F. Host/substitute | PASS with documented restriction: current occurrence authority gates moderation/list/renewal/reconnect; immutable owner alone can safely End the old occurrence; maintenance ends invalid ownership. FINAL HARDENING CANDIDATE — SAME-OCCURRENCE HOST HANDOVER. No handover added. |
| G. Moderation | PASS. Current host every time; target presence ID constrained to the exact lesson and participant role. Students, unrelated Teachers and administrative roles cannot moderate. |
| H. Enforcement | PASS. Removal/denial and durable job commit before network calls; ban and kick attempted independently while valid. Failure remains retriable/unconfirmed. Confirmation needs both successes. Generation checks prevent stale completion overwrites. |
| I. Provider API security | PASS. Official v2 server signature, fixed HTTPS origin, exact backend room/user, no redirects, five-second timeout per call; sanitized errors; no raw response/secret/token/signed URL logging. Provider results never grant school authority. |
| J. Provider gates | PRODUCTION PROVIDER CONFIGURATION / CAPACITY GATES: KickoutUser availability, forbid-user-rule entitlement/capacity, API quotas and room/user limits. No live-account enforcement PASS claimed. |
| K. Reconnect correctness | PASS. Same lesson/actor/presence/provider identity, distinct reconnect/recovery state, school revalidation and bounded renewal. End/removal/rejection/enrollment or host revocation cannot obtain new credentials. |
| L. Deadline/resources | PASS. Five-second request gate, one 30-second recovery deadline; cleared on recovery/disposal. Closed-controller guards prevent late responses from reconnecting. No indefinite retry strategy. |
| M. Credential security | PASS. T-PR15A 30–600-second Token04 and scheduled-end cap unchanged; no client signing/AppSign/secret, Student publish=0, every renewal reauthorizes. |
| N. Limits/cooldowns | PASS. Shared persisted 10/minute issuance allowance, applicable 500 ms transition cooldown and serialized five-second polling. Idempotent actions do not duplicate events. No IP/NAT or in-memory authority. Future configuration candidate; constants unchanged. |
| O. Capacity | PASS. Host is inserted atomically with session start before Student requests can run. Shared fences serialize the 500-actor count; at capacity, a safe 409 prevents insertion. Regression verifies host retention, exact count and complete 500-entry roster. |
| P. Maintenance | PASS. Atomic persisted work claims, fifteen-second recovery, bounded batches, generation-checked results, expiry and host revalidation. Cross-process expired-claim regression proves one provider attempt. Local overlap guard is only an optimization. |
| Q. Index/query review | PASS for measured presence queries. Unique actor lookup and roster use lesson/actor index; admission scans use lesson/admission; work/expiry scans use enforcement/enforcementAfter; individual claims use _id. Active maintenance now uses active_classroom_maintenance. Synthetic explain metrics below; production load audit remains deferred. Existing Session has userId/isRevoked index; LiveLessonSession has occurrence, room and branch/period/status/start indexes. |
| R. Transitions | PASS. Waiting/admitted/rejected/removed/left guards; rejected/removed terminal; repeated admit/reject/remove/leave do not duplicate transition events. End prevents subsequent active operations. Malformed action/state types cannot be coerced into transitions. |
| S. Hand raise | PASS. Admitted Student only, self/session scoped, idempotent raise/lower; host acknowledgement scoped to target; invalid after End; no transcript/AI side effects. |
| T. Chat | CLASSROOM CHAT DEFERRED PRODUCT GAP. No implementation leaked in; later Teacher Live Host scope may still require chat. No chat work during closure. |
| U. Background/foreground | PASS by code review. Owned Teacher capture and Student waiting/media close on background. Timers/callbacks clean up; foreground does not silently republish and requires reopening with backend authorization. |
| V. Weak network/audio | PASS by code review/mocks. Quality normalized to named states, poor quality textual, explicit Teacher camera-off audio continuation. No automatic audio-only downgrade is implemented; Students remain receive-only. No fake force mute/camera moderation. |
| W. Observability/privacy | PASS. Actual logger calls contain session/operation/role/latency/timestamp, aggregate jobs or sanitized failure category. No JWT/RTC token/secret/signed URL/raw response/Student phone/email/admission number/private chat content. |
| X. API security | PASS. Authentication, allowed roles, current permissions and scope, strict body/query allowlists, typed actions, no generic CRUD. Connection ID is correlation plus a server lease check, never substitute authentication or host authority. |
| Y. DTO privacy | PASS. Teacher receives safe display name/classroom state; Student only own presence. No email/phone/admission number/JWT/Token04/secret or raw provider display identity. |
| Z. Races/concurrency | PASS in implementation/tests: admit/reject, admit/End, remove/rejoin, reconnect/withdrawal/End, substitute replacement/moderation, duplicate Student/host, renewal/revocation, stale host maintenance, stale enforcement completion and cross-process claim recovery. |
| AA. Frontend cleanup | PASS. AppState/navigation hooks, provider listeners, poll/renew/recovery timers, media surfaces and capture disposal reviewed. Serialized/idempotent teardown continues despite individual SDK cleanup failure; late API responses cannot log in after disposal. |
| AB. Backend validation | Fresh final post-fix full run PASS: 254/254 across six files (77 live-lesson, two provider-control, 175 regressions). TypeScript rerun has only the unchanged safety-controller TS2322. |
| AC. Frontend validation | Retained 50/50 focused, 508/508 full and scoped TypeScript PASS: frontend source/test hashes and all original dirty patches are unchanged. Changed-file ESLint rerun after backend fixes. |
| AD. Android/Metro | Retained assembleDebug/production Metro PASS: native/dependency/frontend bytes unchanged by closure; all changes are backend/test/docs. No toolchain or permission changes. |
| AE. Devices | PRE-RELEASE DEVICE VALIDATION REQUIRED: real waiting/two-device flow, network drop/recovery, Wi-Fi/mobile switch, weak network, actual ban/kick, audio-only, speaker/headset routing, background/foreground, prompts and RTL/accessibility. |
| AF. iOS | IOS PRE-RELEASE VALIDATION REQUIRED: Pod install, Xcode build, camera/mic, lifecycle and actual provider media. Windows/static checks are not runtime PASS. |
| AG. Exact manifest | Same 19-file numbered manifest above; no feature-file additions. Validation scripts/logs/explain fixtures are local artifacts only. |
| AH. Mixed files | None; no initially dirty tracked file edited. |
| AI. Preservation | 51/51 original complete patches retained; unrelated approval/auth/attendance work untouched. Index empty, HEAD unchanged. Validation/build/cache artifacts excluded. |
| AJ. Exclusions | No T-PR15D/T-PR16+ recording/webhook/storage/library, R2/Cloudinary, transcript/captions/notes/flashcards/AI/publishing/archive workflow or formal Attendance automation. |
| AK. Safety TS2322 | UNRELATED RELEASE GATE: unchanged safety-alert.controller.ts:47; not fixed. |
| AL. Later hardening | Carry forward same-occurrence host lease/handover, verified callbacks, stronger presence reconciliation, configurable cap, Branch flag, global kill switch, telemetry taxonomy, SLOs, production index/load characterization, chaos suite and staged pilot rollout. None expanded into closure. |
| AM. Remaining blockers | No demonstrated T-PR15C code/security/data-integrity blocker remains after the fixes and final validation. Provider/device/iOS gates and listed hardening candidates are separate requirements. |
| AN. Final verdict | READY TO COMMIT |

`closure-explain-before.json` and `closure-explain.json` contain real Mongo
executionStats against an owned 5,000-record synthetic fixture, not production data:
actor lookup 1 key/document, roster 100 keys/documents, due enforcement 21 keys/20
documents, maintenance 100 keys/documents after the fix versus 5,000 documents
before. These measurements establish query/index use; they do not establish fleet
capacity, provider quota compliance, latency SLOs or chaos resilience.

Final closure evidence under `.validation-tpr15c/`:

- `closure-backend-complete.log`: complete post-fix run, 254/254 PASS. Earlier
  `closure-backend-final.log` passed 253 before the final malformed-input test.
- `closure-maintenance-before.log` and `closure-provider-before.log`: reproduced
  failures before the corresponding fixes; closure regression cases now pass in
  the complete run, including cross-process claim recovery, capacity and stale
  enforcement completion. No timeout or authority guard was weakened.
- `closure-backend-typescript.log`: only unchanged safety-controller TS2322.
- `closure-eslint.log`: changed-file code PASS, zero warnings/errors.
- `closure-source-sha256.json`: source bytes captured before the complete final
  run and verified unchanged afterward.
- `closure-preservation.json`: exact 19-file boundary, 51/51 original patches
  retained, no mixed/unexpected tracked files, index empty, HEAD unchanged.
  Frontend source/test bytes and all native/dependency bytes are unchanged by
  closure. Therefore frontend 50/50 focused, 508/508 full, scoped TypeScript,
  Android assembleDebug and production Metro evidence above remain valid.
- `closure-explain-before.json`, `closure-explain.json`: real isolated Mongo
  query-plan evidence. The local probe used the already installed Mongo binary;
  an initial separate cache-download probe failed integrity validation and was
  not used as query-plan evidence. No integrity check was disabled.
- Final `git diff --check`: PASS. Validation scripts, downloaded/build outputs,
  caches and logs remain excluded from the feature manifest and unstaged.

**READY TO COMMIT**
