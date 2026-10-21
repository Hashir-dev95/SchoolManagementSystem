# T-PR15B — Live Room UI and React Native ZEGOCLOUD

Branch: `feture`. Base: `e153078e4f02a7608f70bae20bfc4210a63d3669`.
No staging, commit or push. T-PR15C/D remain deferred.

## A. Repository discovery

React Native 0.86.2 / React 19.2.3, New Architecture and Hermes enabled. Android
uses Gradle 9.3.1, Kotlin 2.1.20, minSdk 24 and compile/targetSdk 36. These versions
are unchanged. Existing npm and Yarn lockfiles are both maintained. The Teacher
native stack exposes timetable period details; this is the host entry point.
There was no Student navigator or Student mobile home/timetable screen, only
Student API services. A minimal Student live-lesson list and stack were added.

The shared API client and AuthContext already supply authenticated, memory-only
sessions. Their existing dirty work is untouched. Screens reuse Hira Dashboard
shells, cards, headings, buttons, colors and typography. Existing button accessibility
semantics and 44-point minimum targets are retained. Android autolinking and iOS
CocoaPods conventions are reused. No RTC/media package previously existed.

T-PR15A routes, DTOs, occurrence mutations, managed-enrollment reader, permission
maps and provider adapter were read directly. They remain the authorization source.

## B–C. SDK selection and compatibility

Pinned `zego-express-engine-reactnative` **3.25.0**, the current npm version checked
during implementation. This is the low-level Express SDK, with explicit engine,
room, publish, play and token-renewal APIs; no prebuilt UI kit or competing RTC SDK.
Its native Android and iOS dependency versions are also pinned to 3.25.0 by the package.
`react-native-permissions` **5.6.3** supplies camera/microphone permission handling.

Official integration and token documentation were checked before installation:
[integration](https://www.zegocloud.com/docs/real-time-video-rn/quick-start/integrating-sdk),
[token authentication](https://www.zegocloud.com/docs/real-time-video-rn/communication/using-token-authentication),
[SDK package](https://www.npmjs.com/package/zego-express-engine-reactnative/v/3.25.0).
Installed declarations/native source, not guessed API shapes, drive the adapter.
The package changelog records New Architecture support from 3.19.2; its Android
implementation has Fabric view resolution. RN 0.86 retains the iOS bridge/view
registry compatibility path used by this SDK. Peer ranges alone were not treated
as proof: the actual Android debug build succeeded on this repository's toolchain.
iOS runtime compatibility still needs macOS/device validation.

## D–E. Native integration

Android manifest adds CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS,
ACCESS_NETWORK_STATE and ACCESS_WIFI_STATE; INTERNET already existed. Camera
hardware is optional so receive-only learners are not excluded. Manifest merge
removes the dependency's unused screen-sharing foreground permission/activity/service.
No storage, phone, location, screen-capture or background-media permission is requested.
The SDK's own autolinked Gradle configuration supplies its Maven dependency/repository;
no project toolchain upgrade or manual engine registration was required.

iOS Info.plist adds teacher camera and microphone usage descriptions. Podfile
includes the permission setup script with only Camera and Microphone handlers.
Autolinking discovers both libraries and the SDK podspec pins the native engine.
No Podfile.lock existed, and no Pod install or Xcode build is claimed on Windows.

## F–G. RTC abstraction and ownership

`LiveLessonClient` exposes prepare, preview, connect, remote surface attachment,
mic/camera controls, renewal, normalized state and disposal. `ZegoLiveLessonClient`
contains all media SDK calls; screens do not consume raw provider event payloads.
The native view wrapper reuses the SDK's cached `ZegoTextureView` registration
instead of registering native view names again per tile.

One controller/client pair owns a screen/authorized target. Native singleton
ownership prevents competing engines; a serialized promise queue prevents duplicate
initialization/login/publishing and orders cleanup after in-flight SDK work. Preview
and room login reuse the same engine. The engine is destroyed on leave/end/unmount
or when captured media is backgrounded. Event handlers are removed before teardown.
Disposal is idempotent and attempts every cleanup step even if another step fails.
No engine is created on ordinary React rerenders.

## H–I. Teacher preview and Start

Teacher period detail → Open live lesson → authorized period metadata and public
preview configuration → explicit device permission request → local preview. Preview
creates no LiveLessonSession, provider room login, or publishing authority. Microphone
starts muted. Class/Section/Subject/date/time come from the school timetable service.

Start remains disabled until actual preview attachment and required capture access
are confirmed. It rechecks device permissions, disables repeated requests, then calls
the original start endpoint with only periodId/date. Only its returned host credential
can log into the media room. The stream uses the backend's opaque user identity;
the client does not derive an academic room ID or supply Teacher identity as authority.
Publishing is shown as confirmed only after the SDK publishing callback.

If media login fails after backend start, the UI explicitly says School-App access
was granted but media connection failed. The school session may already be live;
Teacher can end it, or leave and retry that same occurrence. No replacement room or
infinite retry loop is created.

## J–K. Student discovery, Join and receive-only policy

Authenticated Student navigation opens an available-live-lessons screen. Discovery
is restricted to active explicit enrollment in the same Branch/AcademicPeriod/Class/
Section and the live time window. Its result is a hint, never a media credential.
Selection passes only the school session ID in navigation. Join requests the existing
join-token endpoint, whose T-PR15A authority is revalidated before provider login.

Student uses only the returned participant credential. There is no camera preview,
capture permission request, mic/camera publishing control, or publish call in this flow.
The adapter also rejects participant capture-control calls. T-PR15A's host publish=1 /
Student publish=0 grants are unchanged. No legacy Student.classId/sectionId fallback.

## L–N. Rendering, controls and connection model

Normalized participants contain a stable stream/participant key, generic safe display
label, audio/video state and loading/playing/error state. Provider names are not
trusted as school identities, and opaque IDs are not shown to users. No safe named
participant roster exists in T-PR15A, so tiles say “Lesson presenter.” Students are
receive-only and do not create video tiles merely by joining.

Remote stream events start playback, attach a stable native surface, and stop
playback/remove tiles on removal. Audio continues with a camera-off placeholder.
Teacher has a local preview and confirmed microphone/camera controls; SDK failures
retain the last confirmed control state or close failed device capture. Surface/play
failures update the tile error state. There is no participant moderation/presence ledger.

Media state is explicit: idle, preparing, connecting, connected, disconnecting,
disconnected, error. SDK connection/reconnection notifications update these labels;
this is basic SDK behavior, not a T-PR15C reconnect strategy. Backend session status
is displayed separately. A connected room does not imply successful publishing.

## O–P. Device permissions and errors

Permission handling distinguishes granted, denied, blocked and unavailable for each
device. Only denied permissions are requested; prompts are sequential. Blocked or
unavailable access cannot start preview or a lesson. Settings guidance and denied
permission retry are available. Returning from Settings before media initialization
refreshes permission state without creating media. Backgrounding captured media
closes it and requires reopening the screen; it does not silently recapture devices.

API 401/403/404/409/503 and network errors have separate sanitized school-facing
messages. Media initialization/login/capture/playback/cleanup failures are separate
from API authorization failures. Expired credentials are identified separately.
No raw SDK exception, signed token or private provider payload is shown/logged.

## Q–R. Navigation, lifecycle, End and Leave

Route identity prevents duplicate room stack entries, and pending operations suppress
duplicate taps. Back navigation confirms leaving. Unmount/auth-target change removes
listeners, invalidates pending authorization results and closes the owned client.
Late API responses cannot log into media after the controller is closed. Student
list reads are generation-guarded across blur/unmount/refresh.

Teacher End confirms, calls the authoritative end endpoint first, then stops publishing,
preview, subscriptions, room login and engine resources before returning. Backend failure
leaves End available for retry. Backend success remains ended even if SDK cleanup fails;
cleanup continues and a sanitized device-indicator warning is presented if needed.
Teacher Leave closes local media without pretending to end the school session.
Student Leave only closes media and never calls the Teacher end endpoint.

## S. Expiry and renewal

The SDK token warning and one expiry timer use the existing authorized issuance APIs:
Teacher repeats the idempotent occurrence start; Student repeats join-token. Every
renewal revalidates current school authority; returned session/room/user/provider/role
must match the owned room before calling `renewToken`. No new renewal endpoint or
long-lived token was added.

The renewal lead is 20% of remaining TTL, capped at 60 seconds, so a configured
30-second credential renews safely too. Early/repeated SDK warnings are gated, and
renewals do not overlap. Credentials capped to scheduledEnd expire locally at that
deadline instead of causing a renewal loop. Denied/failed renewal closes media and
asks the user to request access again; there is no infinite retry.

Already-issued tokens retain the T-PR15A revocation limit: remote eviction is not
implemented. A Student may remain connected until renewal/expiry after a backend end;
host publishing stops immediately on successful local End. No callback/presence
mechanism is invented to claim instantaneous remote-room teardown.

## T–U. Security, storage and logging

School-App remains the authorization authority. Client role/route visibility is UX
only. No Teacher identity, enrollment claim, arbitrary room creation, signing secret,
AppSign or locally generated provider token is introduced. Engine AppSign is empty;
server-issued Token04 is supplied only to login/renewal. Public AppID is the only new
provider configuration exposed to preview.

RTC credentials remain in transient call frames, not React state, AsyncStorage,
navigation params, analytics or logs. The controller clears its school auth token
on close; timers retain only expiry metadata. SDK file logging is disabled with
logSize=0. Its iOS wrapper logging sink is inactive in the inspected pinned source.
No provider-log upload or messaging API is called. Tests use synthetic credentials
and mocked media, never a real RTC account or paid minutes.

## V–W. UI, accessibility and RTL

Teacher and Student use shared Hira Dashboard components, typography and semantic
colors. Named media states, text-labelled mic/camera status, alerts, disabled-button
semantics and existing minimum touch sizes avoid color-only controls. No hardcoded
left/right layout assumption is added. Actual device RTL, accessibility and screen
reader behavior remain pre-release checks; no device screenshots are claimed.

## X–Z. Validation

- New focused frontend suites: **38/38 PASS** across controller, RTC adapter, API,
  permissions, room UI and Student discovery.
- Complete frontend suite: 54 suites / 496 tests passed; impacted suites were also
  rechecked after final media error/renewal guards.
- Frontend TypeScript uses `.validation-tpr15b/tsconfig.frontend.json` with the same
  frontend-only scope used by earlier Teacher validation. The root config includes
  backend/test/artifact trees and is not a meaningful frontend-only check.
- Changed-file ESLint passes with zero errors/warnings. `git diff --check` passes.
- Android `:app:assembleDebug` passed on all configured ABIs. A final cached build
  of the final native manifest also passed. Output: `android/app/build/outputs/apk/debug/app-debug.apk`.
- Production Android Metro bundling passed, including the pinned SDK JavaScript.
- React Native CLI autolinking configuration and Android/iOS XML structure were checked.
  Windows has no CocoaPods/Xcode toolchain, so iOS Pod install/compile/device use is unverified.
- `adb devices` reports no connected device/emulator. No physical media validation is claimed.

Evidence is in `.validation-tpr15b/`: frontend-final.log, frontend-focused-final.log,
frontend-scoped-final.log, lint-final.log, backend-regression.log,
backend-focused-final.log, backend-typescript-final.log, android-build-online.log,
android-build-final.log, metro-bundle-final.log, native-autolinking.json,
before.patch, before-status.txt and preservation.json. These are local artifacts,
not feature files to stage.

## AA–AB. Minimal backend contracts and regressions

Two integration gaps were demonstrated and addressed:

| Route                                                            | Purpose and authority                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/api/live-lessons/from-timetable/:periodId/preview-config` | `{date}`; current Teacher/start permission, existing occurrence fences and managed curriculum; returns `{provider, appId}` only; creates no session/token                                |
| GET `/api/live-lessons/available`                                | Current Student/join permission, active Branch/profile, explicit current enrollment, exact stored scope/window; at most 20 live session summaries with safe class/section/subject labels |

The provider interface adds only `publicConfig()`. Original start/join/end, Token04
grants, occurrence/substitute authority, historical reads and index bootstrap are
unchanged. No real provider network operation is added.

Backend focused suite: **44/44 PASS**, including the two new contract tests and all
original security/concurrency cases. Relevant five-suite run initially passed
218/219 with one worker-ready timeout during the concurrent four-ABI C++ build.
After compilation finished, isolated focused rerun passed all 44. The other four
suites (auth/bootstrap, RBAC/approval, timetable/substitute and enrollment) passed
175/175; combined current coverage is 219/219. This is transparently a combined
result, not a claim that the initial run passed. No timeout guard was weakened.

Backend TypeScript has exactly the known `safety-alert.controller.ts:47 TS2322`.
There are no new backend diagnostics.

## AC. Exact T-PR15B feature files

Dependencies and native configuration:

- `package.json`
- `package-lock.json`
- `yarn.lock`
- `android/app/src/main/AndroidManifest.xml`
- `ios/Podfile`
- `ios/SchoolManagementSystem/Info.plist`

Navigation and existing UI integration:

- `src/navigation/AppNavigator.tsx`
- `src/navigation/TeacherNavigator.tsx`
- `src/navigation/StudentNavigator.tsx`
- `src/constants/permissions.ts`
- `src/screens/teacher/TeacherPeriodScreen.tsx`

Room UI and client boundaries:

- `src/screens/liveLessons/LiveLessonRoomScreen.tsx`
- `src/screens/liveLessons/TeacherLiveLessonScreen.tsx`
- `src/screens/liveLessons/StudentLiveLessonsScreen.tsx`
- `src/services/liveLessons/liveLessonService.ts`
- `src/services/liveLessons/mediaPermissions.ts`
- `src/services/liveLessons/LiveRoomController.ts`
- `src/services/liveLessons/rtc/types.ts`
- `src/services/liveLessons/rtc/ZegoLiveLessonClient.ts`
- `src/services/liveLessons/rtc/ZegoVideo.tsx`

Frontend verification:

- `__tests__/live-room-controller.test.ts`
- `__tests__/zego-live-client.test.ts`
- `__tests__/live-lesson-api.test.ts`
- `__tests__/live-room-screen.test.tsx`
- `__tests__/live-media-permissions.test.ts`
- `__tests__/live-student-discovery.test.tsx`
- `__tests__/teacher-navigation.test.tsx`
- `__tests__/teacher-service.test.ts`

Backend contracts and verification:

- `backend/src/services/live-lesson.service.ts`
- `backend/src/routes/live-lesson.routes.ts`
- `backend/src/services/rtc/rtc-provider.ts`
- `backend/src/services/rtc/zego-rtc-provider.ts`
- `backend/tests/live-lesson.security.test.ts`
- `backend/tests/helpers/live-lesson-worker.ts`

Report:

- `docs/T-PR15B-live-room-ui.md`

Total: **35 feature files**. Generated validation/build/cache files are excluded.

## AD–AF. Mixed-file boundaries and preservation

No initially dirty file was edited for this phase: **no mixed files or mixed-file
hunks**. Before editing, git status and the full binary diff were captured. The
preservation audit compares every originally dirty file's complete Git patch to
that baseline: all **50** are unchanged. This includes the shared API client,
unrelated enrollment/attendance/auth services and the separate attendance-history
repair. Existing Gradle caches were used for the requested native build and remain
untracked artifacts. No reset/restore/clean/staging/commit/push was used.

## AG–AJ. Separate validation gates and deferred phases

**PRE-RELEASE DEVICE VALIDATION REQUIRED**: camera preview, microphone capture,
speaker routing, remote video/audio, Android/iOS permission prompts, background/
foreground media behavior, weak-network behavior, RTL and accessibility on devices.
An actual two-device Teacher/Student smoke test remains necessary with configured
provider credentials. iOS additionally requires macOS Pod/Xcode validation.

The unchanged safety-controller TS2322 remains an **UNRELATED RELEASE GATE** for
compiled backend release. It was not fixed or made T-PR15B's responsibility.

T-PR15C is not begun: no waiting room/admission, moderation, force mute/remove,
chat, hand raise, host transfer, persistent presence ledger or reconnect hardening.
T-PR15D is not begun: no recording control/callback/storage/library. No provider
callback ingestion endpoint or formal attendance coupling was added.

## AK–AL. Remaining blockers and verdict

No demonstrated T-PR15B code/security/data-integrity blocker remains. Native device
and iOS toolchain checks above are separate pre-release requirements, not claimed
completed by mocked tests or Android compilation.

**READY FOR REVIEW**

## AM. Final closure review — 2026-10-21

This section supersedes the review verdict above. Branch `feture`; no application
source was edited during closure. No staging, commit or push was performed.

| Item | Closure finding |
| --- | --- |
| A. Feature boundary | PASS. The exact 35 files in AC remain the feature manifest; dependencies/native integration, start/join UI, RTC/permissions/controller/rendering/renewal, minimal contracts, tests and documentation only. |
| B. Security | PASS. Backend authorization, authenticated Teacher identity, explicit StudentEnrollment, exact issued room and role grants remain authoritative. No legacy enrollment fallback, client signing, secret/AppSign exposure, arbitrary room creation, host credential reuse or implicit administrative participation. Credentials are transient; no storage/navigation/logging/analytics sink; provider errors are sanitized. |
| C. RTC lifecycle | PASS. Singleton ownership and serialized operations prevent duplicate engines/login/publishing. Disposal closes the queue to new work, removes callbacks, independently attempts capture/publish/playback/preview stop, logout and destruction, and is idempotent. Late authorization cannot reconnect a closed controller. Native surfaces unmount with the room/tiles. |
| D. Teacher start | PASS. Authorized preview metadata and permission-gated local preview precede backend start, host credential, exact-room login and publishing. Connection failure preserves truthful school-session state and does not create another occurrence/room. |
| E. Student join | PASS. Enrollment-scoped discovery precedes fresh join authorization and exact provider-room login; no Teacher issuance path. |
| F. Receive-only | PASS. No Student permission prompt, local preview, capture controls or publishing call; backend publish=0 unchanged. |
| G. Renewal | PASS. Existing start/join APIs revalidate authority; session/room/user/provider/AppID/role cannot change. Single in-flight renewal, bounded lead, scheduled-end expiry and fail-closed media teardown; T-PR15A TTL remains 30–600 seconds, capped to scheduledEnd. |
| H. Native permissions | PASS. Only camera, microphone and required audio/network additions; only Camera/Microphone iOS handlers. Screen-sharing components/foreground permission removed. Existing empty iOS location description is unchanged and no location handler/request was added. |
| I. Resources | PASS. AppState/navigation hook cleanup, provider callbacks, remote playback/surfaces, renewal timer, late-response guards and independent teardown inspected. No demonstrated resource leak. |
| J. UI/accessibility | PASS by code review. Shared Hira shell/theme/buttons, minimum 44-point targets, button/disabled semantics and visible textual media states; no new directional layout assumptions. Device RTL/accessibility remains required. |
| K. Frontend | Fresh PASS: focused 38/38; complete 54 suites, 496/496; scoped TypeScript; changed-file ESLint; diff whitespace check. |
| L. Backend | Fresh five-suite run PASS 219/219, including all 44 live-lesson cases and bootstrap/RBAC/timetable/substitute/enrollment regressions. |
| M. Android/bundle | Fresh offline assembleDebug PASS, 155 tasks; production Android Metro bundle PASS. |
| N. iOS | IOS PRE-RELEASE VALIDATION REQUIRED. Pod install, Xcode compilation and device media cannot be validated on Windows; no PASS claimed. |
| O. Physical devices | PRE-RELEASE DEVICE VALIDATION REQUIRED: preview, mic capture, speaker routing, remote audio/video, Android/iOS prompts, background/foreground, weak network, physical RTL/accessibility and two-device Teacher/Student smoke test. No production media validation claimed. |
| P. Manifest | Exact unchanged 35-file list in AC. |
| Q. Mixed files | None: no manifest file overlaps the 50 original dirty-file patches. |
| R. Preservation | All 50 original complete Git patches still match before.patch; index empty. An additional unrelated approval-scope.service.ts formatting diff was already present at closure entry, outside that baseline/manifest, and was left untouched. The audit correctly reports it as unexpectedTrackedChanges; its aggregate exit is therefore 1, not a preservation mismatch. |
| S. Artifacts | .validation-tpr15b/, Gradle caches and Android outputs remain outside the feature manifest and unstaged. |
| T. Safety diagnostic | UNRELATED RELEASE GATE: unchanged safety-alert.controller.ts:47 TS2322 is the only fresh backend TypeScript diagnostic; no fix attempted. |
| U. T-PR15C | Deferred: waiting room, admit/reject, force mute/remove, hand raise, chat, persistent presence ledger, reconnect hardening, host transfer and provider-side revocation. |
| V. T-PR15D | Deferred: recording start/stop, provider recording task, recording callbacks/storage and Recording Library. |
| W. Blockers | No demonstrated T-PR15B code/security/data-integrity blocker remains. |
| X. Verdict | READY TO COMMIT |

Fresh evidence: `.validation-tpr15b/closure-{frontend,focused,typescript,eslint,backend,backend-typescript,android,metro}.log`.
The first frontend attempt had one timeout; the unchanged existing validation
configuration passed all 496 on rerun. Initial backend invocation failed at sandbox
Windows account lookup before tests; the authorized outside-sandbox run passed.
Initial Android attempts failed at the environment's `C:\.android` path; setting
`ANDROID_USER_HOME` to a local validation directory produced the successful build.
No test guard or feature source was changed to obtain these results.

**READY TO COMMIT**
