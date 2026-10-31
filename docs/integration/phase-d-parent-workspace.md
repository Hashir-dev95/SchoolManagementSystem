# Phase D: verified-child Parent read workspace

## Authority map recorded before implementation

| Domain | Canonical source inspected | Phase D decision |
| --- | --- | --- |
| Parent identity | User roles currently SA/Principal/Teacher/Student; AuthProvider/JWT/session are canonical | Add Parent to canonical role vocabulary, no second identity/session store |
| Parent-child link | No link model/API exists; Student.guardianName/guardianPhone are contact fields only | Add ONE ParentStudentLink model with explicit verification/activity and creation/approval metadata; never derive access from contacts or donor child lists |
| Student identity/placement | Student.userId; strict Phase C StudentEnrollment/Branch/Class/Section/AcademicPeriod resolution | Reuse strict resolution after proving Parent-child link |
| Timetable/physical attendance | Phase C occurrence reader plus operational timetable, substitution and effective attendance services | Share trusted-context read functions; never forge a Student JWT or change Parent role |
| Academic work | Canonical AcademicWorkAudience and published Homework/Quiz DTO readers | Reuse safe recipient projection after strict linked-child scope; metadata only, no submissions/answers |
| Results | AcademicResult canonical publication/revision/recipient/membership predicate and safe DTO | Reuse predicate/DTO with verified child; require explicit matching publication revision for Parent |
| Fees | Only branch-level fee summary, no canonical child ledger/payment contract | Fees integration pending canonical Finance phase |
| Production navigation | No Parent navigator/screens/services; Student/staff navigators already owned canonically | Add minimal Parent navigator and root role case, retaining one AuthProvider/NavigationContainer |

This is the existing single-school deployment/database model; Branch is the within-deployment scope. No School entity/tenant architecture is invented. Parent and linked child must share a valid persisted Branch, and the relationship and enrollment must agree with it.

Parent account/link provisioning UI is outside the read MVP. Trusted administration must provision canonical Parent Users and explicitly verified relationship records with approval metadata. There is no public role selection, self-link, automatic email/phone matching or client-supplied verification. The existing registration contract remains Student-only.

## Donor reference decisions

Inspected `faraz-audit:src/mobileApp/roles/parent/` including ParentDashboard, ParentChildrenPage, ParentWorkspaceUI, parentService and the secondary page inventory, plus shared previewData and HiraHome. ADAPT NOW: verified-child chooser, visible Branch/Class/Section context, child profile/enrollment, daily timetable/physical attendance, published assigned-work/results panes. DUPLICATE: donor cards/buttons/hero/theme, replaced by canonical Hira primitives. LATER: applications, chat, transport, resources, documents and payment execution. REJECT: donor authService/authSession/sessionStorage/apiConfig, AppNavigator/server runtime, contact/profile placement authority, stored unverified child lists, legacy timetable/attendance/results and donor balance/payment calculations. Production never imports preview data; Phase A Parent preview remains unchanged.
