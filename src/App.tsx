import { useEffect, useState, type ChangeEvent, type MouseEvent, type ReactNode } from "react"

// Single-file CampusBook prototype for Figma Make.
// Requires React and Tailwind CSS in the host environment.
// Browser-only demo: no shared backend or real user authentication.

// ---- lib/booking.ts (inlined for Figma Make) ----
type AppointmentStatus = "SCHEDULED" | "RESCHEDULED" | "CANCELLED" | "CANCELLED_LATE"

type Slot = {
  slotID: string
  providerID: string
  provider: string
  departmentID: string
  serviceID: string
  date: string
  dateLabel: string
  time: string
  startTime: string
  endTime: string
}

type Appointment = {
  appointmentID: string
  studentID: string
  slot: Slot
  status: AppointmentStatus
  department: string
  service: string
}

type ConflictReason = "STUDENT_OVERLAP" | "PROVIDER_UNAVAILABLE" | "APPOINTMENT_INACTIVE" | "NOT_FOUND" | "NOT_OWNER" | "SLOT_EXPIRED"
type ChangeResult =
  | { ok: true; records: Appointment[]; appointment: Appointment }
  | { ok: false; reason: ConflictReason; records: Appointment[] }

function activeStatus(status: AppointmentStatus): boolean {
  return status === "SCHEDULED" || status === "RESCHEDULED"
}

function minutes(value: string): number {
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!match) return NaN
  return (Number(match[1]) % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(match[2])
}

/** Time conflicts are half-open intervals: [start, end). Adjacent slots are allowed. */
function overlappingSlots(a: Slot, b: Slot): boolean {
  if (a.date !== b.date) return false
  if (a.slotID === b.slotID) return true
  const aStart = minutes(a.startTime)
  const aEnd = minutes(a.endTime)
  const bStart = minutes(b.startTime)
  const bEnd = minutes(b.endTime)
  if (![aStart, aEnd, bStart, bEnd].every(Number.isFinite)) return true // fail closed
  return aStart < bEnd && bStart < aEnd
}

/**
 * Two independent rules:
 *  - One student cannot attend two overlapping appointments, ANY department/service/provider.
 *  - One provider cannot serve two students at the same time, ANY department/service.
 */
function bookingConflict(
  slot: Slot,
  studentID: string,
  records: readonly Appointment[],
  exceptAppointmentID?: string,
): ConflictReason | null {
  for (const record of records) {
    if (!activeStatus(record.status) || record.appointmentID === exceptAppointmentID) continue
    if (!overlappingSlots(record.slot, slot)) continue
    if (record.studentID === studentID) return "STUDENT_OVERLAP"
    if (record.slot.slotID === slot.slotID || record.slot.providerID === slot.providerID) {
      return "PROVIDER_UNAVAILABLE"
    }
  }
  return null
}

function availableForStudent(
  slot: Slot, studentID: string, records: readonly Appointment[], exceptAppointmentID?: string,
): boolean {
  return bookingConflict(slot, studentID, records, exceptAppointmentID) === null
}

/** Revalidate at commit time, never trust a previously listed slot. */
function createBooking(records: readonly Appointment[], appointment: Appointment): ChangeResult {
  if (!isFutureSlot(appointment.slot)) return { ok: false, reason: "SLOT_EXPIRED", records: [...records] }
  const conflict = bookingConflict(appointment.slot, appointment.studentID, records)
  if (conflict) return { ok: false, reason: conflict, records: [...records] }
  if (records.some((r) => r.appointmentID === appointment.appointmentID)) {
    return { ok: false, reason: "PROVIDER_UNAVAILABLE", records: [...records] }
  }
  const booked = { ...appointment, status: "SCHEDULED" as const }
  return { ok: true, appointment: booked, records: [...records, booked] }
}

/** Do not release the old slot unless the new one is available. */
function rescheduleBooking(
  records: readonly Appointment[], appointmentID: string, studentID: string, nextSlot: Slot,
): ChangeResult {
  const existing = records.find((record) => record.appointmentID === appointmentID)
  if (!existing) return { ok: false, reason: "NOT_FOUND", records: [...records] }
  if (existing.studentID !== studentID) return { ok: false, reason: "NOT_OWNER", records: [...records] }
  if (!activeStatus(existing.status)) return { ok: false, reason: "APPOINTMENT_INACTIVE", records: [...records] }
  if (!isFutureSlot(nextSlot)) return { ok: false, reason: "SLOT_EXPIRED", records: [...records] }
  const conflict = bookingConflict(nextSlot, studentID, records, appointmentID)
  if (conflict) return { ok: false, reason: conflict, records: [...records] }
  const updated: Appointment = { ...existing, slot: nextSlot, status: "RESCHEDULED" }
  return {
    ok: true,
    appointment: updated,
    records: records.map((record) => record.appointmentID === appointmentID ? updated : record),
  }
}

function cancelBooking(
  records: readonly Appointment[], appointmentID: string, studentID: string, late: boolean,
): ChangeResult {
  const existing = records.find((record) => record.appointmentID === appointmentID)
  if (!existing) return { ok: false, reason: "NOT_FOUND", records: [...records] }
  if (existing.studentID !== studentID) return { ok: false, reason: "NOT_OWNER", records: [...records] }
  if (!activeStatus(existing.status)) return { ok: false, reason: "APPOINTMENT_INACTIVE", records: [...records] }
  const updated: Appointment = { ...existing, status: late ? "CANCELLED_LATE" : "CANCELLED" }
  return {
    ok: true,
    appointment: updated,
    records: records.map((record) => record.appointmentID === appointmentID ? updated : record),
  }
}

function conflictMessage(reason: ConflictReason): string {
  switch (reason) {
    case "STUDENT_OVERLAP": return "You already have another appointment at this time. Please choose a different time."
    case "PROVIDER_UNAVAILABLE": return "This time is no longer available. Please choose another open slot."
    case "APPOINTMENT_INACTIVE": return "This appointment has already been cancelled. Return to My Schedule."
    case "NOT_OWNER": return "This appointment does not belong to your schedule."
    case "SLOT_EXPIRED": return "This time has already passed. Choose a future appointment."
    case "NOT_FOUND": return "This appointment could not be found. Return to My Schedule."
  }
}


function slotStart(slot: Slot): Date {
  const [year, month, day] = slot.date.split("-").map(Number)
  const start = minutes(slot.startTime)
  return new Date(year, month - 1, day, Math.floor(start / 60), start % 60)
}

function isFutureSlot(slot: Slot, now = new Date()): boolean {
  return Number.isFinite(minutes(slot.startTime)) && slotStart(slot).getTime() > now.getTime()
}

// ---- lib/availability.ts (inlined for Figma Make) ----

const departments = [
  { id: "dep_it", name: "Information Technology" },
  { id: "dep_math", name: "Mathematics" },
]
const services = [
  { id: "svc_it", departmentID: "dep_it", name: "Peer Tutoring" },
  { id: "svc_it_advising", departmentID: "dep_it", name: "Academic Advising" },
  { id: "svc_math", departmentID: "dep_math", name: "Peer Tutoring" },
]
const offerings = [
  { providerID: "it_peer_tutor", provider: "Peer Tutor", departmentID: "dep_it", serviceID: "svc_it" },
  { providerID: "math_peer_tutor", provider: "Math Peer Tutor", departmentID: "dep_math", serviceID: "svc_math" },
  { providerID: "it_advisor", provider: "Academic Advisor", departmentID: "dep_it", serviceID: "svc_it_advising" },
]
const times = [["10:00 AM", "10:30 AM"], ["11:00 AM", "11:30 AM"], ["1:00 PM", "1:30 PM"]] as const
function displayDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
}
// Generate the next 14 weekdays at runtime, not fixed dates that expire.
function generateSlots(now = new Date()): Slot[] {
  const result: Slot[] = []
  for (let offset = 0, days = 0; days < 14; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    if (date.getDay() === 0 || date.getDay() === 6) continue
    days++
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    for (const offering of offerings) {
      for (const [startTime, endTime] of times) {
        result.push({ ...offering, slotID: `${offering.providerID}_${dateKey}_${startTime.replace(/\W/g, "")}`, date: dateKey, dateLabel: displayDate(dateKey), time: `${startTime}–${endTime}`, startTime, endTime })
      }
    }
  }
  return result
}
const slots = generateSlots()

// ---- lib/storage.ts (inlined for Figma Make) ----

// Prototype only: no authentication or cross-device booking guarantees.
const STUDENT_ID = "demo-student"
const STORAGE_KEY = "campusbook-appointments-v4"
const LEGACY_KEYS = ["campusbook-appointments-v3", "campusbook-appointments-v2"]
const LOCK_KEY = "campusbook-demo-reservation-lock"
const statuses: AppointmentStatus[] = ["SCHEDULED", "RESCHEDULED", "CANCELLED", "CANCELLED_LATE"]

function validateAppointments(data: unknown): Appointment[] {
  if (!Array.isArray(data)) throw new Error("Saved appointments are not an array")
  const records: Appointment[] = []
  const ids = new Set<string>()
  for (const value of data) {
    if (!value || typeof value !== "object") throw new Error("Invalid appointment record")
    const item = value as Record<string, unknown>
    if (typeof item.appointmentID !== "string" || !item.appointmentID || ids.has(item.appointmentID) ||
        typeof item.studentID !== "string" || !item.studentID ||
        typeof item.status !== "string" || !statuses.includes(item.status as AppointmentStatus) ||
        !item.slot || typeof item.slot !== "object") throw new Error("Invalid appointment fields")
    const rawSlot = item.slot as Record<string, unknown>
    if (typeof rawSlot.date !== "string" || typeof rawSlot.startTime !== "string" || typeof rawSlot.endTime !== "string") {
      throw new Error("Invalid appointment slot")
    }
    const departmentID = typeof rawSlot.departmentID === "string" ? rawSlot.departmentID : item.department === "Mathematics" ? "dep_math" : "dep_it"
    const serviceID = typeof rawSlot.serviceID === "string" ? rawSlot.serviceID : item.service === "Academic Advising" ? "svc_it_advising" : departmentID === "dep_math" ? "svc_math" : "svc_it"
    const slot = slots.find(s => s.date === rawSlot.date && s.startTime === rawSlot.startTime && s.endTime === rawSlot.endTime && s.departmentID === departmentID && s.serviceID === serviceID)
    // Keep historical appointments even after generated availability has rolled forward.
    const historical = typeof rawSlot.slotID === "string" && typeof rawSlot.providerID === "string" && typeof rawSlot.provider === "string" &&
      typeof rawSlot.dateLabel === "string" && typeof rawSlot.time === "string" &&
      typeof rawSlot.departmentID === "string" && typeof rawSlot.serviceID === "string"
    if (!slot && !historical) throw new Error("Unrecognized appointment slot")
    const department = departments.find(d => d.id === departmentID)?.name
    const service = services.find(s => s.id === serviceID)?.name
    if (!department || !service) throw new Error("Unrecognized department or service")
    ids.add(item.appointmentID)
    records.push({ appointmentID: item.appointmentID, studentID: item.studentID, status: item.status as AppointmentStatus,
      slot: slot ?? rawSlot as unknown as Appointment["slot"], department, service })
  }
  return records
}

function readStoredAppointments(): Appointment[] {
  if (typeof window === "undefined") return []
  const key = [STORAGE_KEY, ...LEGACY_KEYS].find(k => window.localStorage.getItem(k) !== null)
  if (!key) return []
  const raw = window.localStorage.getItem(key)
  if (raw === null) return []
  return validateAppointments(JSON.parse(raw))
}

function storeAppointments(records: Appointment[]): void {
  if (typeof window === "undefined") throw new Error("Browser storage is unavailable")
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}
function clearStoredAppointments(records: Appointment[]): void {
  storeAppointments(records)
}
async function withDemoWriteLock<T>(action: () => T): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) return navigator.locks.request(LOCK_KEY, action)
  return action()
}







type Screen =
  | "BookAppointment"
  | "ConfirmBooking"
  | "BookingSuccess"
  | "MySchedule"
  | "PickNewSlot"
  | "RescheduleSuccess"
  | "ConfirmCancellation"
  | "CancellationSuccess"

function Icon({
  name,
  className = "size-5",
}: {
  name: "back" | "book" | "calendar" | "check" | "clock" | "user" | "sparkles" | "shield" | "arrow-right" | "rotate"
  className?: string
}) {
  const paths = {
    back: <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />,
    book: (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-6-6h12" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 3v3m12-3v3M4 8h16v12H4z" />
      </>
    ),
    calendar: (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 3v3m12-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z" />
        <path strokeLinecap="round" d="M8 13h2m4 0h2m-8 4h2m4 0h2" />
      </>
    ),
    check: <path strokeLinecap="round" strokeLinejoin="round" d="m6 12.5 4 4L18.5 8" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 20a6.5 6.5 0 0 1 13 0" />
      </>
    ),
    sparkles: (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m19 17 .7 1.3L21 19l-1.3.7L19 21l-.7-1.3L17 19l1.3-.7L19 17Z" />
      </>
    ),
    shield: (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
      </>
    ),
    "arrow-right": <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6 6 6-6 6" />,
    rotate: (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 11a8 8 0 1 0-2.7 6" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 4v7h-7" />
      </>
    ),
  }

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      {paths[name]}
    </svg>
  )
}

function Button({
  children,
  variant = "primary",
  disabled = false,
  loading = false,
  loadingLabel = "Processing…",
  onClick,
}: {
  children: ReactNode
  variant?: "primary" | "outline" | "danger" | "link"
  disabled?: boolean
  loading?: boolean
  loadingLabel?: string
  onClick?: () => void
}) {
  const variants = {
    primary: "bg-blue-600 text-white shadow-sm shadow-blue-200 hover:bg-blue-700 active:scale-[0.99]",
    outline: "border border-slate-200 bg-white text-slate-800 shadow-sm hover:border-blue-200 hover:bg-blue-50/50 active:scale-[0.99]",
    danger: "bg-red-600 text-white shadow-sm hover:bg-red-700 active:scale-[0.99]",
    link: "bg-transparent text-blue-700 hover:bg-blue-50",
  }

  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading}
      onClick={onClick}
      className={`min-h-12 w-full rounded-2xl px-4 py-3.5 text-sm font-bold tracking-[0.01em] transition duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]}`}
    >
      <span aria-live="polite">{loading ? loadingLabel : children}</span>
    </button>
  )
}

function AppHeader({
  title,
  backLabel,
  onBack,
}: {
  title: string
  backLabel?: string
  onBack?: () => void
}) {
  return (
    <header className="border-b border-slate-100 bg-white px-5 pb-5 pt-6">
      <div className="relative flex min-h-14 items-center justify-center">
        {onBack && (
          <button type="button" aria-label={backLabel ?? "Go back"} onClick={onBack}
            className="absolute left-0 flex size-10 items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200">
            <Icon name="back" />
          </button>
        )}
        <div className="px-10 text-center">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-blue-600">CampusBook</div>
          <h1 className="mt-1 text-[21px] font-extrabold tracking-tight text-slate-950">{title}</h1>
        </div>
      </div>
    </header>
  )
}

function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode
  tone?: "info" | "error" | "warning"
}) {
  const tones = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    error: "border-red-200 bg-red-50 text-red-900",
    warning: "border-amber-300 bg-amber-50 text-amber-950",
  }

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${tones[tone]}`}
    >
      {tone !== "info" && (
        <strong className="mr-1">{tone === "warning" ? "Please note:" : "Unable to continue:"}</strong>
      )}
      {children}
    </div>
  )
}

function DetailCard({
  title,
  slot,
  appointmentID,
  status,
  department = "Information Technology",
  service = "Peer Tutoring",
}: {
  title: string
  slot: Slot
  appointmentID?: string
  status?: AppointmentStatus
  department?: string
  service?: string
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm shadow-slate-200/60">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-extrabold text-slate-900">{title}</h2>
        <span className="flex size-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
          <Icon name="calendar" className="size-4" />
        </span>
      </div>
      <dl className="divide-y divide-slate-100 px-5 py-2">
        <Detail label="Department" value={department} />
        <Detail label="Service" value={service} />
        <Detail label="Provider" value={slot.provider} />
        <Detail label="Date" value={slot.dateLabel} />
        <Detail label="Time" value={slot.time} />
        <Detail label="Duration" value="30 minutes" />
        {appointmentID && <Detail label="Appointment ID" value={appointmentID} />}
        {status && <Detail label="Status" value={statusLabel(status)} />}
      </dl>
    </section>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-[13px] text-slate-500">{label}</dt>
      <dd className="max-w-[65%] text-right text-[13px] font-semibold leading-5 text-slate-900">{value}</dd>
    </div>
  )
}

function SuccessIcon({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="mx-auto flex size-20 items-center justify-center rounded-full border-8 border-emerald-50 bg-emerald-100 text-emerald-700 shadow-sm"
    >
      <Icon name="check" className="size-10" />
    </div>
  )
}

function BottomTabs({
  active,
  onNavigate,
}: {
  active: "book" | "schedule"
  onNavigate: (screen: Screen) => void
}) {
  return (
    <nav aria-label="Primary navigation" className="sticky bottom-0 z-10 grid grid-cols-2 border-t border-slate-100 bg-white/95 px-3 pb-1 pt-1 backdrop-blur">
      <Tab
        label="Book"
        icon="book"
        active={active === "book"}
        onClick={() => onNavigate("BookAppointment")}
      />
      <Tab
        label="My Schedule"
        icon="calendar"
        active={active === "schedule"}
        onClick={() => onNavigate("MySchedule")}
      />
    </nav>
  )
}

function Tab({
  label,
  icon,
  active,
  onClick,
}: {
  label: string
  icon: "book" | "calendar"
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-xs font-bold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-blue-200 ${
        active ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50"
      }`}
    >
      <Icon name={icon} />
      {label}
    </button>
  )
}

function statusLabel(status: AppointmentStatus) {
  switch (status) {
    case "SCHEDULED": return "Scheduled"
    case "RESCHEDULED": return "Rescheduled"
    case "CANCELLED": return "Cancelled"
    case "CANCELLED_LATE": return "Cancelled late"
  }
}

function isLate(slot: Slot) {
  const [year, month, day] = slot.date.split("-").map(Number)
  if (!year || !month || !day) return false
  const start = slotStart(slot)
  return start.getTime() - Date.now() < 2 * 60 * 60 * 1000
}

function StatusBadge({ status }: { status: AppointmentStatus }) {
  const palette = {
    SCHEDULED: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100",
    RESCHEDULED: "bg-blue-50 text-blue-800 ring-1 ring-blue-100",
    CANCELLED: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    CANCELLED_LATE: "bg-amber-50 text-amber-800 ring-1 ring-amber-100",
  }
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${palette[status]}`}>
      {statusLabel(status)}
    </span>
  )
}


/** Date options in a compact, swipeable calendar strip. Only provided dates appear. */
function DateStrip({
  dates, selected, onSelect, countForDate,
}: {
  dates: readonly string[]
  selected: string
  onSelect: (date: string) => void
  countForDate: (date: string) => number
}) {
  return (
    <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-3 pt-2" role="group" aria-label="Choose an available date">
      {dates.map((date) => {
        const [year, month, day] = date.split("-").map(Number)
        const parsed = new Date(year, month - 1, day)
        const active = selected === date
        const count = countForDate(date)
        return (
          <button key={date} type="button" aria-pressed={active}
            aria-label={`${displayDate(date)}, ${count} available time${count === 1 ? "" : "s"}`}
            onClick={() => onSelect(date)}
            className={`flex min-w-[94px] snap-start flex-col items-center rounded-2xl border px-3 py-3 text-center transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 ${active
              ? "border-blue-600 bg-blue-600 text-white shadow-md shadow-blue-200"
              : "border-slate-200 bg-white text-slate-900 shadow-sm hover:border-blue-300 hover:bg-blue-50/50"}`}>
            <span className={`text-[11px] font-bold uppercase tracking-widest ${active ? "text-blue-100" : "text-slate-500"}`}>
              {parsed.toLocaleDateString("en-US", { weekday: "short" })}
            </span>
            <span className="mt-0.5 text-2xl font-extrabold tabular-nums">{day}</span>
            <span className={`text-[11px] font-semibold ${active ? "text-blue-100" : "text-slate-600"}`}>
              {parsed.toLocaleDateString("en-US", { month: "short" })}
            </span>
            <span className={`mt-2 rounded-lg px-2 py-1 text-[10px] font-bold ${active ? "bg-white/20 text-white" : "bg-emerald-50 text-emerald-700"}`}>
              {count} {count === 1 ? "slot" : "slots"}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function TimeOption({
  slot, selected, onSelect,
}: {
  slot: Slot
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" aria-pressed={selected}
      aria-label={`${selected ? "Selected" : "Select"} ${slot.time} with ${slot.provider}`}
      onClick={onSelect}
      className={`flex min-h-20 w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 ${selected
        ? "border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-400"
        : "border-slate-200 bg-white shadow-sm hover:border-blue-300 hover:shadow-md"}`}>
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${selected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>
        <Icon name="clock" className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-extrabold text-slate-900">{slot.time}</span>
        <span className="mt-1 block text-xs text-slate-500">{slot.provider} · 30 min</span>
      </span>
      {selected ? (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
          <Icon name="check" className="size-4" />
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">Open</span>
      )}
    </button>
  )
}

function SectionTitle({ index, title, subtitle }: { index: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-xs font-extrabold text-blue-700">{index}</span>
      <div className="min-w-0">
        <h2 className="text-base font-extrabold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs leading-5 text-slate-500">{subtitle}</p>}
      </div>
    </div>
  )
}

function RescheduleComparison({ current, proposed }: { current: Slot; proposed: Slot }) {
  return (
    <section aria-label="Reschedule comparison" className="rounded-3xl border border-blue-200 bg-blue-50/80 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-extrabold text-blue-950">
        <Icon name="rotate" className="size-4 text-blue-700" /> Review your change
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="min-w-0 rounded-2xl bg-white px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Current</p>
          <p className="mt-1 text-xs font-extrabold text-slate-900">{displayDate(current.date)}</p>
          <p className="mt-1 text-xs text-slate-600">{current.startTime}</p>
        </div>
        <Icon name="arrow-right" className="size-4 text-blue-600" />
        <div className="min-w-0 rounded-2xl border border-blue-200 bg-white px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700">New choice</p>
          <p className="mt-1 text-xs font-extrabold text-slate-900">{displayDate(proposed.date)}</p>
          <p className="mt-1 text-xs text-slate-600">{proposed.startTime}</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-blue-900">Your original appointment stays reserved until this new time is confirmed.</p>
    </section>
  )
}


function ScheduleCard({ item, onModify }: { item: Appointment; onModify: () => void }) {
  const isCurrent = activeStatus(item.status)
  const [year, month, day] = item.slot.date.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  return (
    <article className={`overflow-hidden rounded-3xl border bg-white shadow-sm shadow-slate-200/70 ${isCurrent ? "border-slate-200" : "border-slate-100 opacity-90"}`}>
      <div className="flex items-start gap-4 p-4">
        <div className="flex w-[58px] shrink-0 flex-col items-center justify-center rounded-2xl bg-blue-50 px-2 py-3 text-blue-900">
          <span className="text-[10px] font-bold uppercase tracking-wide text-blue-600">{date.toLocaleDateString("en-US", { month: "short" })}</span>
          <span className="text-2xl font-extrabold tabular-nums">{day}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2"><StatusBadge status={item.status} /></div>
          <h3 className="mt-2 text-base font-extrabold text-slate-900">{item.service}</h3>
          <p className="mt-1 text-xs text-slate-500">{item.department}</p>
          <div className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-slate-700">
            <Icon name="clock" className="size-4 text-blue-600" /> {item.slot.time}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
            <Icon name="user" className="size-4" /> {item.slot.provider}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
        <span className="truncate text-[10px] text-slate-400">{item.appointmentID}</span>
        {isCurrent && (
          <button type="button" onClick={onModify}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-blue-50 px-3 text-xs font-extrabold text-blue-700 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200">
            Modify <Icon name="arrow-right" className="size-4" />
          </button>
        )}
      </div>
    </article>
  )
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("BookAppointment")
  const [departmentID, setDepartmentID] = useState("")
  const [serviceID, setServiceID] = useState("")
  const [selectedDate, setSelectedDate] = useState("")
  const [selectedSlotID, setSelectedSlotID] = useState("")
  const [replacementSlotID, setReplacementSlotID] = useState("")
  const [replacementDate, setReplacementDate] = useState("")
  const [appointments, setAppointments] = useState<Appointment[]>(() => {
    try { return readStoredAppointments() } catch { return [] }
  })
  const [activeAppointmentID, setActiveAppointmentID] = useState("")
  const [modifyOpen, setModifyOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(() => {
    try { readStoredAppointments(); return null }
    catch { return "Saved appointment data is invalid or unavailable. Clear browser storage for this site to reset the demo." }
  })

  // If the prototype is open in another tab, show its updates here too.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY || event.key === null) {
        try { setAppointments(readStoredAppointments()) } catch { setError("Saved appointments could not be read. Please reset the demo data.") }
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const appointment = appointments.find((item) => item.studentID === STUDENT_ID && item.appointmentID === activeAppointmentID) ?? null
  const selectedSlot = slots.find((slot) => slot.slotID === selectedSlotID)
  const replacementSlot = slots.find((slot) => slot.slotID === replacementSlotID)
  const filteredServices = services.filter((service) => service.departmentID === departmentID)
  const selectedDepartmentName =
    departments.find((department) => department.id === departmentID)?.name ?? ""
  const selectedServiceName =
    services.find((service) => service.id === serviceID)?.name ?? ""
  const lateCancellation = appointment ? isLate(appointment.slot) : false
  const availableSlots = slots.filter((slot) =>
    slot.departmentID === departmentID && slot.serviceID === serviceID && slot.date === selectedDate &&
    isFutureSlot(slot) && availableForStudent(slot, STUDENT_ID, appointments),
  )
  // Booking offers only dates with an available slot for this student.
  const availableBookingDates = [...new Set(
    slots.filter((slot) => slot.departmentID === departmentID &&
      slot.serviceID === serviceID && isFutureSlot(slot) && availableForStudent(slot, STUDENT_ID, appointments))
      .map((slot) => slot.date),
  )].sort()

  // Rescheduling must keep the original appointment reserved until a successful
  // commit. Exclude ONLY this appointment's own slot; all other bookings block
  // conflicting times, including other departments and services.
  const allReplacementSlots = appointment
    ? slots.filter((slot) => slot.serviceID === appointment.slot.serviceID &&
        slot.departmentID === appointment.slot.departmentID &&
        slot.slotID !== appointment.slot.slotID &&
        isFutureSlot(slot) && availableForStudent(slot, STUDENT_ID, appointments, appointment.appointmentID))
    : []
  const replacementDates = [...new Set(allReplacementSlots.map((slot) => slot.date))].sort()
  const newSlotOptions = allReplacementSlots.filter((slot) => slot.date === replacementDate)
  const sortedAppointments = appointments.filter((item) => item.studentID === STUDENT_ID).sort((a, b) =>
    Number(activeStatus(b.status)) - Number(activeStatus(a.status)),
  )

  function latestAppointments() {
    return readStoredAppointments()
  }

  function navigate(nextScreen: Screen) {
    setError(null)
    setModifyOpen(false)
    setScreen(nextScreen)
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function waitForPrototypeRequest() {
    return new Promise<void>((resolve) => window.setTimeout(resolve, 650))
  }

  async function bookAppointment() {
    if (!selectedSlot || loading || !departmentID || !serviceID ||
        selectedSlot.departmentID !== departmentID || selectedSlot.serviceID !== serviceID) return
    setLoading(true)
    setError(null)
    try {
      await waitForPrototypeRequest()
      // Re-read current bookings inside the write lock. UI availability is never authoritative.
      const outcome = await withDemoWriteLock(() => {
        const current = latestAppointments()
        const candidate: Appointment = {
          appointmentID: `APT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
          studentID: STUDENT_ID,
          slot: selectedSlot,
          status: "SCHEDULED",
          department: selectedDepartmentName,
          service: selectedServiceName,
        }
        const result = createBooking(current, candidate)
        if (result.ok) storeAppointments(result.records)
        return result
      })
      setAppointments(outcome.records)
      if (!outcome.ok) { setError(conflictMessage(outcome.reason)); return }
      setActiveAppointmentID(outcome.appointment.appointmentID)
      navigate("BookingSuccess")
    } catch { setError("Booking failed. Please try again.") }
    finally { setLoading(false) }
  }

  async function rescheduleAppointment() {
    if (!appointment || !replacementSlot || loading) return
    setLoading(true)
    setError(null)
    try {
      await waitForPrototypeRequest()
      const outcome = await withDemoWriteLock(() => {
        const current = latestAppointments()
        const result = rescheduleBooking(current, appointment.appointmentID, STUDENT_ID, replacementSlot)
        if (result.ok) storeAppointments(result.records)
        return result
      })
      setAppointments(outcome.records)
      if (!outcome.ok) { setError(conflictMessage(outcome.reason)); return }
      setReplacementSlotID("")
      setReplacementDate("")
      navigate("RescheduleSuccess")
    } catch { setError("Rescheduling failed. Your original time has been kept.") }
    finally { setLoading(false) }
  }

  async function cancelAppointment() {
    if (!appointment || loading) return
    setLoading(true)
    setError(null)
    try {
      await waitForPrototypeRequest()
      const outcome = await withDemoWriteLock(() => {
        const current = latestAppointments()
        const existing = current.find((record) => record.appointmentID === appointment.appointmentID)
        const result = cancelBooking(current, appointment.appointmentID, STUDENT_ID, existing ? isLate(existing.slot) : false)
        if (result.ok) storeAppointments(result.records)
        return result
      })
      setAppointments(outcome.records)
      if (!outcome.ok) { setError(conflictMessage(outcome.reason)); return }
      navigate("CancellationSuccess")
    } catch { setError("Cancellation failed. Your appointment is still scheduled.") }
    finally { setLoading(false) }
  }

  function resetBooking() {
    setSelectedSlotID("")
    setSelectedDate("")
    navigate("BookAppointment")
  }

  async function clearAllAppointments() {
    try {
    const remaining = await withDemoWriteLock(() => {
      const records = latestAppointments().filter((item) => item.studentID !== STUDENT_ID)
      clearStoredAppointments(records)
      return records
    })
    setAppointments(remaining)
    setActiveAppointmentID("")
    setDepartmentID("")
    setServiceID("")
    setSelectedDate("")
    setSelectedSlotID("")
    setReplacementSlotID("")
    setReplacementDate("")
    setResetOpen(false)
    navigate("BookAppointment")
    } catch { setError("Unable to clear saved appointments. Check browser storage settings.") }
  }

  const activeTab =
    screen === "BookAppointment" || screen === "ConfirmBooking" || screen === "BookingSuccess"
      ? "book"
      : "schedule"

  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-50 via-slate-100 to-slate-100 text-slate-900 antialiased">
      <div className="mx-auto flex min-h-screen max-w-[480px] flex-col bg-[#F7F9FC] shadow-2xl shadow-slate-900/10">
        <div className="flex-1">
          {screen === "BookAppointment" && (
            <section id="BookAppointment">
              <AppHeader title="Book an Appointment" />
              <div className="space-y-6 px-5 py-5">
                {error && <Notice tone="error">{error}</Notice>}
                <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-600 p-5 text-white shadow-lg shadow-blue-200">
                  <div className="absolute -right-7 -top-8 size-32 rounded-full border border-white/15" aria-hidden="true" />
                  <div className="absolute right-4 top-5 flex size-10 items-center justify-center rounded-2xl bg-white/15">
                    <Icon name="sparkles" className="size-5" />
                  </div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-100">Academic support</p>
                  <h2 className="mt-2 max-w-[250px] text-2xl font-extrabold leading-7">Make time for progress.</h2>
                  <p className="mt-2 max-w-[280px] text-sm leading-6 text-blue-100">Find a tutor or advisor and book a time that works for you.</p>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60">
                  <SectionTitle index="01" title="Choose your support" subtitle="Select a department and the service you need." />
                  <div className="space-y-4">
                    <label className="block">
                      <span className="mb-2 block text-xs font-bold text-slate-700">Department</span>
                      <select value={departmentID}
                        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                          setDepartmentID(event.target.value)
                          setServiceID("")
                          setSelectedDate("")
                          setSelectedSlotID("")
                          setError(null)
                        }}
                        className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100">
                        <option value="">Choose a department</option>
                        {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs font-bold text-slate-700">Service</span>
                      <select value={serviceID} disabled={!departmentID}
                        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                          setServiceID(event.target.value)
                          setSelectedDate("")
                          setSelectedSlotID("")
                          setError(null)
                        }}
                        className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400">
                        <option value="">Choose a service</option>
                        {filteredServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                      </select>
                    </label>
                  </div>
                </div>

                {serviceID && (
                  <fieldset className="min-w-0">
                    <legend className="sr-only">Available dates</legend>
                    <SectionTitle index="02" title="Pick a date" subtitle="Swipe to see dates with open appointments." />
                    {availableBookingDates.length === 0 ? (
                      <p role="status" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                        No dates are currently available for this service. Please try another service.
                      </p>
                    ) : (
                      <DateStrip dates={availableBookingDates} selected={selectedDate}
                        onSelect={(date) => { setSelectedDate(date); setSelectedSlotID(""); setError(null) }}
                        countForDate={(date) => slots.filter((slot) => slot.departmentID === departmentID && slot.serviceID === serviceID && slot.date === date && isFutureSlot(slot) && availableForStudent(slot, STUDENT_ID, appointments)).length} />
                    )}
                  </fieldset>
                )}

                {selectedDate && (
                  <fieldset className="min-w-0">
                    <legend className="sr-only">Available times</legend>
                    <SectionTitle index="03" title="Choose a time" subtitle={displayDate(selectedDate)} />
                    <div className="grid gap-2.5">
                      {availableSlots.length === 0 && (
                        <p role="status" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                          No times left for this date. Try another date or manage your existing appointment.
                        </p>
                      )}
                      {availableSlots.map((slot) => <TimeOption key={slot.slotID} slot={slot}
                        selected={selectedSlotID === slot.slotID}
                        onSelect={() => { setSelectedSlotID(slot.slotID); setError(null) }} />)}
                    </div>
                    {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
                  </fieldset>
                )}

                <div className="space-y-2 rounded-3xl bg-white p-3 shadow-sm shadow-slate-200/40">
                  <Button disabled={!departmentID || !serviceID || !selectedSlot || bookingConflict(selectedSlot, STUDENT_ID, appointments) !== null}
                    onClick={() => navigate("ConfirmBooking")}>Review Appointment</Button>
                  <Button variant="link" onClick={() => navigate("MySchedule")}>View My Schedule</Button>
                </div>
              </div>
            </section>
          )}

          {screen === "ConfirmBooking" && selectedSlot && (
            <section id="ConfirmBooking">
              <AppHeader title="Review Appointment" backLabel="Back to appointment search" onBack={() => navigate("BookAppointment")} />
              <div className="space-y-5 px-5 py-5">
                <div className="rounded-2xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">Step 2 of 2 · Review your appointment details</div>
                <DetailCard
                  title="Appointment Details"
                  slot={selectedSlot}
                  department={selectedDepartmentName}
                  service={selectedServiceName}
                />
                {bookingConflict(selectedSlot, STUDENT_ID, appointments) !== null && (
                  <Notice tone="error">{conflictMessage(bookingConflict(selectedSlot, STUDENT_ID, appointments)!)}</Notice>
                )}
                {error && <Notice tone="error">{error}</Notice>}
                <div className="space-y-2">
                  <Button onClick={bookAppointment} disabled={bookingConflict(selectedSlot, STUDENT_ID, appointments) !== null} loading={loading} loadingLabel="Checking availability…">
                    Confirm Booking
                  </Button>
                  <Button variant="outline" disabled={loading} onClick={() => navigate("BookAppointment")}>
                    Change Time
                  </Button>
                </div>
              </div>
            </section>
          )}

          {screen === "BookingSuccess" && appointment && (
            <section id="BookingSuccess" aria-live="polite">
              <AppHeader title="Booking Confirmed" />
              <div className="space-y-6 px-5 py-7 text-center">
                <SuccessIcon label="Appointment successfully booked" />
                <div>
                  <h2 className="text-2xl font-bold">Appointment confirmed</h2>
                  <p className="mt-2 text-base text-slate-600">Your appointment has been scheduled.</p>
                </div>
                <div className="text-left">
                  <DetailCard title="Booking Summary" slot={appointment.slot} appointmentID={appointment.appointmentID}
                    status={appointment.status} department={appointment.department} service={appointment.service} />
                </div>
                <Button onClick={() => navigate("MySchedule")}>Go to My Schedule</Button>
              </div>
            </section>
          )}

          {screen === "MySchedule" && (
            <section id="MySchedule">
              <AppHeader title="My Schedule" />
              {error && <div className="px-5 pt-4"><Notice tone="error">{error}</Notice></div>}
              <div className="space-y-6 px-5 py-5">
                <div className="rounded-3xl border border-blue-100 bg-gradient-to-br from-white to-blue-50 p-5 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-600">Your appointments</p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <h2 className="text-[22px] font-extrabold text-slate-900">Stay on track.</h2>
                    <div className="flex size-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
                      <Icon name="calendar" className="size-6" />
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {sortedAppointments.filter((item) => activeStatus(item.status)).length === 0
                      ? "No upcoming sessions right now."
                      : `${sortedAppointments.filter((item) => activeStatus(item.status)).length} upcoming ${sortedAppointments.filter((item) => activeStatus(item.status)).length === 1 ? "session" : "sessions"} on your calendar.`}
                  </p>
                </div>

                {sortedAppointments.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-9 text-center">
                    <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                      <Icon name="calendar" className="size-7" />
                    </div>
                    <h2 className="mt-4 text-lg font-extrabold">Nothing booked yet</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-500">Your confirmed tutoring and advising appointments will appear here.</p>
                  </div>
                ) : (
                  <>
                    {sortedAppointments.some((item) => activeStatus(item.status)) && (
                      <section aria-label="Upcoming appointments">
                        <h2 className="mb-3 text-[15px] font-extrabold text-slate-900">Upcoming appointments</h2>
                        <div className="space-y-3">
                          {sortedAppointments.filter((item) => activeStatus(item.status)).map((item) => (
                            <ScheduleCard key={item.appointmentID} item={item}
                              onModify={() => { setActiveAppointmentID(item.appointmentID); setModifyOpen(true) }} />
                          ))}
                        </div>
                      </section>
                    )}
                    {sortedAppointments.some((item) => !activeStatus(item.status)) && (
                      <section aria-label="Appointment history">
                        <h2 className="mb-3 text-[15px] font-extrabold text-slate-900">Appointment history</h2>
                        <div className="space-y-3">
                          {sortedAppointments.filter((item) => !activeStatus(item.status)).map((item) => (
                            <ScheduleCard key={item.appointmentID} item={item} onModify={() => {}} />
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                )}

                <Button onClick={resetBooking}>Book Another Appointment</Button>
                {appointments.some((item) => item.studentID === STUDENT_ID) && (
                  <div className="border-t border-slate-200 pt-5">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Demo controls</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Reset your saved appointments when you want to start a fresh test.</p>
                    <button type="button" onClick={() => setResetOpen(true)}
                      className="mt-3 min-h-10 text-xs font-semibold text-red-600 underline underline-offset-4 transition hover:text-red-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200">
                      Clear All Appointments
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {screen === "PickNewSlot" && appointment && (
            <section id="PickNewSlot">
              <AppHeader title="Choose a New Time" backLabel="Back to my schedule" onBack={() => navigate("MySchedule")} />
              <div className="space-y-6 px-5 py-5">
                <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-extrabold text-slate-900">Your current appointment</h2>
                    <StatusBadge status={appointment.status} />
                  </div>
                  <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><Icon name="calendar" /></span>
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-slate-900">{appointment.slot.dateLabel}</p>
                      <p className="mt-1 text-xs text-slate-600">{appointment.slot.time} · {appointment.slot.provider}</p>
                    </div>
                  </div>
                </section>

                <fieldset className="min-w-0">
                  <legend className="sr-only">Choose a different date</legend>
                  <SectionTitle index="01" title="Pick a new date" subtitle="Only dates with available times are shown." />
                  {replacementDates.length === 0 ? (
                    <p role="status" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600">
                      No alternative appointments are available right now. Your original appointment is still scheduled.
                    </p>
                  ) : (
                    <DateStrip dates={replacementDates} selected={replacementDate}
                      onSelect={(date) => { setReplacementDate(date); setReplacementSlotID(""); setError(null) }}
                      countForDate={(date) => allReplacementSlots.filter((slot) => slot.date === date).length} />
                  )}
                </fieldset>

                {replacementDate && (
                  <fieldset className="min-w-0">
                    <legend className="sr-only">Available times</legend>
                    <SectionTitle index="02" title="Pick a new time" subtitle={displayDate(replacementDate)} />
                    <div className="grid gap-2.5">
                      {newSlotOptions.length === 0 && (
                        <p role="status" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                          No times left for this date. Choose another date; your original appointment remains reserved.
                        </p>
                      )}
                      {newSlotOptions.map((slot) => <TimeOption key={slot.slotID} slot={slot}
                        selected={replacementSlotID === slot.slotID}
                        onSelect={() => { setReplacementSlotID(slot.slotID); setError(null) }} />)}
                    </div>
                  </fieldset>
                )}

                {replacementSlot && newSlotOptions.some((slot) => slot.slotID === replacementSlotID) && (
                  <RescheduleComparison current={appointment.slot} proposed={replacementSlot} />
                )}
                {error && <Notice tone="error">{error}</Notice>}
                <div className="space-y-2 rounded-3xl bg-white p-3 shadow-sm">
                  <Button disabled={!replacementSlot || !newSlotOptions.some((slot) => slot.slotID === replacementSlotID) || !activeStatus(appointment.status)}
                    loading={loading} loadingLabel="Checking availability…" onClick={rescheduleAppointment}>Confirm Reschedule</Button>
                  <Button variant="outline" disabled={loading} onClick={() => navigate("MySchedule")}>Keep Current Appointment</Button>
                </div>
              </div>
            </section>
          )}

          {screen === "RescheduleSuccess" && appointment && (
            <section id="RescheduleSuccess" aria-live="polite">
              <AppHeader title="Appointment Updated" />
              <div className="space-y-6 px-5 py-7 text-center">
                <SuccessIcon label="Appointment successfully rescheduled" />
                <div>
                  <h2 className="text-2xl font-bold">Appointment rescheduled</h2>
                  <p className="mt-2 text-base text-slate-600">Your appointment status is now Rescheduled.</p>
                </div>
                <div className="text-left">
                  <DetailCard title="Updated Appointment Details" slot={appointment.slot} appointmentID={appointment.appointmentID}
                    status={appointment.status} department={appointment.department} service={appointment.service} />
                </div>
                <Button onClick={() => navigate("MySchedule")}>Go to My Schedule</Button>
              </div>
            </section>
          )}

          {screen === "ConfirmCancellation" && appointment && (
            <section id="ConfirmCancellation">
              <AppHeader title="Cancel Appointment" backLabel="Back to my schedule" onBack={() => navigate("MySchedule")} />
              <div className="space-y-5 p-4">
                <DetailCard title="Appointment to Cancel" slot={appointment.slot} appointmentID={appointment.appointmentID}
                  status={appointment.status} department={appointment.department} service={appointment.service} />
                {lateCancellation && (
                  <Notice tone="warning">This will be recorded as a late cancellation because the appointment starts in less than 2 hours.</Notice>
                )}
                {error && <Notice tone="error">{error}</Notice>}
                <div className="space-y-2">
                  <Button variant="danger" loading={loading} loadingLabel="Cancelling…" onClick={cancelAppointment}>Confirm Cancellation</Button>
                  <Button variant="outline" disabled={loading} onClick={() => navigate("MySchedule")}>Keep Appointment</Button>
                </div>
              </div>
            </section>
          )}

          {screen === "CancellationSuccess" && appointment && (
            <section id="CancellationSuccess" aria-live="polite">
              <AppHeader title="Cancellation Confirmed" />
              <div className="space-y-6 px-5 py-7 text-center">
                <SuccessIcon label="Appointment successfully cancelled" />
                <div>
                  <h2 className="text-2xl font-bold">Appointment cancelled</h2>
                  <p className="mt-2 text-base text-slate-600">
                    {appointment.status === "CANCELLED_LATE"
                      ? "Your appointment was cancelled and recorded as a late cancellation."
                      : "Your appointment has been cancelled."}
                  </p>
                </div>
                <div className="text-left">
                  <DetailCard title="Cancellation Summary" slot={appointment.slot} appointmentID={appointment.appointmentID}
                    status={appointment.status} department={appointment.department} service={appointment.service} />
                </div>
                <Button onClick={() => navigate("MySchedule")}>Go to My Schedule</Button>
              </div>
            </section>
          )}
        </div>

        <BottomTabs active={activeTab} onNavigate={navigate} />

        {modifyOpen && appointment && activeStatus(appointment.status) && (
          <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-950/40 p-4"
            role="presentation" onMouseDown={(event: MouseEvent<HTMLDivElement>) => { if (event.currentTarget === event.target) setModifyOpen(false) }}>
            <section role="dialog" aria-modal="true" aria-labelledby="modify-title"
              className="w-full max-w-[448px] rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl">
              <div className="mx-auto mb-5 h-1 w-12 rounded-full bg-slate-300" />
              <h2 id="modify-title" className="text-center text-xl font-bold">Modify Appointment</h2>
              <div className="mt-2 flex items-center justify-center gap-2">
                <span className="text-sm text-slate-500">Current status:</span><StatusBadge status={appointment.status} />
              </div>
              <p className="mt-3 text-center text-sm text-slate-600">Choose how you would like to manage this appointment.</p>
              <div className="mt-5 space-y-3">
                <Button onClick={() => { setReplacementSlotID(""); setReplacementDate(""); navigate("PickNewSlot") }}>Reschedule Appointment</Button>
                <Button variant="danger" onClick={() => navigate("ConfirmCancellation")}>Cancel Appointment</Button>
                <Button variant="link" onClick={() => setModifyOpen(false)}>Keep Appointment</Button>
              </div>
            </section>
          </div>
        )}

        {resetOpen && (
          <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-950/40 p-4" role="presentation"
            onMouseDown={(event: MouseEvent<HTMLDivElement>) => { if (event.currentTarget === event.target) setResetOpen(false) }}>
            <section role="dialog" aria-modal="true" aria-labelledby="reset-title"
              className="w-full max-w-[448px] rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl">
              <h2 id="reset-title" className="text-center text-xl font-bold">Start fresh?</h2>
              <p className="my-4 text-center text-sm leading-6 text-slate-600">
                This will remove all {appointments.length} saved demo appointment{appointments.length === 1 ? "" : "s"}, including cancelled history, and make every time slot available again. This cannot be undone.
              </p>
              <div className="space-y-3">
                <Button variant="danger" onClick={clearAllAppointments}>Erase All Appointments</Button>
                <Button variant="outline" onClick={() => setResetOpen(false)}>Keep My Appointments</Button>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  )
}