---
slug: a11y-aaa-checklist
title: "WCAG 2.2 AAA accessibility review and committed checklist"
primary_users: ["patient","doctor"]
depends_on: ["seed-and-deployment-smoke"]
estimated_task_count: 9
---

# WCAG 2.2 AAA accessibility review and committed checklist

## Summary

Performs the AAA compliance pass across every shipped view (Login, Dashboard, Doctor Profile, Patient Profile, Schedule Appointment, Appointment Details), fixes any failures, and commits .planning/a11y/CHECKLIST.md with every criterion marked pass.

## Scope

- Committed .planning/a11y/CHECKLIST.md template enumerating each shipped view × each WCAG 2.2 AAA success criterion
- Manual review of every shipped view against the checklist; remediation of any failing criterion
- Body-text contrast ≥ 7:1 and large-text contrast ≥ 4.5:1 verified per view
- Focus-order, focus-ring, no-focus-trap, Esc-dismisses-modal verification per view
- Programmatic labelling (label[for] or aria-labelledby), aria-describedby + role=alert on error states verified per view
- Keyboard-only walkthrough of the multi-step Schedule Appointment flow with step-transition announcements


## Out of scope

- Automated a11y test suite (brief §8 freezes UI tests; this is a manual review pass)
- Mobile-screen-reader audits (responsive Tailwind defaults only)
- Internationalisation / RTL audits
- Re-themable design tokens / dark-mode AAA pass


## Acceptance bullets

- .planning/a11y/CHECKLIST.md exists and lists every shipped view (Login, Dashboard, Doctor Profile, Patient Profile, Schedule Appointment, Appointment Details) × every WCAG 2.2 AAA success criterion with an explicit pass/fail marker per cell.
- Every criterion in the committed checklist is marked pass; no fail or skip markers remain (asserted by a grep over the file in CI or the smoke script).
- An automated contrast spot-check (e.g. a small node script reading the committed Tailwind tokens) confirms body-text contrast ratio ≥ 7:1 and large-text ratio ≥ 4.5:1 against the app's actual background tokens.
- Every form on every shipped view has each input bound to a programmatic label and every error region has role="alert" plus aria-describedby on the relevant input — verified by a DOM-scrape integration test rendering each view with a deliberate validation error.
- Every modal/dropdown component on every shipped view dismisses on Esc and returns focus to its trigger — confirmed by the keyboard walkthrough notes attached to the checklist commit.
- The Schedule Appointment multi-step flow's step transitions are announced via an aria-live region — verified by a DOM-scrape test against the route at each step.

