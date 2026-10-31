# Phase C: Student canonical read workspace

## Endpoint/data-source map (inspection before implementation)

| Slice | Existing canonical authority | Existing Student read | Integration decision |
| --- | --- | --- | --- |
| Identity | authenticated persisted User → Student.userId | No self-profile route; StudentNavigator has only live lessons | Add GET /api/student/me |
| Placement | StudentEnrollment active, effectiveFrom/effectiveTo; AcademicPeriod, SchoolClass, Section, Branch | Administrative /api/students routes, not Student self-service | Add GET /api/student/me/enrollment; no legacy profile placement fallback |
| Timetable | operationalTimetableVersions, TimetablePeriod, SubstituteAssignment, effectiveTimetableOccurrence | Teacher and Principal reads only | Add GET /api/student/me/timetable?date=YYYY-MM-DD derived from enrollment |
| Physical attendance | AttendanceSession, PeriodAttendanceRecord, effectiveAttendanceStages | Teacher/Principal reads; legacy daily Attendance is not the period authority | Add GET /api/student/me/attendance?date=YYYY-MM-DD, separate from participation/completion |
| Homework/quiz | AcademicWorkAudience, published Homework/Quiz, academic-work.service | /api/student/academic-work and detail routes | Reuse canonical safe DTO readers behind stricter current-enrollment and own-student entitlement checks |
| Results | AcademicResult, academic-result.service publication/revision policy | /api/student/results and detail | Reuse canonical published-result readers behind strict self-scope gate |
| Fees | Fee and branch-level getBranchFeeSummary | No canonical Student ledger/challan/payment-summary API | NOT INTEGRATED — awaiting canonical Finance phase |

Canonical models have no separate School entity/schoolId. School isolation is the existing single-school deployment/database boundary; persisted active Branch and complete enrollment reference validation are the within-deployment authority. Do not invent a new tenant model. Cross-school identifiers supplied by clients are rejected, not used to select scope.

## Donor reference decisions

Inspected faraz-audit StudentDashboard.jsx, StudentFeesPage.jsx, studentService.js, studentDashboardUtils.js, previewData.js and HiraHome.jsx directly through Git. ADAPT NOW: profile/enrollment summary, pane selection, timetable/physical attendance cards, assigned homework/quiz read cards, published result cards and honest load/error/empty states using canonical Hira UI. DUPLICATE: donor cards/hero/theme/buttons (use Phase B components). LATER: submissions, quiz attempts, applications, progress, transport, resources and other feature APIs. REJECT: donor authService/authSession/sessionStorage/apiConfig, server runtime, identity contracts, profile class placement, legacy timetable/attendance/results, fees/payment calculations and preview-data fallbacks.

Production reads must never accept a Student/class/section/branch/school selection. JWT/session middleware and persisted User are retained. Missing/inconsistent current enrollment fails closed; history is never modified. Existing canonical academic write APIs are not exposed by this read workspace. Fees display the explicit blocker rather than fictional amounts.
