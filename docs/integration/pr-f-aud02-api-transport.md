# F-AUD-02 — Explicit API origin configuration

## Baseline and scope

Branch: `integration/team-merge`. Baseline HEAD: `1a06940b545de275eb06d97ce421e72597afac37`.
The initial worktree and index were clean. F-AUD-01 was already committed.
Only the eleven approved files belong to this change. No dependencies, backend,
JWT/session logic, chat/notification authority, manifests, ATS or TypeScript
configuration are changed. All changes remain unstaged.

Existing transport was a single HTTP LAN constant in `src/services/api/apiClient.ts:1`.
Authentication, chat and notification services already delegate to that client.
React Native 0.86.2 uses the existing RN Babel preset and Metro configuration.
The installed Metro transformer accepts the actual bundle `dev` option, and the
installed Gradle plugin registers `BundleHermesCTask` for release JS/Hermes output.

Existing evidence at the audited baseline (before this change):

- `package.json:19`: React Native 0.86.2.
- `src/services/api/apiClient.ts:31`: fetch used the hardcoded base; `:35`: Bearer header.
- `src/services/auth/authService.ts:16`: login uses the canonical API client.
- `babel.config.js:2`: RN preset; `metro.config.js:9`: empty custom configuration.
- `android/app/build.gradle:3`: RN Gradle plugin already enabled.
- `node_modules/@react-native/metro-babel-transformer/src/index.js:144`: bundle dev mode determines transformer environment.
- `node_modules/@react-native/gradle-plugin/react-native-gradle-plugin/src/main/kotlin/com/facebook/react/TaskConfiguration.kt:68`: existing release bundle task registration; `:82`: devEnabled=false.
- `node_modules/@react-native/gradle-plugin/react-native-gradle-plugin/src/main/kotlin/com/facebook/react/tasks/BundleHermesCTask.kt:155`: existing automatic reset-cache argument.
- `android/app/src/main/AndroidManifest.xml:20`: cleartext placeholder; installed `AgpConfiguratorUtils.kt:42`: release=false.
- `ios/SchoolManagementSystem/Info.plist:32`: arbitrary loads disabled; `:34`: local networking exception.
- `ios/SchoolManagementSystem.xcodeproj/project.pbxproj:182`: unchanged environment/bundling wrapper.

## Public configuration contract

The only build-host inputs are `SCHOOL_APP_DEV_API_ORIGIN` and
`SCHOOL_APP_RELEASE_API_ORIGIN`. Values are origins, without `/api`. An optional
root slash is normalized; the client appends the canonical `/api` prefix once.

Development requires an explicit HTTP/HTTPS origin and permits LAN, emulator and
localhost addresses. Release requires an explicit HTTPS public DNS hostname.
There is no default URL and no release-to-development fallback. Missing values,
unreplaced markers, credentials, URL paths, query strings, fragments, invalid
ports, IP literals and local/intranet release names fail closed.

Release intentionally rejects all IP literals, including public IPs, and uses a
conservative ASCII DNS grammar. Syntax validation does not establish public DNS
routing, certificate trust, deployment ownership or production connectivity.
Those are separate deployment checks. All `*.example.com` endpoints in tests and
validation commands are synthetic fixtures, never production defaults.

Configuration contains public origins only, never JWTs, passwords or server
secrets. Rejection messages name the setting but never echo its invalid value.

## Build and runtime integration

`config/api-origin-policy.js` is a pure shared validator; it uses no Node APIs.
Build tooling passes its environment to an explicit two-setting allowlist.
The local Babel plugin substitutes only markers in `src/services/api/apiConfig.ts`.
It does not replace arbitrary environment expressions or other source files.
Babel cache invalidation includes both inputs.

Metro snapshots both inputs at startup. Its transform hook validates the actual
`dev` option, independently of `NODE_ENV`/`BABEL_ENV`, before delegating to the
unchanged RN default transform options, including inline requires. The snapshot's
fingerprint changes Metro's cache identity. Restart Metro after changing inputs.

The runtime chooses through `__DEV__`, revalidates the injected value and appends
`/api`. The developer marker is inside the development branch so release bundling
can eliminate its URL. Invalid configuration throws before timers or `fetch`.
The client retains existing Bearer headers, JSON, timeout/abort and ApiError behavior.

Android release bundle tasks declare both environment inputs, including their
absence, through Gradle providers. This prevents an environment-only change from
silently reusing an up-to-date JS/Hermes bundle. The existing iOS bundling phase
and `.xcode.env`/ignored `.xcode.env.local` wrapper remain unchanged.
Android release cleartext denial and iOS ATS restrictions remain intact.

## Developer and deployment commands

PowerShell development (explicit existing local server, not a release fallback):

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN = 'http://192.168.137.1:5000'
npm start
# In another terminal, using the intended Metro server:
npm run android
```

The deployment owner supplies the approved HTTPS origin in the environment of the
release build process. It must not include `/api`. No endpoint is invented here.

```powershell
# SCHOOL_APP_RELEASE_API_ORIGIN must already contain the approved HTTPS origin.
Set-Location D:\SchoolManagementSystem\android
.\gradlew.bat :app:createBundleReleaseJsAndAssets --console=plain
```

On macOS, export the same release setting before invoking Xcode/xcodebuild, or
export it through the existing ignored `ios/.xcode.env.local` for local builds.
For local iOS development, supply the development setting to Metro as well.
Release packaging must use actual release bundling; do not bypass it with a stale
prebuilt bundle or `SKIP_BUNDLING`. Do not loosen ATS/cleartext policy for LAN access.

## Verification

Final frontend regression execution passed: 318 tests across 21 suites, zero
failures. This includes all three new policy/build/client suites and existing
authentication, notification, Teacher/Student/Parent and shared chat regressions.
Backend TypeScript, mobile-scoped TypeScript and strict scoped ESLint passed.
Initial failures and retries are retained in the execution appendix; assertions
and existing test timeouts were not weakened.

Actual Android and iOS-platform Metro release bundles used synthetic HTTPS
fixtures, including runs with misleading development NODE_ENV/BABEL_ENV. Android
A-to-B output changed, unchanged B output was identical, and inspected release
output contained no developer LAN URL or unreplaced release marker. Missing and
HTTP release settings were rejected by the actual Metro hook.

The existing offline Android createBundleReleaseJsAndAssets task passed, including
Hermes compilation and asset copying. On final source, only changing the origin
from A to B reran the task; unchanged B was UP-TO-DATE; removing the setting reran
and failed the task. The verified final native artifacts had SHA256:

- A: C3B5EA2A9639A2A64269B39A16E866EB5F0F6C2514E9DAF3D930CC25C4C2862C
- B: F7B8B67DFE026F12FB6129158EEA91805A0C1A0E4FF2CCCEE41C9C904FF3B3B6

The installed RN Gradle task adds --reset-cache itself, so native gates were run
serially after an initial parallel Metro-cache ENOTEMPTY collision. Separate
direct Metro gates used no --reset-cache, proving warm-cache behavior. No manual
cache deletion, Git reset/clean/restore or source discard was performed.

Coverage is a JS/Hermes release bundle gate, not a complete signed APK/AAB or
device test. No production connection, Android release-device test or
macOS/Xcode native iOS build has been performed. iOS platform Metro bundling on
Windows is not native iOS verification. The unchanged Xcode phase and ATS were
inspected statically.
F-AUD-03 remains deferred: the preceding audit's root TypeScript check had exit 2
and 76 backend-related diagnostics; this task uses separate backend and existing
mobile-scoped checks and does not modify TypeScript exclusions.

## Self-check and remaining release checks

The eleven approved files were reopened and checked against the exact scope;
the index is empty. No hardcoded production domain, insecure release fallback,
new dependency, backend authorization change, manifest or ATS change is present.
Within this change, only tests and development documentation contain the former developer LAN URL.
Production readiness still requires an owner-approved public HTTPS origin, DNS,
trusted TLS, actual backend connectivity and platform/device release verification.
No deployment, commit, push, fetch, pull, merge or additional roadmap phase ran.

## Execution appendix — fresh commands and raw output

Commands below ran on this worktree. Expected negative exits are explicitly identified. Earlier failures are retained, not presented as passes. Logs and synthetic artifacts live in host TEMP or existing ignored build directories. Formatting and read-only inspection commands are not test executions.

### Exact sequential native verification driver

Working directory: D:\SchoolManagementSystem\android. Overall exit 0; per-case exits 0,0,0,1.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'
$taskCases=@(
  @{Name='a-final';Origin='https://api-a.example.com';Expected=0},
  @{Name='b-final';Origin='https://api-b.example.com';Expected=0},
  @{Name='b-repeat';Origin='https://api-b.example.com';Expected=0},
  @{Name='missing';Origin='';Expected=1}
)
foreach($taskCase in $taskCases){
  $env:SCHOOL_APP_RELEASE_API_ORIGIN=$taskCase.Origin
  $taskLog=Join-Path $env:TEMP ("sms-api-gradle-"+$taskCase.Name+".log")
  .\gradlew.bat -g D:\SchoolManagementSystem\.gradle-user --offline :app:createBundleReleaseJsAndAssets --console=plain 2>&1 | Tee-Object -FilePath $taskLog | Select-Object -Last 20
  $taskExit=$LASTEXITCODE
  Write-Output ("CASE="+$taskCase.Name+" ACTUAL_EXIT="+$taskExit+" EXPECTED_EXIT="+$taskCase.Expected)
  if($taskExit -ne $taskCase.Expected){exit 2}
  if($taskCase.Name -eq 'b-repeat' -and -not (Select-String -LiteralPath $taskLog -SimpleMatch ':app:createBundleReleaseJsAndAssets UP-TO-DATE')){throw 'Unchanged B bundle task was not up-to-date'}
  if($taskExit -eq 0){
    $taskBytes=[IO.File]::ReadAllBytes((Join-Path $PWD 'app/build/generated/assets/react/release/index.android.bundle'))
    $taskText=[Text.Encoding]::UTF8.GetString($taskBytes)
    if(-not $taskText.Contains($taskCase.Origin) -or $taskText.Contains('192.168.137.1')){throw 'Native bundle origin mismatch'}
    if($taskCase.Name -eq 'b-final' -and $taskText.Contains('https://api-a.example.com')){throw 'Stale native origin A'}
    [IO.File]::WriteAllBytes((Join-Path $env:TEMP ("sms-api-gradle-"+$taskCase.Name+".hbc")),$taskBytes)
    Write-Output ("NATIVE_ORIGIN_VERIFIED="+$taskCase.Origin)
  }elseif(-not (Select-String -LiteralPath $taskLog -SimpleMatch 'SCHOOL_APP_RELEASE_API_ORIGIN')){throw 'Missing setting failed for an unrelated reason'}
}
$taskAHash=(Get-FileHash -LiteralPath (Join-Path $env:TEMP 'sms-api-gradle-a-final.hbc')).Hash
$taskBHash=(Get-FileHash -LiteralPath (Join-Path $env:TEMP 'sms-api-gradle-b-final.hbc')).Hash
if($taskAHash -eq $taskBHash){throw 'Native A/B hash unchanged'}
Write-Output ("NATIVE_A_SHA256="+$taskAHash)
Write-Output ("NATIVE_B_SHA256="+$taskBHash)
exit 0
```

### Exact sequential Metro verification driver

Working directory: D:\SchoolManagementSystem. Overall exit 0; per-case exits 0,0,0,0,1,1. No reset-cache flag was used.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'
$env:NODE_ENV='development'
$env:BABEL_ENV='development'
$taskCases=@(
 @{Name='android-a-final';Platform='android';Origin='https://api-a.example.com';Expected=0},
 @{Name='android-b-final';Platform='android';Origin='https://api-b.example.com';Expected=0},
 @{Name='android-b-repeat';Platform='android';Origin='https://api-b.example.com';Expected=0},
 @{Name='ios-b-final';Platform='ios';Origin='https://api-b.example.com';Expected=0},
 @{Name='warm-missing';Platform='android';Origin='';Expected=1},
 @{Name='http';Platform='android';Origin='http://api-b.example.com';Expected=1}
)
foreach($taskCase in $taskCases){
 $env:SCHOOL_APP_RELEASE_API_ORIGIN=$taskCase.Origin
 $taskLog=Join-Path $env:TEMP ("sms-api-bundle-"+$taskCase.Name+".log")
 $taskOutput=Join-Path $env:TEMP ("sms-api-"+$taskCase.Name+".jsbundle")
 node node_modules/react-native/cli.js bundle --platform $taskCase.Platform --dev false --entry-file index.js --bundle-output $taskOutput --max-workers 2 2>&1 | Tee-Object -FilePath $taskLog | Select-Object -Last 20
 $taskExit=$LASTEXITCODE
 Write-Output ("CASE="+$taskCase.Name+" ACTUAL_EXIT="+$taskExit+" EXPECTED_EXIT="+$taskCase.Expected)
 if($taskExit -ne $taskCase.Expected){exit 2}
 if($taskExit -eq 0){
  $taskText=[IO.File]::ReadAllText($taskOutput)
  if(-not $taskText.Contains($taskCase.Origin) -or $taskText.Contains('192.168.137.1') -or $taskText.Contains('__SCHOOL_APP_RELEASE_API_ORIGIN__')){throw 'Release output mismatch'}
  if($taskCase.Origin -like '*api-b*' -and $taskText.Contains('https://api-a.example.com')){throw 'Stale origin A'}
  Write-Output ('OUTPUT_SHA256='+(Get-FileHash -LiteralPath $taskOutput).Hash)
 }elseif(-not (Select-String -LiteralPath $taskLog -SimpleMatch 'SCHOOL_APP_RELEASE_API_ORIGIN')){throw 'Negative gate failed for unrelated reason'}
}
$taskAHash=(Get-FileHash -LiteralPath (Join-Path $env:TEMP 'sms-api-android-a-final.jsbundle')).Hash
$taskBHash=(Get-FileHash -LiteralPath (Join-Path $env:TEMP 'sms-api-android-b-final.jsbundle')).Hash
$taskRepeatHash=(Get-FileHash -LiteralPath (Join-Path $env:TEMP 'sms-api-android-b-repeat.jsbundle')).Hash
if($taskAHash -eq $taskBHash -or $taskBHash -ne $taskRepeatHash){throw 'Warm-cache A/B/repeat identity failure'}
Write-Output 'Release matrix: 6 expected outcomes verified; A differs from B; repeated B identical; developer LAN absent.'
exit 0
```

### Command 1 — sms-api-origin-tests-initial.log

Working directory: D:\SchoolManagementSystem

Exit: 1. 67 passed, 13 failed; 2 suites passed, 1 failed. Initial test-harness require routing failed.

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/api-origin-policy.test.ts __tests__/api-origin-build.test.ts __tests__/api-client.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-origin-tests-initial.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text

    TypeError: _interopRequireDefault is not a function

      at eval (eval at execute (__tests__/api-client.test.ts:36:22), <anonymous>:3:219)
      at evaluate (__tests__/api-client.test.ts:47:5)
      at execute (__tests__/api-client.test.ts:63:18)
      at Object.loadClient (__tests__/api-client.test.ts:182:32)
      at asyncGeneratorStep (node_modules/@babel/runtime/helpers/asyncToGenerator.js:3:17)
      at _next (node_modules/@babel/runtime/helpers/asyncToGenerator.js:17:9)
      at node_modules/@babel/runtime/helpers/asyncToGenerator.js:22:7
      at Object.<anonymous> (node_modules/@babel/runtime/helpers/asyncToGenerator.js:14:12)

PASS __tests__/api-origin-build.test.ts (11.823 s)
PASS __tests__/api-origin-policy.test.ts

Test Suites: 1 failed, 2 passed, 3 total
Tests:       13 failed, 67 passed, 80 total
Snapshots:   0 total
Time:        47.573 s
Ran all test suites matching /__tests__\\api-origin-policy.test.ts|__tests__\\api-origin-build.test.ts|__tests__\\api-client.test.ts/i.
```

### Command 2 — sms-api-origin-tests-final.log

Working directory: D:\SchoolManagementSystem

Exit: 1. 79 passed, 1 failed; 2 suites passed, 1 failed. Unreplaced-marker case exposed plugin recursion, subsequently fixed.

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/api-origin-policy.test.ts __tests__/api-origin-build.test.ts __tests__/api-client.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-origin-tests-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text
      at TraversalContext.visitQueue (node_modules/@babel/traverse/src/context.ts:167:21)
      at TraversalContext.visitQueue (node_modules/@babel/traverse/src/context.ts:167:21)
      at TraversalContext.visitQueue (node_modules/@babel/traverse/src/context.ts:167:21)
      at TraversalContext.visitQueue (node_modules/@babel/traverse/src/context.ts:167:21)
      at TraversalContext.visitQueue (node_modules/@babel/traverse/src/context.ts:167:21)
      at TraversalContext.visitQueue (node_modules/@babel/traverse/src/context.ts:167:21)
      at TraversalContext.visitQueue (node_modules/@babel/traverse/src/context.ts:167:21)
      at TraversalContext.visitQueue (node_modules/@babel/traverse/src/context.ts:167:21)
      at TraversalContext.visitQueue (node_modules/@babel/traverse/src/context.ts:167:21)
      at TraversalContext.visitQueue (node_modules/@babel/traverse/src/context.ts:167:21)
      at TraversalContext.visitQueue (node_modules/@babel/traverse/src/context.ts:167:21)

PASS __tests__/api-origin-build.test.ts (13.354 s)
PASS __tests__/api-origin-policy.test.ts

Test Suites: 1 failed, 2 passed, 3 total
Tests:       1 failed, 79 passed, 80 total
Snapshots:   0 total
Time:        19.985 s, estimated 27 s
Ran all test suites matching /__tests__\\api-origin-policy.test.ts|__tests__\\api-origin-build.test.ts|__tests__\\api-client.test.ts/i.
```

### Command 3 — sms-api-origin-regressions.log

Working directory: D:\SchoolManagementSystem

Exit: 1. 313 passed, 3 failed; 18 suites passed, 3 failed. Two five-second UI timeouts while bundles ran; developer-preview required an explicit development origin.

```powershell
.\node_modules\.bin\jest.cmd --runInBand __tests__/api-origin-policy.test.ts __tests__/api-origin-build.test.ts __tests__/api-client.test.ts __tests__/notification-service.test.ts __tests__/notification-inbox-service.test.ts __tests__/notification-inbox.test.tsx __tests__/teacher-notifications.test.tsx __tests__/chat-service.test.ts __tests__/chat-workspace.test.tsx __tests__/chat-navigation.test.tsx __tests__/teacher-navigation.test.tsx __tests__/teacher-screens.test.tsx __tests__/teacher-service.test.ts __tests__/student-workspace.test.tsx __tests__/student-workspace-service.test.ts __tests__/parent-workspace.test.tsx __tests__/parent-service.test.ts __tests__/auth-session.test.tsx __tests__/developer-preview.test.tsx __tests__/teacher-communications.test.tsx __tests__/teacher-communication-service.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-origin-regressions.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text

      158 |   await expect(
      159 |     apiClient.request('/admin/dashboard', { token: auth.accessToken! }),
    > 160 |   ).rejects.toEqual(new ApiError(403, 'Forbidden'));
          |             ^
      161 |   expect(globalThis.fetch).toHaveBeenCalledWith(
      162 |     expect.any(String),
      163 |     expect.objectContaining({

      at Object.toEqual (node_modules/expect/build/index.js:218:22)
      at Object.toEqual (__tests__/developer-preview.test.tsx:160:13)
      at asyncGeneratorStep (node_modules/@babel/runtime/helpers/asyncToGenerator.js:3:17)
      at _next (node_modules/@babel/runtime/helpers/asyncToGenerator.js:17:9)


Test Suites: 3 failed, 18 passed, 21 total
Tests:       3 failed, 313 passed, 316 total
Snapshots:   0 total
Time:        134.524 s
Ran all test suites matching /__tests__\\api-origin-policy.test.ts|__tests__\\api-origin-build.test.ts|__tests__\\api-client.test.ts|__tests__\\notification-service.test.ts|__tests__\\notification-inbox-service.test.ts|__tests__\\notification-inbox.test.tsx|__tests__\\teacher-notifications.test.tsx|__tests__\\chat-service.test.ts|__tests__\\chat-workspace.test.tsx|__tests__\\chat-navigation.test.tsx|__tests__\\teacher-navigation.test.tsx|__tests__\\teacher-screens.test.tsx|__tests__\\teacher-service.test.ts|__tests__\\student-workspace.test.tsx|__tests__\\student-workspace-service.test.ts|__tests__\\parent-workspace.test.tsx|__tests__\\parent-service.test.ts|__tests__\\auth-session.test.tsx|__tests__\\developer-preview.test.tsx|__tests__\\teacher-communications.test.tsx|__tests__\\teacher-communication-service.test.ts/i.
```

### Command 4 — sms-api-origin-regressions-final.log

Working directory: D:\SchoolManagementSystem

Exit: 1. 317 passed, 1 failed; 20 suites passed, 1 failed. Existing five-second Teacher navigation timeout. No assertions/timeouts changed.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; .\node_modules\.bin\jest.cmd --runInBand __tests__/api-origin-policy.test.ts __tests__/api-origin-build.test.ts __tests__/api-client.test.ts __tests__/notification-service.test.ts __tests__/notification-inbox-service.test.ts __tests__/notification-inbox.test.tsx __tests__/teacher-notifications.test.tsx __tests__/chat-service.test.ts __tests__/chat-workspace.test.tsx __tests__/chat-navigation.test.tsx __tests__/teacher-navigation.test.tsx __tests__/teacher-screens.test.tsx __tests__/teacher-service.test.ts __tests__/student-workspace.test.tsx __tests__/student-workspace-service.test.ts __tests__/parent-workspace.test.tsx __tests__/parent-service.test.ts __tests__/auth-session.test.tsx __tests__/developer-preview.test.tsx __tests__/teacher-communications.test.tsx __tests__/teacher-communication-service.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-origin-regressions-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text

    thrown: "Exceeded timeout of 5000 ms for a test.
    Add a timeout value to this test to increase the timeout, if this is a long-running test. See https://jestjs.io/docs/api#testname-fn-timeout."

      113 |   },
      114 | );
    > 115 | test('Teacher Me opens Messages without replacing the separate notice Inbox', async () => {
          | ^
      116 |   await mount(
      117 |     <TeacherWorkspaceScreen
      118 |       navigation={{ navigate: mockNavigate } as never}

      at Object.test (__tests__/chat-navigation.test.tsx:115:1)


Test Suites: 1 failed, 20 passed, 21 total
Tests:       1 failed, 317 passed, 318 total
Snapshots:   0 total
Time:        36.05 s, estimated 134 s
Ran all test suites matching /__tests__\\api-origin-policy.test.ts|__tests__\\api-origin-build.test.ts|__tests__\\api-client.test.ts|__tests__\\notification-service.test.ts|__tests__\\notification-inbox-service.test.ts|__tests__\\notification-inbox.test.tsx|__tests__\\teacher-notifications.test.tsx|__tests__\\chat-service.test.ts|__tests__\\chat-workspace.test.tsx|__tests__\\chat-navigation.test.tsx|__tests__\\teacher-navigation.test.tsx|__tests__\\teacher-screens.test.tsx|__tests__\\teacher-service.test.ts|__tests__\\student-workspace.test.tsx|__tests__\\student-workspace-service.test.ts|__tests__\\parent-workspace.test.tsx|__tests__\\parent-service.test.ts|__tests__\\auth-session.test.tsx|__tests__\\developer-preview.test.tsx|__tests__\\teacher-communications.test.tsx|__tests__\\teacher-communication-service.test.ts/i.
```

### Command 5 — sms-api-origin-regressions-warm.log

Working directory: D:\SchoolManagementSystem

Exit: 0. 318 passed, 0 failed; 21 suites passed; 0 snapshots. Final unchanged warm-cache rerun.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; .\node_modules\.bin\jest.cmd --runInBand __tests__/api-origin-policy.test.ts __tests__/api-origin-build.test.ts __tests__/api-client.test.ts __tests__/notification-service.test.ts __tests__/notification-inbox-service.test.ts __tests__/notification-inbox.test.tsx __tests__/teacher-notifications.test.tsx __tests__/chat-service.test.ts __tests__/chat-workspace.test.tsx __tests__/chat-navigation.test.tsx __tests__/teacher-navigation.test.tsx __tests__/teacher-screens.test.tsx __tests__/teacher-service.test.ts __tests__/student-workspace.test.tsx __tests__/student-workspace-service.test.ts __tests__/parent-workspace.test.tsx __tests__/parent-service.test.ts __tests__/auth-session.test.tsx __tests__/developer-preview.test.tsx __tests__/teacher-communications.test.tsx __tests__/teacher-communication-service.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-origin-regressions-warm.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text
PASS __tests__/parent-workspace.test.tsx
PASS __tests__/teacher-notifications.test.tsx
PASS __tests__/developer-preview.test.tsx
PASS __tests__/student-workspace.test.tsx
PASS __tests__/teacher-navigation.test.tsx
PASS __tests__/auth-session.test.tsx
PASS __tests__/api-origin-policy.test.ts
PASS __tests__/chat-service.test.ts
PASS __tests__/teacher-communication-service.test.ts
PASS __tests__/parent-service.test.ts
PASS __tests__/student-workspace-service.test.ts
PASS __tests__/teacher-service.test.ts
PASS __tests__/notification-service.test.ts
PASS __tests__/notification-inbox-service.test.ts

Test Suites: 21 passed, 21 total
Tests:       318 passed, 318 total
Snapshots:   0 total
Time:        17.616 s, estimated 35 s
Ran all test suites matching /__tests__\\api-origin-policy.test.ts|__tests__\\api-origin-build.test.ts|__tests__\\api-client.test.ts|__tests__\\notification-service.test.ts|__tests__\\notification-inbox-service.test.ts|__tests__\\notification-inbox.test.tsx|__tests__\\teacher-notifications.test.tsx|__tests__\\chat-service.test.ts|__tests__\\chat-workspace.test.tsx|__tests__\\chat-navigation.test.tsx|__tests__\\teacher-navigation.test.tsx|__tests__\\teacher-screens.test.tsx|__tests__\\teacher-service.test.ts|__tests__\\student-workspace.test.tsx|__tests__\\student-workspace-service.test.ts|__tests__\\parent-workspace.test.tsx|__tests__\\parent-service.test.ts|__tests__\\auth-session.test.tsx|__tests__\\developer-preview.test.tsx|__tests__\\teacher-communications.test.tsx|__tests__\\teacher-communication-service.test.ts/i.
```

### Command 6 — sms-api-origin-mobile-ts-initial.log

Working directory: D:\SchoolManagementSystem

Exit: 2. Not a test command. Initial new host-test Node typings were incompatible with mobile types; fixed locally in approved test files.

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-origin-mobile-ts-initial.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text
__tests__/api-client.test.ts(1,18): error TS2307: Cannot find module 'node:path' or its corresponding type declarations.
__tests__/api-origin-build.test.ts(1,30): error TS2307: Cannot find module 'node:child_process' or its corresponding type declarations.
__tests__/api-origin-build.test.ts(13,41): error TS2503: Cannot find namespace 'NodeJS'.
__tests__/api-origin-build.test.ts(14,16): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
__tests__/api-origin-build.test.ts(15,10): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
__tests__/api-origin-build.test.ts(17,10): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
```

### Command 7 — sms-api-origin-mobile-ts-final.log

Working directory: D:\SchoolManagementSystem

Exit: 0. Not a test command. Intermediate mobile check passed.

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-origin-mobile-ts-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output: empty (0 lines).

### Command 8 — sms-api-origin-mobile-ts-verified.log

Working directory: D:\SchoolManagementSystem

Exit: 0. Not a test command. Final mobile check passed.

```powershell
.\node_modules\.bin\tsc.cmd --noEmit -p .validation-principal-audit/phase-e/tsconfig.mobile.json 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-origin-mobile-ts-verified.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output: empty (0 lines).

### Command 9 — sms-api-origin-backend-ts-final.log

Working directory: D:\SchoolManagementSystem\backend

Exit: 0. Not a test command. Separate backend source TypeScript check passed.

```powershell
.\node_modules\.bin\tsc.cmd --noEmit 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-origin-backend-ts-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output: empty (0 lines).

### Command 10 — sms-api-origin-eslint-initial.log

Working directory: D:\SchoolManagementSystem

Exit: 1. Not a test command. Initial test harness lint: 1 error, 1 warning; corrected without disabling rules.

```powershell
.\node_modules\.bin\eslint.cmd --max-warnings=0 config/api-origin-policy.js scripts/babel-plugin-api-origins.js babel.config.js metro.config.js src/services/api/apiConfig.ts src/services/api/apiClient.ts __tests__/api-origin-policy.test.ts __tests__/api-origin-build.test.ts __tests__/api-client.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-origin-eslint-initial.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text

D:\SchoolManagementSystem\__tests__\api-client.test.ts
   36:22  error    The Function constructor is eval              no-new-func
  200:18  warning  Async assertions must be awaited or returned  jest/valid-expect

✖ 2 problems (1 error, 1 warning)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

### Command 11 — sms-api-origin-eslint-final.log

Working directory: D:\SchoolManagementSystem

Exit: 0. Not a test command. final strict scoped ESLint passed.

```powershell
.\node_modules\.bin\eslint.cmd --max-warnings=0 config/api-origin-policy.js scripts/babel-plugin-api-origins.js babel.config.js metro.config.js src/services/api/apiConfig.ts src/services/api/apiClient.ts __tests__/api-origin-policy.test.ts __tests__/api-origin-build.test.ts __tests__/api-client.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-origin-eslint-final.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output: empty (0 lines).

### Command 12 — sms-api-origin-eslint-verified.log

Working directory: D:\SchoolManagementSystem

Exit: 0. Not a test command. verified strict scoped ESLint passed.

```powershell
.\node_modules\.bin\eslint.cmd --max-warnings=0 config/api-origin-policy.js scripts/babel-plugin-api-origins.js babel.config.js metro.config.js src/services/api/apiConfig.ts src/services/api/apiClient.ts __tests__/api-origin-policy.test.ts __tests__/api-origin-build.test.ts __tests__/api-client.test.ts 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-origin-eslint-verified.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output: empty (0 lines).

### Command 13 — sms-api-bundle-missing.log

Working directory: D:\SchoolManagementSystem

Exit: 1. Not a test suite. Expected rejection: missing release origin despite development NODE_ENV/BABEL_ENV.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; Remove-Item Env:SCHOOL_APP_RELEASE_API_ORIGIN -ErrorAction SilentlyContinue; $env:NODE_ENV='development'; $env:BABEL_ENV='development'; node node_modules/react-native/cli.js bundle --platform android --dev false --entry-file index.js --bundle-output "$env:TEMP\sms-api-missing.jsbundle" --max-workers 2 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-bundle-missing.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text
                     ▒▓▓▓▒░░░░▒▓▓▓▒
                        ▒▒▓▓▓▓▒▒


                Welcome to Metro v0.84.4
              Fast - Scalable - Integrated


error Invalid or missing SCHOOL_APP_RELEASE_API_ORIGIN: expected an HTTPS public DNS origin without credentials, path, query or fragment.
ApiConfigurationError: Invalid or missing SCHOOL_APP_RELEASE_API_ORIGIN: expected an HTTPS public DNS origin without credentials, path, query or fragment.
    at configurationError (D:\SchoolManagementSystem\config\api-origin-policy.js:8:17)
    at fail (D:\SchoolManagementSystem\config\api-origin-policy.js:50:22)
    at validateApiOrigin (D:\SchoolManagementSystem\config\api-origin-policy.js:52:11)
    at Object.getTransformOptions (D:\SchoolManagementSystem\metro.config.js:25:7)
    at calcTransformerOptions (D:\SchoolManagementSystem\node_modules\metro\src\lib\transformHelpers.js:77:50)
    at Object.getTransformFn (D:\SchoolManagementSystem\node_modules\metro\src\lib\transformHelpers.js:113:57)
    at IncrementalBundler.buildGraphForEntries (D:\SchoolManagementSystem\node_modules\metro\src\IncrementalBundler.js:100:41)
    at async IncrementalBundler.buildGraph (D:\SchoolManagementSystem\node_modules\metro\src\IncrementalBundler.js:178:19)
    at async Server.build (D:\SchoolManagementSystem\node_modules\metro\src\Server.js:241:32)
    at async runBuild (D:\SchoolManagementSystem\node_modules\metro\src\index.flow.js:355:25)
```

### Command 14 — sms-api-bundle-android-a.log

Working directory: D:\SchoolManagementSystem

Exit: 0. Not a test suite. Initial synthetic Android release A.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; $env:SCHOOL_APP_RELEASE_API_ORIGIN='https://api-a.example.com'; $env:NODE_ENV='development'; $env:BABEL_ENV='development'; node node_modules/react-native/cli.js bundle --platform android --dev false --entry-file index.js --bundle-output "$env:TEMP\sms-api-android-a.jsbundle" --max-workers 2 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-bundle-android-a.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text
                 ▓▓░░▓▓▒░░░▒▒░░░▒▓▒░░▓▓
                 ▓▓░░▓▓▓▓▓▒▒▒▒▓▓▓▓▒░░▓▓
                 ▓▓░░▓▓▓▓▓▓▓▓▓▓▓▓▓▒░░▓▓
                 ▓▓▒░░▒▒▓▓▓▓▓▓▓▓▒░░░▒▓▓
                  ▒▓▓▓▒░░░▒▓▓▒░░░▒▓▓▓▒
                     ▒▓▓▓▒░░░░▒▓▓▓▒
                        ▒▒▓▓▓▓▒▒


                Welcome to Metro v0.84.4
              Fast - Scalable - Integrated


transform[stderr]: (node:17672) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
transform[stderr]: (Use `node --trace-warnings ...` to show where the warning was created)
transform[stderr]: (node:1668) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
transform[stderr]: (Use `node --trace-warnings ...` to show where the warning was created)
LOG:Writing bundle output to: C:\Users\LAPTOP~1\AppData\Local\Temp\sms-api-android-a.jsbundle
LOG:Done writing bundle output
Warning: Assets destination folder is not set, skipping...
```

### Command 15 — sms-api-bundle-android-b.log

Working directory: D:\SchoolManagementSystem

Exit: 0. Not a test suite. Initial warm synthetic Android B.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; $env:SCHOOL_APP_RELEASE_API_ORIGIN='https://api-b.example.com'; $env:NODE_ENV='development'; $env:BABEL_ENV='development'; node node_modules/react-native/cli.js bundle --platform android --dev false --entry-file index.js --bundle-output "$env:TEMP\sms-api-android-b.jsbundle" --max-workers 2 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-bundle-android-b.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text
                 ▓▓░░▓▓▒░░░▒▒░░░▒▓▒░░▓▓
                 ▓▓░░▓▓▓▓▓▒▒▒▒▓▓▓▓▒░░▓▓
                 ▓▓░░▓▓▓▓▓▓▓▓▓▓▓▓▓▒░░▓▓
                 ▓▓▒░░▒▒▓▓▓▓▓▓▓▓▒░░░▒▓▓
                  ▒▓▓▓▒░░░▒▓▓▒░░░▒▓▓▓▒
                     ▒▓▓▓▒░░░░▒▓▓▓▒
                        ▒▒▓▓▓▓▒▒


                Welcome to Metro v0.84.4
              Fast - Scalable - Integrated


transform[stderr]: (node:9660) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
transform[stderr]: (Use `node --trace-warnings ...` to show where the warning was created)
transform[stderr]: (node:5576) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
transform[stderr]: (Use `node --trace-warnings ...` to show where the warning was created)
LOG:Writing bundle output to: C:\Users\LAPTOP~1\AppData\Local\Temp\sms-api-android-b.jsbundle
LOG:Done writing bundle output
Warning: Assets destination folder is not set, skipping...
```

### Command 16 — sms-api-bundle-ios-b.log

Working directory: D:\SchoolManagementSystem

Exit: 0. Not a test suite. Initial synthetic iOS-platform Metro bundle; not an Xcode build.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; $env:SCHOOL_APP_RELEASE_API_ORIGIN='https://api-b.example.com'; $env:NODE_ENV='development'; $env:BABEL_ENV='development'; node node_modules/react-native/cli.js bundle --platform ios --dev false --entry-file index.js --bundle-output "$env:TEMP\sms-api-ios-b.jsbundle" --max-workers 2 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-bundle-ios-b.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text
                 ▓▓░░▓▓▒░░░▒▒░░░▒▓▒░░▓▓
                 ▓▓░░▓▓▓▓▓▒▒▒▒▓▓▓▓▒░░▓▓
                 ▓▓░░▓▓▓▓▓▓▓▓▓▓▓▓▓▒░░▓▓
                 ▓▓▒░░▒▒▓▓▓▓▓▓▓▓▒░░░▒▓▓
                  ▒▓▓▓▒░░░▒▓▓▒░░░▒▓▓▓▒
                     ▒▓▓▓▒░░░░▒▓▓▓▒
                        ▒▒▓▓▓▓▒▒


                Welcome to Metro v0.84.4
              Fast - Scalable - Integrated


transform[stderr]: (node:6096) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
transform[stderr]: (Use `node --trace-warnings ...` to show where the warning was created)
transform[stderr]: (node:18212) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
transform[stderr]: (Use `node --trace-warnings ...` to show where the warning was created)
LOG:Writing bundle output to: C:\Users\LAPTOP~1\AppData\Local\Temp\sms-api-ios-b.jsbundle
LOG:Done writing bundle output
Warning: Assets destination folder is not set, skipping...
```

### Command 17 — sms-api-gradle-a.log

Working directory: D:\SchoolManagementSystem\android

Exit: 1. Not a test suite. Initial parallel build collided with the installed Gradle task's --reset-cache (ENOTEMPTY).

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; $env:SCHOOL_APP_RELEASE_API_ORIGIN='https://api-a.example.com'; .\gradlew.bat -g D:\SchoolManagementSystem\.gradle-user --offline :app:createBundleReleaseJsAndAssets --console=plain 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-gradle-a.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text
FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':app:createBundleReleaseJsAndAssets'.
> Process 'command 'cmd'' finished with non-zero exit value 1

* Try:
> Run with --stacktrace option to get the stack trace.
> Run with --info or --debug option to get more log output.
> Run with --scan to get full insights from a Build Scan (powered by Develocity).
> Get more help at https://help.gradle.org.

Deprecated Gradle features were used in this build, making it incompatible with Gradle 10.

You can use '--warning-mode all' to show the individual deprecation warnings and determine if they come from your own scripts or plugins.

For more on this, please refer to https://docs.gradle.org/9.3.1/userguide/command_line_interface.html#sec:command_line_warnings in the Gradle documentation.

BUILD FAILED in 4m 3s
11 actionable tasks: 6 executed, 5 up-to-date
```

### Command 18 — sms-api-gradle-a-retry.log

Working directory: D:\SchoolManagementSystem\android

Exit: 0. Not a test suite. Same gate serialized; passed, including JS/Hermes output and assets.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; $env:SCHOOL_APP_RELEASE_API_ORIGIN='https://api-a.example.com'; .\gradlew.bat -g D:\SchoolManagementSystem\.gradle-user --offline :app:createBundleReleaseJsAndAssets --console=plain 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-gradle-a-retry.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw last 20 lines (or all output when shorter):

```text
transform[stderr]: (node:14752) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
transform[stderr]: (Use `node --trace-warnings ...` to show where the warning was created)
LOG:Writing bundle output to: android\app\build\generated\assets\react\release\index.android.bundle
LOG:Writing sourcemap output to: android\app\build\intermediates\sourcemaps\react\release\index.android.bundle.packager.map
LOG:Done writing bundle output
LOG:Done writing sourcemap output
Copying 19 asset files
Done copying assets

[Incubating] Problems report is available at: file:///D:/SchoolManagementSystem/android/build/reports/problems/problems-report.html

Deprecated Gradle features were used in this build, making it incompatible with Gradle 10.

You can use '--warning-mode all' to show the individual deprecation warnings and determine if they come from your own scripts or plugins.

For more on this, please refer to https://docs.gradle.org/9.3.1/userguide/command_line_interface.html#sec:command_line_warnings in the Gradle documentation.

BUILD SUCCESSFUL in 54s
11 actionable tasks: 1 executed, 10 up-to-date
Consider enabling configuration cache to speed up this build: https://docs.gradle.org/9.3.1/userguide/configuration_cache_enabling.html
```

### Command 19 — sms-api-gradle-a-final.log

Working directory: D:\SchoolManagementSystem\android

Exit: 0. Native bundle gate, not a test suite. JS/Hermes output inspected for exact synthetic origin and absent developer LAN.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; $env:SCHOOL_APP_RELEASE_API_ORIGIN='https://api-a.example.com'; .\gradlew.bat -g D:\SchoolManagementSystem\.gradle-user --offline :app:createBundleReleaseJsAndAssets --console=plain 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-gradle-a-final.log" | Select-Object -Last 20
```

Raw last 20 lines (or all output when shorter):

```text
transform[stderr]: (node:12572) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
transform[stderr]: (Use `node --trace-warnings ...` to show where the warning was created)
LOG:Writing bundle output to: android\app\build\generated\assets\react\release\index.android.bundle
LOG:Writing sourcemap output to: android\app\build\intermediates\sourcemaps\react\release\index.android.bundle.packager.map
LOG:Done writing bundle output
LOG:Done writing sourcemap output
Copying 19 asset files
Done copying assets

[Incubating] Problems report is available at: file:///D:/SchoolManagementSystem/android/build/reports/problems/problems-report.html

Deprecated Gradle features were used in this build, making it incompatible with Gradle 10.

You can use '--warning-mode all' to show the individual deprecation warnings and determine if they come from your own scripts or plugins.

For more on this, please refer to https://docs.gradle.org/9.3.1/userguide/command_line_interface.html#sec:command_line_warnings in the Gradle documentation.

BUILD SUCCESSFUL in 40s
11 actionable tasks: 1 executed, 10 up-to-date
Consider enabling configuration cache to speed up this build: https://docs.gradle.org/9.3.1/userguide/configuration_cache_enabling.html
```

### Command 20 — sms-api-gradle-b-final.log

Working directory: D:\SchoolManagementSystem\android

Exit: 0. Native bundle gate, not a test suite. JS/Hermes output inspected for exact synthetic origin and absent developer LAN.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; $env:SCHOOL_APP_RELEASE_API_ORIGIN='https://api-b.example.com'; .\gradlew.bat -g D:\SchoolManagementSystem\.gradle-user --offline :app:createBundleReleaseJsAndAssets --console=plain 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-gradle-b-final.log" | Select-Object -Last 20
```

Raw last 20 lines (or all output when shorter):

```text
transform[stderr]: (node:15940) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
transform[stderr]: (Use `node --trace-warnings ...` to show where the warning was created)
LOG:Writing bundle output to: android\app\build\generated\assets\react\release\index.android.bundle
LOG:Writing sourcemap output to: android\app\build\intermediates\sourcemaps\react\release\index.android.bundle.packager.map
LOG:Done writing bundle output
LOG:Done writing sourcemap output
Copying 19 asset files
Done copying assets

[Incubating] Problems report is available at: file:///D:/SchoolManagementSystem/android/build/reports/problems/problems-report.html

Deprecated Gradle features were used in this build, making it incompatible with Gradle 10.

You can use '--warning-mode all' to show the individual deprecation warnings and determine if they come from your own scripts or plugins.

For more on this, please refer to https://docs.gradle.org/9.3.1/userguide/command_line_interface.html#sec:command_line_warnings in the Gradle documentation.

BUILD SUCCESSFUL in 55s
11 actionable tasks: 1 executed, 10 up-to-date
Consider enabling configuration cache to speed up this build: https://docs.gradle.org/9.3.1/userguide/configuration_cache_enabling.html
```

### Command 21 — sms-api-gradle-b-repeat.log

Working directory: D:\SchoolManagementSystem\android

Exit: 0. Native bundle gate, not a test suite. Existing release bundle task UP-TO-DATE.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; $env:SCHOOL_APP_RELEASE_API_ORIGIN='https://api-b.example.com'; .\gradlew.bat -g D:\SchoolManagementSystem\.gradle-user --offline :app:createBundleReleaseJsAndAssets --console=plain 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-gradle-b-repeat.log" | Select-Object -Last 20
```

Raw last 20 lines (or all output when shorter):

```text
> Task :gradle-plugin:react-native-gradle-plugin:checkKotlinGradlePluginConfigurationErrors SKIPPED
> Task :gradle-plugin:react-native-gradle-plugin:compileKotlin UP-TO-DATE
> Task :gradle-plugin:react-native-gradle-plugin:compileJava NO-SOURCE
> Task :gradle-plugin:react-native-gradle-plugin:pluginDescriptors UP-TO-DATE
> Task :gradle-plugin:react-native-gradle-plugin:processResources UP-TO-DATE
> Task :gradle-plugin:react-native-gradle-plugin:classes UP-TO-DATE
> Task :gradle-plugin:react-native-gradle-plugin:jar UP-TO-DATE
> Task :app:createBundleReleaseJsAndAssets UP-TO-DATE

[Incubating] Problems report is available at: file:///D:/SchoolManagementSystem/android/build/reports/problems/problems-report.html

Deprecated Gradle features were used in this build, making it incompatible with Gradle 10.

You can use '--warning-mode all' to show the individual deprecation warnings and determine if they come from your own scripts or plugins.

For more on this, please refer to https://docs.gradle.org/9.3.1/userguide/command_line_interface.html#sec:command_line_warnings in the Gradle documentation.

BUILD SUCCESSFUL in 6s
11 actionable tasks: 11 up-to-date
Consider enabling configuration cache to speed up this build: https://docs.gradle.org/9.3.1/userguide/configuration_cache_enabling.html
```

### Command 22 — sms-api-gradle-missing.log

Working directory: D:\SchoolManagementSystem\android

Exit: 1. Native bundle gate, not a test suite. Expected configuration rejection; task reran.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; $env:SCHOOL_APP_RELEASE_API_ORIGIN=''; .\gradlew.bat -g D:\SchoolManagementSystem\.gradle-user --offline :app:createBundleReleaseJsAndAssets --console=plain 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-gradle-missing.log" | Select-Object -Last 20
```

Raw last 20 lines (or all output when shorter):

```text
FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':app:createBundleReleaseJsAndAssets'.
> Process 'command 'cmd'' finished with non-zero exit value 1

* Try:
> Run with --stacktrace option to get the stack trace.
> Run with --info or --debug option to get more log output.
> Run with --scan to get full insights from a Build Scan (powered by Develocity).
> Get more help at https://help.gradle.org.

Deprecated Gradle features were used in this build, making it incompatible with Gradle 10.

You can use '--warning-mode all' to show the individual deprecation warnings and determine if they come from your own scripts or plugins.

For more on this, please refer to https://docs.gradle.org/9.3.1/userguide/command_line_interface.html#sec:command_line_warnings in the Gradle documentation.

BUILD FAILED in 15s
11 actionable tasks: 1 executed, 10 up-to-date
```

### Command 23 — sms-api-bundle-android-a-final.log

Working directory: D:\SchoolManagementSystem

Exit: 0. Actual release-mode Metro bundle gate, not a test suite. Synthetic endpoint only; output content and hashes checked by matrix command.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; $env:NODE_ENV='development'; $env:BABEL_ENV='development'; $env:SCHOOL_APP_RELEASE_API_ORIGIN='https://api-a.example.com'; node node_modules/react-native/cli.js bundle --platform android --dev false --entry-file index.js --bundle-output "$env:TEMP\sms-api-android-a-final.jsbundle" --max-workers 2 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-bundle-android-a-final.log" | Select-Object -Last 20
```

Raw last 20 lines (or all output when shorter):

```text
                 ▓▓░░▓▓▒░░░▒▒░░░▒▓▒░░▓▓
                 ▓▓░░▓▓▓▓▓▒▒▒▒▓▓▓▓▒░░▓▓
                 ▓▓░░▓▓▓▓▓▓▓▓▓▓▓▓▓▒░░▓▓
                 ▓▓▒░░▒▒▓▓▓▓▓▓▓▓▒░░░▒▓▓
                  ▒▓▓▓▒░░░▒▓▓▒░░░▒▓▓▓▒
                     ▒▓▓▓▒░░░░▒▓▓▓▒
                        ▒▒▓▓▓▓▒▒


                Welcome to Metro v0.84.4
              Fast - Scalable - Integrated


transform[stderr]: (node:7232) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
transform[stderr]: (Use `node --trace-warnings ...` to show where the warning was created)
transform[stderr]: (node:3376) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
transform[stderr]: (Use `node --trace-warnings ...` to show where the warning was created)
LOG:Writing bundle output to: C:\Users\LAPTOP~1\AppData\Local\Temp\sms-api-android-a-final.jsbundle
LOG:Done writing bundle output
Warning: Assets destination folder is not set, skipping...
```

### Command 24 — sms-api-bundle-android-b-final.log

Working directory: D:\SchoolManagementSystem

Exit: 0. Actual release-mode Metro bundle gate, not a test suite. Synthetic endpoint only; output content and hashes checked by matrix command.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; $env:NODE_ENV='development'; $env:BABEL_ENV='development'; $env:SCHOOL_APP_RELEASE_API_ORIGIN='https://api-b.example.com'; node node_modules/react-native/cli.js bundle --platform android --dev false --entry-file index.js --bundle-output "$env:TEMP\sms-api-android-b-final.jsbundle" --max-workers 2 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-bundle-android-b-final.log" | Select-Object -Last 20
```

Raw last 20 lines (or all output when shorter):

```text
                 ▓▓░░▓▓▒░░░▒▒░░░▒▓▒░░▓▓
                 ▓▓░░▓▓▓▓▓▒▒▒▒▓▓▓▓▒░░▓▓
                 ▓▓░░▓▓▓▓▓▓▓▓▓▓▓▓▓▒░░▓▓
                 ▓▓▒░░▒▒▓▓▓▓▓▓▓▓▒░░░▒▓▓
                  ▒▓▓▓▒░░░▒▓▓▒░░░▒▓▓▓▒
                     ▒▓▓▓▒░░░░▒▓▓▓▒
                        ▒▒▓▓▓▓▒▒


                Welcome to Metro v0.84.4
              Fast - Scalable - Integrated


transform[stderr]: (node:12092) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
transform[stderr]: (Use `node --trace-warnings ...` to show where the warning was created)
transform[stderr]: (node:18748) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
transform[stderr]: (Use `node --trace-warnings ...` to show where the warning was created)
LOG:Writing bundle output to: C:\Users\LAPTOP~1\AppData\Local\Temp\sms-api-android-b-final.jsbundle
LOG:Done writing bundle output
Warning: Assets destination folder is not set, skipping...
```

### Command 25 — sms-api-bundle-android-b-repeat.log

Working directory: D:\SchoolManagementSystem

Exit: 0. Actual release-mode Metro bundle gate, not a test suite. Synthetic endpoint only; output content and hashes checked by matrix command.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; $env:NODE_ENV='development'; $env:BABEL_ENV='development'; $env:SCHOOL_APP_RELEASE_API_ORIGIN='https://api-b.example.com'; node node_modules/react-native/cli.js bundle --platform android --dev false --entry-file index.js --bundle-output "$env:TEMP\sms-api-android-b-repeat.jsbundle" --max-workers 2 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-bundle-android-b-repeat.log" | Select-Object -Last 20
```

Raw last 20 lines (or all output when shorter):

```text
                     ▒▓▓▓▒▒░░▒▒▓▓▓▒
                  ▒▓▓▓▓░░░▒▒▒▒░░░▓▓▓▓▒
                 ▓▓▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▓▓
                 ▓▓░░░░░▒▓▓▓▓▓▓▒░░░░░▓▓
                 ▓▓░░▓▓▒░░░▒▒░░░▒▓▒░░▓▓
                 ▓▓░░▓▓▓▓▓▒▒▒▒▓▓▓▓▒░░▓▓
                 ▓▓░░▓▓▓▓▓▓▓▓▓▓▓▓▓▒░░▓▓
                 ▓▓▒░░▒▒▓▓▓▓▓▓▓▓▒░░░▒▓▓
                  ▒▓▓▓▒░░░▒▓▓▒░░░▒▓▓▓▒
                     ▒▓▓▓▒░░░░▒▓▓▓▒
                        ▒▒▓▓▓▓▒▒


                Welcome to Metro v0.84.4
              Fast - Scalable - Integrated


LOG:Writing bundle output to: C:\Users\LAPTOP~1\AppData\Local\Temp\sms-api-android-b-repeat.jsbundle
LOG:Done writing bundle output
Warning: Assets destination folder is not set, skipping...
```

### Command 26 — sms-api-bundle-ios-b-final.log

Working directory: D:\SchoolManagementSystem

Exit: 0. Actual release-mode Metro bundle gate, not a test suite. Synthetic endpoint only; output content and hashes checked by matrix command.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; $env:NODE_ENV='development'; $env:BABEL_ENV='development'; $env:SCHOOL_APP_RELEASE_API_ORIGIN='https://api-b.example.com'; node node_modules/react-native/cli.js bundle --platform ios --dev false --entry-file index.js --bundle-output "$env:TEMP\sms-api-ios-b-final.jsbundle" --max-workers 2 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-bundle-ios-b-final.log" | Select-Object -Last 20
```

Raw last 20 lines (or all output when shorter):

```text
                 ▓▓░░▓▓▒░░░▒▒░░░▒▓▒░░▓▓
                 ▓▓░░▓▓▓▓▓▒▒▒▒▓▓▓▓▒░░▓▓
                 ▓▓░░▓▓▓▓▓▓▓▓▓▓▓▓▓▒░░▓▓
                 ▓▓▒░░▒▒▓▓▓▓▓▓▓▓▒░░░▒▓▓
                  ▒▓▓▓▒░░░▒▓▓▒░░░▒▓▓▓▒
                     ▒▓▓▓▒░░░░▒▓▓▓▒
                        ▒▒▓▓▓▓▒▒


                Welcome to Metro v0.84.4
              Fast - Scalable - Integrated


transform[stderr]: (node:3748) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
transform[stderr]: (Use `node --trace-warnings ...` to show where the warning was created)
transform[stderr]: (node:12312) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
transform[stderr]: (Use `node --trace-warnings ...` to show where the warning was created)
LOG:Writing bundle output to: C:\Users\LAPTOP~1\AppData\Local\Temp\sms-api-ios-b-final.jsbundle
LOG:Done writing bundle output
Warning: Assets destination folder is not set, skipping...
```

### Command 27 — sms-api-bundle-warm-missing.log

Working directory: D:\SchoolManagementSystem

Exit: 1. Actual release-mode Metro bundle gate, not a test suite. Expected configuration rejection.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; $env:NODE_ENV='development'; $env:BABEL_ENV='development'; $env:SCHOOL_APP_RELEASE_API_ORIGIN=''; node node_modules/react-native/cli.js bundle --platform android --dev false --entry-file index.js --bundle-output "$env:TEMP\sms-api-warm-missing.jsbundle" --max-workers 2 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-bundle-warm-missing.log" | Select-Object -Last 20
```

Raw last 20 lines (or all output when shorter):

```text
                     ▒▓▓▓▒░░░░▒▓▓▓▒
                        ▒▒▓▓▓▓▒▒


                Welcome to Metro v0.84.4
              Fast - Scalable - Integrated


error Invalid or missing SCHOOL_APP_RELEASE_API_ORIGIN: expected an HTTPS public DNS origin without credentials, path, query or fragment.
ApiConfigurationError: Invalid or missing SCHOOL_APP_RELEASE_API_ORIGIN: expected an HTTPS public DNS origin without credentials, path, query or fragment.
    at configurationError (D:\SchoolManagementSystem\config\api-origin-policy.js:8:17)
    at fail (D:\SchoolManagementSystem\config\api-origin-policy.js:50:22)
    at validateApiOrigin (D:\SchoolManagementSystem\config\api-origin-policy.js:52:11)
    at Object.getTransformOptions (D:\SchoolManagementSystem\metro.config.js:25:7)
    at calcTransformerOptions (D:\SchoolManagementSystem\node_modules\metro\src\lib\transformHelpers.js:77:50)
    at Object.getTransformFn (D:\SchoolManagementSystem\node_modules\metro\src\lib\transformHelpers.js:113:57)
    at IncrementalBundler.buildGraphForEntries (D:\SchoolManagementSystem\node_modules\metro\src\IncrementalBundler.js:100:41)
    at async IncrementalBundler.buildGraph (D:\SchoolManagementSystem\node_modules\metro\src\IncrementalBundler.js:178:19)
    at async Server.build (D:\SchoolManagementSystem\node_modules\metro\src\Server.js:241:32)
    at async runBuild (D:\SchoolManagementSystem\node_modules\metro\src\index.flow.js:355:25)
```

### Command 28 — sms-api-bundle-http.log

Working directory: D:\SchoolManagementSystem

Exit: 1. Actual release-mode Metro bundle gate, not a test suite. Expected configuration rejection.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN='http://192.168.137.1:5000'; $env:NODE_ENV='development'; $env:BABEL_ENV='development'; $env:SCHOOL_APP_RELEASE_API_ORIGIN='http://api-b.example.com'; node node_modules/react-native/cli.js bundle --platform android --dev false --entry-file index.js --bundle-output "$env:TEMP\sms-api-http.jsbundle" --max-workers 2 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-bundle-http.log" | Select-Object -Last 20
```

Raw last 20 lines (or all output when shorter):

```text
                     ▒▓▓▓▒░░░░▒▓▓▓▒
                        ▒▒▓▓▓▓▒▒


                Welcome to Metro v0.84.4
              Fast - Scalable - Integrated


error Invalid or missing SCHOOL_APP_RELEASE_API_ORIGIN: expected an HTTPS public DNS origin without credentials, path, query or fragment.
ApiConfigurationError: Invalid or missing SCHOOL_APP_RELEASE_API_ORIGIN: expected an HTTPS public DNS origin without credentials, path, query or fragment.
    at configurationError (D:\SchoolManagementSystem\config\api-origin-policy.js:8:17)
    at fail (D:\SchoolManagementSystem\config\api-origin-policy.js:50:22)
    at validateApiOrigin (D:\SchoolManagementSystem\config\api-origin-policy.js:100:13)
    at Object.getTransformOptions (D:\SchoolManagementSystem\metro.config.js:25:7)
    at calcTransformerOptions (D:\SchoolManagementSystem\node_modules\metro\src\lib\transformHelpers.js:77:50)
    at Object.getTransformFn (D:\SchoolManagementSystem\node_modules\metro\src\lib\transformHelpers.js:113:57)
    at IncrementalBundler.buildGraphForEntries (D:\SchoolManagementSystem\node_modules\metro\src\IncrementalBundler.js:100:41)
    at async IncrementalBundler.buildGraph (D:\SchoolManagementSystem\node_modules\metro\src\IncrementalBundler.js:178:19)
    at async Server.build (D:\SchoolManagementSystem\node_modules\metro\src\Server.js:241:32)
    at async runBuild (D:\SchoolManagementSystem\node_modules\metro\src\index.flow.js:355:25)
```

### Initial artifact content/hash verification

Working directory: D:\SchoolManagementSystem. Exit 0. Not a test suite. The final matrix above independently repeats the final-source checks.

```powershell
$taskScript = @'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const dir=process.env.TEMP;
const a=fs.readFileSync(path.join(dir,'sms-api-android-a.jsbundle'),'utf8');
const b=fs.readFileSync(path.join(dir,'sms-api-android-b.jsbundle'),'utf8');
const ios=fs.readFileSync(path.join(dir,'sms-api-ios-b.jsbundle'),'utf8');
assert(a.includes('https://api-a.example.com')); assert(!a.includes('https://api-b.example.com'));
for(const [name,value] of [['android-b',b],['ios-b',ios]]) {assert(value.includes('https://api-b.example.com'));assert(!value.includes('https://api-a.example.com'));assert(!value.includes('192.168.137.1'));assert(!value.includes('__SCHOOL_APP_RELEASE_API_ORIGIN__'));console.log(name+': synthetic B present; A/developer LAN/unreplaced marker absent');}
assert(!a.includes('192.168.137.1'));assert.notEqual(a,b);
console.log('android-a SHA256='+crypto.createHash('sha256').update(a).digest('hex'));
console.log('android-b SHA256='+crypto.createHash('sha256').update(b).digest('hex'));
console.log('Bundle checks: PASS (synthetic endpoints; no network connectivity claimed)');
'@
node -e $taskScript 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-bundle-content.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output:

```text
android-b: synthetic B present; A/developer LAN/unreplaced marker absent
ios-b: synthetic B present; A/developer LAN/unreplaced marker absent
android-a SHA256=53a6db9f949131723d3559f3d0c7efad76897106175c78eb7a51fc11792b87c8
android-b SHA256=1aed22a85bf91c87049c99d04c7ed5e749ec8a6d3f09b51e1641788bf89b1757
Bundle checks: PASS (synthetic endpoints; no network connectivity claimed)
```

### Git diff check

Working directory: D:\SchoolManagementSystem. Exit 0. Not a test suite.

```powershell
git diff --check 2>&1 | Tee-Object -FilePath "$env:TEMP\sms-api-origin-diff-check.log" | Select-Object -Last 20; exit $LASTEXITCODE
```

Raw output:

```text
warning: in the working copy of 'android/app/build.gradle', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'babel.config.js', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'metro.config.js', LF will be replaced by CRLF the next time Git touches it
```

### Explicit whitespace validation, including untracked files

Working directory: D:\SchoolManagementSystem. Exit 0. Not a test suite.

```powershell
$taskAllowed=@('config/api-origin-policy.js','scripts/babel-plugin-api-origins.js','src/services/api/apiConfig.ts','__tests__/api-origin-policy.test.ts','__tests__/api-origin-build.test.ts','__tests__/api-client.test.ts','docs/integration/pr-f-aud02-api-transport.md','babel.config.js','metro.config.js','src/services/api/apiClient.ts','android/app/build.gradle'); foreach($taskPath in $taskAllowed){$taskContent=Get-Content -LiteralPath $taskPath; if($taskContent -match '[ \t]+$'){throw ('Trailing whitespace: '+$taskPath)}}; Write-Output 'PASS: explicit whitespace check over all 11 approved files, including untracked report/source/tests.'
```

Raw output:

```text
PASS: explicit whitespace check over all 11 approved files, including untracked report/source/tests.
```

## Final approved file inventory

- config/api-origin-policy.js
- scripts/babel-plugin-api-origins.js
- src/services/api/apiConfig.ts
- __tests__/api-origin-policy.test.ts
- __tests__/api-origin-build.test.ts
- __tests__/api-client.test.ts
- docs/integration/pr-f-aud02-api-transport.md
- babel.config.js
- metro.config.js
- src/services/api/apiClient.ts
- android/app/build.gradle

Final report scope: 11 files, all unstaged, empty index. No intended changes outside this list. Configuration implementation and the available synthetic bundle/build gates are verified. Real production connectivity, Android release-device/full signed package and native iOS build/device checks remain unverified.

DONE — F-AUD-02 API configuration implemented and verified against the available bundle/build gates; production connectivity remains unverified.
