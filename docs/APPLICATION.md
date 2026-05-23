# MedBrige - Application for scheduling appointments with doctors

This is a PoC of an app that will allow users to schedule appointments with doctors quick and easy.

## Features

#### Authentication and Authorization

JWT with refresh tokens.
Two roles in the system:

- Doctor
- Patient

RBAC (Role-Based Access Control) support

#### Dashboard

- incoming appointments (all)
- slots free for current date (doctor)
- completed appointments (patient)

#### Doctor Features

- configure appointment slots
- view patient appointments
- write summaries of patient appointments
- manage his/hers profile (name, contact info, specializations)

#### Patient Features

- view doctor appointments
- edit medical records (add medications, known disises and conditions, alergis, medical documents)
- make an appointment with a doctor
- share medical documents for given appointment

## Technical

- file upload for medical documents: server directory in uploads/ allows: JPEG, PNG, PDF max 10 MB
- any deletion is soft deletion in the system for proper historical appointment trace
- monorepo via pnpm workspaces with two apps: ui and api

Tech stack:

- package manager: pnpm
- node version: 25
- general: typescript, zod v4
- ui: React, Vite, Tailwind v4, Tanstack Router, Tanstack Query, Shadcn UI
- api: Node.js, Hono, Postgresql, drizzle orm, drizzle kit
- deployment: local machine via docker compose

all libraries are latest stable versions

## Security

- hashed passwords with argon2
- JWT authentication with refresh tokens with rotation
- CSRF protection with double submit cookie
- session cookies are http-only and secure
- no real patient data
- all uploaded files have custom generated filenames (can be uuids) (old name is preserved in the database)

## PoC Trade-offs

- simplified auth - no sign up. Patients and Doctors will be seeded to the database
- once scheduled appointment is final, it cannot be canceled or rescheduled
- no in-app notifications
- no UI unit tests / integration tests
- no e2e testing

## UI

- WCAG 2 and AAA compliance
- views: Login, Dashboard, Doctor profile, Patient profile, Schedule Appointment form, Appointment details

### Scheduling Appointments Form

user must pick

- specialization (cardiologist, dermatologist, etc)
- doctor (from the list of available doctors for the given specialization) (optional)
- pick available appointment slot (if no doctor is selected system shows for all doctors of given specialization and if doctor is selected shows only slots for that doctor)
- share medical documents (user picks which documents to share)
- confirm step (user must confirm the appointment details before submitting)
- appointment is scheduled

## Testing

Only for app/api

- unit testing
- integration testing
