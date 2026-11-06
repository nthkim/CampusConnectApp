# CampusBook

CampusBook is a student appointment booking prototype built with React and TypeScript (TSX).

## Features
### Feature A: Book an Appointment
* **How it works:** 
  1. Pick a subject (e.g., *Information Technology*).
  2. Pick an open date and time slot.
  3. Review the summary page and conflict check.
  4. Click **Confirm** to lock in your booking.
* **How to test:** Refresh the browser page and go to **My Activity**—your booked session will still be saved.

### Feature B: Reschedule & Cancel Sessions
* **How it works:** 
  1. Go to **My Schedule** and select an active appointment.
  2. Choose **Cancel** or **Reschedule**.
  3. **Cancel:** Updates status to `CANCELLED` and opens the slot for others.
  4. **Reschedule:** Swaps your old slot for a new available time.
* **How to test:** After canceling or rescheduling, refresh the page to confirm your updated schedule persists.
* **Error test:** Select an unavailable slot during rescheduling to see the instant conflict alert.
## Where to Find the Code

The main source code is located in:

**`App.tsx`**

You can find it in this GitHub repository by clicking the `App.tsx` file.

## How to View the Project

1. Download or copy the `App.tsx` file.
2. Open a project in **Figma Make**.
3. Open the code editor and locate `App.tsx`.
4. Replace its contents with the CampusBook code.
5. Open the preview to interact with the prototype.

The project requires a React environment with Tailwind CSS support.

## Note

CampusBook is a classroom prototype, not a production booking system. Appointments are saved locally in the browser rather than in a shared database.
