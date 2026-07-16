# CLAUDE.md — AI HR Payroll System
## Selfie Attendance · GPS Geofencing · Shift Monitor · WhatsApp API
### Android App + Master Control Web App

---

## 🧭 Project Overview

Build a **dual-platform AI-powered HR & Payroll System** consisting of:

1. **Android App** — Employee-facing: selfie attendance, GPS check-in/out, shift view, leave requests, WhatsApp notifications
2. **Master Control Web App** — Admin-facing: real-time dashboard, geofence management, payroll engine, shift scheduling, employee management, WhatsApp automation

**Business Context:** Designed for multi-branch operations (e.g., dealership groups, retail chains) where field employees need mobile-first attendance and HR managers need centralized oversight.

---

## 🗂️ Repository Structure

```
ai-hr-payroll/
├── CLAUDE.md                    ← You are here
├── android/                     ← Android App (Kotlin + Jetpack Compose)
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── java/com/hrpayroll/
│   │   │   │   ├── ui/              # Compose screens
│   │   │   │   ├── data/            # Repositories, Room DB, API
│   │   │   │   ├── domain/          # Use cases, models
│   │   │   │   ├── service/         # Background services (GPS, shift monitor)
│   │   │   │   └── utils/           # Selfie capture, face detection helpers
│   │   │   └── res/
│   │   └── build.gradle.kts
│   └── gradle/
├── web/                         ← Master Control Web App (Next.js 14 + TypeScript)
│   ├── src/
│   │   ├── app/                 # App Router pages
│   │   ├── components/          # UI components
│   │   ├── lib/                 # Utilities, API clients
│   │   └── types/               # TypeScript types
│   ├── package.json
│   └── next.config.ts
├── backend/                     ← API Server (Node.js + Express / Fastify)
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   │   ├── attendance/
│   │   │   ├── geofence/
│   │   │   ├── payroll/
│   │   │   ├── whatsapp/
│   │   │   └── ai/
│   │   ├── models/              # Prisma schema
│   │   └── middleware/
│   ├── prisma/
│   │   └── schema.prisma
│   └── package.json
├── shared/                      ← Shared TypeScript types (web + backend)
│   └── types/
├── docs/
│   ├── api.md
│   ├── geofence-logic.md
│   ├── whatsapp-flows.md
│   └── payroll-engine.md
├── docker-compose.yml
└── .env.example
```

---

## 🛠️ Tech Stack

### Android App
| Layer | Technology |
|---|---|
| Language | Kotlin |
| UI | Jetpack Compose + Material 3 |
| Architecture | MVVM + Clean Architecture |
| Navigation | Navigation Compose |
| DI | Hilt |
| Network | Retrofit + OkHttp |
| Local DB | Room |
| Camera | CameraX |
| Face Detection | ML Kit Face Detection |
| Maps/GPS | Google Maps SDK + FusedLocationProvider |
| Background | WorkManager + ForegroundService |
| Auth | JWT + Biometric API |
| Push | Firebase Cloud Messaging (FCM) |
| State | StateFlow + Compose State |

### Master Control Web App
| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| UI | shadcn/ui + Tailwind CSS |
| Maps | React Leaflet / Google Maps JS API |
| Charts | Recharts |
| Auth | NextAuth.js / JWT |
| State | Zustand |
| Forms | React Hook Form + Zod |
| Table | TanStack Table v8 |
| Real-time | Socket.io client |

### Backend API
| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Framework | Fastify (or Express) |
| Language | TypeScript |
| ORM | Prisma |
| Database | PostgreSQL |
| Cache | Redis |
| File Storage | Cloudinary (selfie photos) |
| Real-time | Socket.io |
| Queue | BullMQ (WhatsApp jobs, payroll) |
| WhatsApp | WhatsApp Business API (via Meta / Twilio / WATI) |
| Face Match | AWS Rekognition or Azure Face API |
| Auth | JWT + bcrypt |
| Deployment | Docker + nginx |

---

## 📱 Android App — Feature Specification

### 1. Authentication
- Phone number + OTP login
- PIN / Biometric (fingerprint/face unlock) for subsequent logins
- JWT token stored in EncryptedSharedPreferences
- Auto-logout on token expiry

### 2. Selfie Attendance (Check-In / Check-Out)

**Flow:**
```
Open App → GPS Check (within geofence?) → Front Camera Preview
→ Liveness Detection (blink/smile prompt) → ML Kit Face Detection
→ Capture Selfie → Upload to Backend → Face Match (Rekognition)
→ Mark Attendance → WhatsApp Notification sent to employee
```

**Rules:**
- Only allowed within geofence radius (configurable per branch)
- Must detect exactly 1 face (no group selfies)
- Liveness check: random prompt (blink / turn left / smile)
- Photo metadata: GPS coordinates, device ID, timestamp
- Offline queue: if no internet, store locally and sync when connected (WorkManager)
- Duplicate check: cannot check-in twice without check-out

### 3. GPS & Geofencing (Employee Side)
- Continuous GPS tracking during shift (ForegroundService)
- Show employee's live location relative to branch on map
- Alert if employee leaves geofence during shift
- GPS track log saved every 5 minutes (configurable)
- Battery-efficient: use significant location changes, not raw GPS

### 4. Shift Monitor (Employee View)
- Today's shift details: start time, end time, type (Morning/Evening/Night)
- Live timer: hours worked so far
- Break tracker: mark break start/end
- Shift history (last 30 days)
- Upcoming shift schedule (7 days)
- Overtime indicator

### 5. Leave Management
- Apply leave (types: CL, SL, EL, LOP, Half Day)
- Upload supporting document (medical certificate etc.)
- Leave balance display
- Approval status tracking (Pending / Approved / Rejected)
- WhatsApp notification on approval/rejection
- Leave calendar view

### 6. WhatsApp Notifications (Received by Employee)
- Check-in confirmation with time + location
- Check-out confirmation with total hours worked
- Leave approval/rejection
- Shift change alert
- Salary slip notification
- Late arrival alert
- Geofence violation warning

### 7. Payroll / Salary
- View monthly payslip
- Attendance summary (present/absent/leave/LOP days)
- Deduction breakdown (PF, ESI, TDS)
- Salary credited confirmation

### 8. Profile
- Personal info view
- Documents (ID proof, offer letter)
- Emergency contact
- Bank details (masked)

---

## 🖥️ Master Control Web App — Feature Specification

### 1. Dashboard (Home)
**Real-time overview cards:**
- Total employees present now
- Total absent
- Late arrivals today
- On leave today
- Live map: employee locations (dots on branch map)
- Attendance trend chart (7 days)
- Branch-wise attendance heatmap
- Pending leave approvals count
- Payroll processing status

### 2. Live Attendance Monitor
- Real-time feed: "Ravi checked in at 09:02 AM — Bhavani Branch"
- Table: Employee | Branch | Check-In | Check-Out | Status | GPS | Selfie thumbnail
- Filter by: Branch / Department / Shift / Date range
- Export: CSV / Excel
- Flag suspicious entries (GPS mismatch, face mismatch score)
- Click row → expand: selfie photo, GPS map, device info

### 3. Geofence Management
- Map interface (Google Maps / Leaflet)
- Draw geofence polygon or circle per branch
- Configurable radius (default 100m)
- Multiple branches on one map
- Strict mode (block attendance outside) vs. Soft mode (allow but flag)
- View geofence violation logs

### 4. Employee Management
- CRUD: Add / Edit / Deactivate employees
- Upload employee selfie for face enrollment (face template stored)
- Assign: Branch / Department / Shift / Role
- Bulk import via Excel
- Employee card: photo, designation, department, today's status
- Search + Filter

### 5. Shift Management
- Define shift types: Morning (06:00–14:00), General (09:00–18:00), Evening (14:00–22:00), Night (22:00–06:00)
- Assign shifts to employees (individual or bulk)
- Shift rotation scheduler (weekly/bi-weekly)
- Holiday calendar management
- Shift swap requests (employee-initiated, admin-approved)
- Grace period configuration (late tolerance in minutes)

### 6. Leave Management (Admin)
- Pending approvals inbox
- Approve / Reject with remarks
- Leave balance management (credit CL, SL, EL at month start)
- Leave policy configuration
- Leave calendar view (all employees)
- LOP auto-calculation

### 7. Payroll Engine
**Monthly payroll processing:**
```
Attendance Data → Working Days → Leave Deductions → LOP Days
→ Basic Salary Calc → Allowances (HRA, DA, TA) 
→ Deductions (PF, ESI, PT, TDS, Advances)
→ Net Salary → Payslip Generation → WhatsApp/Email dispatch
```
- Salary structure templates (configurable per designation)
- Bulk payroll run (one click for entire company)
- Payslip PDF generation and auto-send via WhatsApp
- Statutory reports: PF ECR, ESI, PT challan
- Bank transfer file export (NEFT/RTGS format)
- Advance salary management
- Salary revision history

### 8. WhatsApp Automation Center
- Compose and send messages to individual employee / group / all
- Template management (approved Meta templates)
- Automated triggers configuration:
  - On check-in → send confirmation
  - On check-out → send summary
  - Absent alert at X:XX AM
  - Leave status change
  - Salary slip on payroll run
  - Birthday / work anniversary greetings
  - Shift change notification
- Message logs: sent / delivered / read status
- Broadcast lists management
- Two-way: employee can reply LEAVE to mark leave, IN / OUT for attendance (webhook handler)

### 9. Reports & Analytics
- Attendance report (daily, monthly, custom range)
- Late arrivals report
- Overtime report
- Leave utilization report
- Geofence violation report
- Payroll summary report
- Employee turnover report
- Export: PDF, Excel, CSV

### 10. Settings & Configuration
- Company profile (name, logo, address, GST)
- Branch management (add/edit branches + assign geofence)
- Department & designation master
- Role-based access control (Super Admin / HR Manager / Branch Manager / Payroll Admin)
- WhatsApp API credentials configuration
- Face matching threshold configuration
- Notification preferences
- Audit log (who did what and when)

---

## 🗃️ Database Schema (Prisma — Key Models)

```prisma
model Employee {
  id              String    @id @default(cuid())
  employeeCode    String    @unique
  name            String
  phone           String    @unique
  email           String?
  branchId        String
  departmentId    String
  designationId   String
  shiftId         String
  faceTemplateUrl String?   // Stored face enrollment image
  faceTemplateId  String?   // Rekognition face ID
  status          EmployeeStatus @default(ACTIVE)
  joiningDate     DateTime
  salary          Float
  branch          Branch    @relation(fields: [branchId], references: [id])
  attendances     Attendance[]
  leaves          Leave[]
  payslips        Payslip[]
  createdAt       DateTime  @default(now())
}

model Attendance {
  id              String    @id @default(cuid())
  employeeId      String
  date            DateTime  @db.Date
  checkIn         DateTime?
  checkOut        DateTime?
  checkInSelfie   String?   // Cloudinary URL
  checkOutSelfie  String?
  checkInLat      Float?
  checkInLng      Float?
  checkOutLat     Float?
  checkOutLng     Float?
  checkInDevice   String?
  geofenceStatus  GeofenceStatus @default(INSIDE)
  faceMatchScore  Float?    // 0-100
  status          AttendanceStatus @default(PRESENT)
  workingMinutes  Int?
  employee        Employee  @relation(fields: [employeeId], references: [id])
  gpsLogs         GPSLog[]
}

model GPSLog {
  id            String    @id @default(cuid())
  attendanceId  String
  lat           Float
  lng           Float
  accuracy      Float?
  timestamp     DateTime
  attendance    Attendance @relation(fields: [attendanceId], references: [id])
}

model Branch {
  id            String    @id @default(cuid())
  name          String
  address       String
  geofenceLat   Float
  geofenceLng   Float
  geofenceRadius Float    @default(100)  // meters
  geofencePolygon Json?   // For polygon geofence
  employees     Employee[]
}

model Shift {
  id            String    @id @default(cuid())
  name          String    // "Morning Shift"
  startTime     String    // "09:00"
  endTime       String    // "18:00"
  gracePeriod   Int       @default(15)  // minutes
  isNightShift  Boolean   @default(false)
  employees     Employee[]
}

model Leave {
  id            String    @id @default(cuid())
  employeeId    String
  type          LeaveType
  fromDate      DateTime  @db.Date
  toDate        DateTime  @db.Date
  days          Float
  reason        String
  documentUrl   String?
  status        LeaveStatus @default(PENDING)
  approvedBy    String?
  approverNote  String?
  employee      Employee  @relation(fields: [employeeId], references: [id])
  createdAt     DateTime  @default(now())
}

model Payslip {
  id              String    @id @default(cuid())
  employeeId      String
  month           Int
  year            Int
  presentDays     Int
  absentDays      Int
  lopDays         Float
  basicSalary     Float
  hra             Float
  da              Float
  otherAllowances Float
  grossSalary     Float
  pfDeduction     Float
  esiDeduction    Float
  ptDeduction     Float
  tdsDeduction    Float
  otherDeductions Float
  netSalary       Float
  pdfUrl          String?
  status          PayslipStatus @default(DRAFT)
  employee        Employee  @relation(fields: [employeeId], references: [id])
  createdAt       DateTime  @default(now())
}

model WhatsAppLog {
  id            String    @id @default(cuid())
  employeeId    String?
  phone         String
  templateName  String
  message       String
  status        WAStatus  @default(QUEUED)
  messageId     String?   // Meta's message ID
  sentAt        DateTime?
  deliveredAt   DateTime?
  readAt        DateTime?
  trigger       String    // "CHECK_IN" | "PAYSLIP" | "LEAVE_APPROVED" etc.
}
```

---

## 🔌 API Endpoints (Backend)

### Auth
```
POST   /api/auth/send-otp
POST   /api/auth/verify-otp
POST   /api/auth/refresh-token
POST   /api/auth/admin/login
```

### Attendance
```
POST   /api/attendance/checkin          # Upload selfie + GPS → AI face match → mark
POST   /api/attendance/checkout         # Upload selfie + GPS → mark checkout
GET    /api/attendance/today            # Employee's today status
GET    /api/attendance/history          # Employee's history
GET    /api/admin/attendance/live       # Real-time all employees (SSE/WebSocket)
GET    /api/admin/attendance/report     # Filtered report
PATCH  /api/admin/attendance/:id/override  # Manual correction
```

### Geofence
```
GET    /api/geofence/check?lat=&lng=&branchId=   # Is point inside geofence?
GET    /api/admin/geofence                        # All branch geofences
PUT    /api/admin/geofence/:branchId              # Update geofence config
GET    /api/admin/geofence/violations             # Violation logs
```

### Employees
```
GET    /api/admin/employees
POST   /api/admin/employees
GET    /api/admin/employees/:id
PUT    /api/admin/employees/:id
DELETE /api/admin/employees/:id
POST   /api/admin/employees/:id/enroll-face    # Upload face template
POST   /api/admin/employees/bulk-import        # Excel upload
```

### Leaves
```
POST   /api/leaves/apply
GET    /api/leaves/my-leaves
GET    /api/leaves/balance
GET    /api/admin/leaves/pending
PATCH  /api/admin/leaves/:id/approve
PATCH  /api/admin/leaves/:id/reject
```

### Shifts
```
GET    /api/shifts
POST   /api/admin/shifts
PUT    /api/admin/shifts/:id
POST   /api/admin/shifts/assign            # Assign shift to employee(s)
GET    /api/shifts/my-schedule             # Employee's schedule (7 days)
```

### Payroll
```
POST   /api/admin/payroll/run              # Trigger payroll for month/year
GET    /api/admin/payroll/preview/:month/:year
GET    /api/payroll/my-payslips
GET    /api/payroll/my-payslips/:id/pdf
POST   /api/admin/payroll/send-slips       # Send all payslips via WhatsApp
```

### WhatsApp
```
POST   /api/whatsapp/webhook               # Incoming messages from Meta
GET    /api/admin/whatsapp/logs
POST   /api/admin/whatsapp/send            # Manual message
POST   /api/admin/whatsapp/broadcast       # Send to group
GET    /api/admin/whatsapp/templates
```

---

## 📲 WhatsApp Integration

### Provider Options (in priority order)
1. **WATI** (recommended for India) — Simple API, template management UI, webhook support
2. **Twilio WhatsApp Business API** — Robust, good SDK (see twilio-whatsapp skill)
3. **Meta Cloud API (direct)** — Most control, requires Meta Business verification

### Message Templates (pre-approve with Meta)

```
CHECK_IN_CONFIRMATION:
"✅ *Check-In Confirmed*
Employee: {{employee_name}}
Time: {{check_in_time}}
Branch: {{branch_name}}
Location: Verified ✓"

CHECK_OUT_SUMMARY:
"🏁 *Check-Out Confirmed*
Employee: {{employee_name}}
Check-Out: {{check_out_time}}
Total Hours: {{hours_worked}}
Status: {{attendance_status}}"

ABSENT_ALERT:
"⚠️ *Absent Alert*
{{employee_name}} has not checked in today ({{date}}).
If this is an error, please check in via the app."

LEAVE_APPROVED:
"✅ *Leave Approved*
Type: {{leave_type}}
Duration: {{from_date}} to {{to_date}} ({{days}} day(s))
Approved by: {{approver_name}}"

LEAVE_REJECTED:
"❌ *Leave Rejected*
Your leave request for {{from_date}} to {{to_date}} was rejected.
Reason: {{rejection_reason}}"

SALARY_SLIP:
"💰 *Salary Credited*
Month: {{month_year}}
Net Salary: ₹{{net_salary}}
Your payslip is attached. 📄"

GEOFENCE_VIOLATION:
"⚠️ *Location Alert*
{{employee_name}} is outside the designated work zone.
Please return to {{branch_name}}."
```

### Inbound WhatsApp Commands (Two-way)
```
Employee sends "IN"     → Triggers check-in instructions (must use app for selfie)
Employee sends "OUT"    → Triggers check-out instructions
Employee sends "LEAVE"  → Bot replies with leave application link
Employee sends "STATUS" → Bot replies with today's attendance status
Employee sends "BALANCE"→ Bot replies with leave balance
Employee sends "SLIP"   → Bot sends latest payslip PDF
```

---

## 🤖 AI Components

### 1. Face Recognition (Attendance Verification)
- **Enrollment:** Admin uploads clear face photo of employee → stored as face template in AWS Rekognition Collection
- **Verification:** On each selfie → compare against enrolled template → confidence score
- **Threshold:** Accept if score ≥ 85 (configurable in admin settings)
- **Liveness:** ML Kit Face Detection on Android (blink detection, 3D depth check)
- **Strict gate (since 2026-07-15):** check-in/out require an enrolled face AND the selfie must match the logged-in employee at/above threshold — otherwise rejected with 403. Gate is skipped only when AWS creds are absent (local dev).

### 2. Geofence AI Logic
```
Input: lat, lng, employee.branchId
→ Fetch branch geofence (circle or polygon)
→ Calculate distance / point-in-polygon
→ Return: { inside: boolean, distance: number, confidence: string }

Edge cases:
- GPS accuracy > 50m → warn employee, allow with flag
- Employee near boundary (within 10m) → "borderline" status
```

### 3. Payroll Calculation Engine
```typescript
calculateNetSalary(employee, attendanceSummary, month, year) {
  // 1. Working days in month (minus holidays)
  // 2. Present days from attendance
  // 3. Leave days (paid vs LOP)
  // 4. Effective salary days = present + paid leaves
  // 5. Per-day salary = grossSalary / workingDays
  // 6. Earned gross = perDay * effectiveDays
  // 7. PF = 12% of basic (if basic > 15000, cap at 1800)
  // 8. ESI = 0.75% of gross (if gross <= 21000)
  // 9. PT = per state slab
  // 10. Net = earnedGross - PF - ESI - PT - TDS - advances
}
```

### 4. Shift Anomaly Detection
- Flag if check-in time is >1 hour before shift start
- Flag if check-out time is >2 hours after shift end (unusual overtime)
- Flag if same employee checks in from 2 different GPS locations in same day
- Weekly report: employees with most anomalies

---

## 🔒 Security Requirements

- **All API routes authenticated** with JWT (Bearer token)
- **Role-based access:** SUPER_ADMIN > HR_MANAGER > BRANCH_MANAGER > PAYROLL_ADMIN
- **Selfie photos:** stored in Cloudinary with private signed URLs (expire in 24h)
- **Face templates:** stored only in AWS Rekognition (never in plain storage)
- **GPS data:** encrypted at rest in DB
- **Phone numbers:** masked in logs (show only last 4 digits)
- **Audit log:** every admin action logged with userId, action, timestamp, IP
- **Rate limiting:** OTP endpoints limited to 3 attempts per 10 minutes
- **HTTPS only** for all API communication
- **Certificate pinning** in Android app
- **Device binding:** employee can only use registered device for attendance (device fingerprint stored at first login)

---

## 🌐 Environment Variables

```env
# Backend
DATABASE_URL=postgresql://user:pass@localhost:5432/hrpayroll
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_jwt_secret_here
JWT_REFRESH_SECRET=your_refresh_secret_here

# Cloudinary (selfie storage)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# AWS (face recognition)
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REKOGNITION_COLLECTION_ID=hr-payroll-faces

# WhatsApp (WATI or Twilio)
WHATSAPP_PROVIDER=wati          # wati | twilio | meta
WATI_API_URL=https://live-mt-server.wati.io/api/v1
WATI_API_TOKEN=
# OR for Twilio:
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

# Meta WhatsApp Cloud API (if using direct)
META_WHATSAPP_TOKEN=
META_WHATSAPP_PHONE_ID=
META_WHATSAPP_VERIFY_TOKEN=

# Firebase (push notifications)
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_GOOGLE_MAPS_KEY=
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

---

## 📋 Development Phases

### Phase 1 — Core Infrastructure (Week 1–2)
- [ ] Backend: Project setup, Prisma schema, auth (OTP + JWT)
- [ ] Backend: Employee CRUD, Branch management
- [ ] Android: Project setup (Hilt, Retrofit, Room, Compose navigation)
- [ ] Android: Login screen (phone + OTP flow)
- [ ] Web: Next.js setup, auth, basic layout
- [ ] Database: PostgreSQL + Redis running (Docker)

### Phase 2 — Attendance Core (Week 3–4)
- [ ] Android: CameraX selfie capture + ML Kit face detection + liveness
- [ ] Android: GPS geofence check (FusedLocationProvider)
- [ ] Backend: Check-in/out API + AWS Rekognition face match
- [ ] Backend: Geofence calculation service
- [ ] Android: Attendance screens (check-in/out flow)
- [ ] Backend: GPS log storage

### Phase 3 — Shift & Leave (Week 5–6)
- [ ] Backend: Shift management APIs
- [ ] Android: Shift monitor screen (live timer, break tracker)
- [ ] Backend: Leave management APIs
- [ ] Android: Leave application screen
- [ ] Web: Shift management UI
- [ ] Web: Leave approval inbox

### Phase 4 — Web Dashboard & Real-time (Week 7–8)
- [ ] Web: Live attendance dashboard with Socket.io
- [ ] Web: Employee management (CRUD + face enrollment)
- [ ] Web: Geofence management map UI
- [ ] Web: Reports + export
- [ ] Backend: Socket.io live feed events

### Phase 5 — WhatsApp Integration (Week 9)
- [ ] Backend: WhatsApp service (WATI/Twilio)
- [ ] Backend: Message templates registration
- [ ] Backend: Webhook handler (inbound messages)
- [ ] Backend: BullMQ queue for async WhatsApp sending
- [ ] Web: WhatsApp automation center UI
- [ ] Testing: All trigger scenarios

### Phase 6 — Payroll Engine (Week 10–11)
- [ ] Backend: Payroll calculation engine
- [ ] Backend: Payslip PDF generation (PDFKit)
- [ ] Backend: Statutory deductions (PF/ESI/PT)
- [ ] Web: Payroll dashboard + run payroll flow
- [ ] Android: Payslip view screen
- [ ] Backend: Auto-send payslip via WhatsApp

### Phase 7 — Polish & Launch (Week 12)
- [ ] Security audit (JWT, rate limiting, input validation)
- [ ] Android: Offline support + sync queue
- [ ] Performance: API response times < 500ms
- [ ] Error handling: All edge cases
- [ ] Documentation: API docs (Swagger)
- [ ] Docker deployment setup
- [ ] Play Store: Prepare signed APK / AAB

---

## 🚀 Claude Code Execution Instructions

When working in this repo, Claude should:

### Starting a new feature
1. Read the relevant section in this CLAUDE.md first
2. Check `docs/` for detailed design docs if they exist
3. Follow the established patterns in existing files (don't invent new patterns)
4. Write types first (in `shared/types/`), then backend, then frontend/Android

### Android conventions
- All screens are Composable functions in `ui/screens/`
- ViewModels use `@HiltViewModel` and `StateFlow` for UI state
- Repository pattern: ViewModel → UseCase → Repository → API/Room
- Name convention: `FeatureScreen.kt`, `FeatureViewModel.kt`, `FeatureRepository.kt`
- All async work in `viewModelScope` or `coroutineScope`

### Backend conventions
- Controllers are thin — business logic lives in Services
- All DB access goes through Prisma (never raw SQL unless complex reporting)
- Every route must validate input with Zod
- All errors thrown as `AppError(message, statusCode)` — caught by global handler
- Never `console.log` in production code — use structured logger (pino)
- WhatsApp sends always go through the BullMQ queue (never direct from request handler)

### Web App conventions
- Use Server Components by default; add `"use client"` only when needed
- Data fetching in Server Components or SWR/React Query in client components
- All forms use React Hook Form + Zod schemas
- Real-time data uses Socket.io client in a custom hook

### Testing
- Write tests for: payroll calculation engine, geofence logic, face match service
- Android: Instrumented tests for camera flow, unit tests for ViewModels
- Backend: Integration tests for attendance check-in/out flow

### When modifying the DB schema
1. Edit `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name description`
3. Update related TypeScript types in `shared/types/`
4. Update affected API controllers/services

---

## ⚠️ Known Constraints & Edge Cases

| Scenario | Handling |
|---|---|
| No internet on check-in | Store in Room DB, sync via WorkManager when connected |
| GPS unavailable | Block check-in, show "Enable GPS" prompt |
| Face not enrolled / match fails | Block check-in/out with 403 and a clear message (strict since 2026-07-15) |
| Employee checks in from home | Geofence will flag; HR to investigate |
| Night shift crosses midnight | Shift date = shift start date; work hours span 2 calendar days |
| Same employee multiple devices | Block — only registered device allowed (device fingerprint) |
| WhatsApp delivery failure | Retry 3 times via BullMQ, then log as failed |
| Payroll run mid-month | System allows partial month calculation (pro-rata) |
| Public holidays | Holiday calendar configurable; auto-mark as holiday, not absent |
| Employee on approved leave | Auto-mark with leave type; don't send absent alert |

---

## 📞 Support & Escalation

- **GPS accuracy issues on Android:** Ensure `ACCESS_FINE_LOCATION` + `ACCESS_BACKGROUND_LOCATION` permissions
- **Face match low accuracy:** Re-enroll employee with a better quality photo (good lighting, front-facing, no glasses)
- **WhatsApp template rejection:** All templates must be approved by Meta before use; use exact approved wording
- **Play Store:** Location in background + camera permissions require privacy policy and justification in listing

---

*Last updated: June 2026 | Project: AI HR Payroll System | Stack: Kotlin + Next.js + Node.js*
