# Cockpit Enhancement Backlog — grounded in the 30/60/90 plan slides

Denise Marconi's *"30/60/90-Day Plan to Lead LATAM into the Agentic Era"* is organized around
**4 pillars** (Build Foundation, Attrition Prevention, Attrition Recovery, Consumption Booster)
plus **GTM 2.0, Delivery Excellence, and Talent**, each with **30/60/90-day actions, named owners,
and KPIs**. The current dashboard only tracks a flat activity list. These enhancements make the
cockpit mirror the plan's structure.

## Shipped in this build
1. **Owner "before Wednesday" to-do board** + Slack Monday reminder (core request).
2. **Executive KPI strip** and **pillar progress bars**.
3. **Urgency model** (overdue / blocked / due-before-meeting) driving sort, filter, and row color.

## Recommended next (high value, from the slides)
1. **30/60/90 horizon field** — the plan is phased. Add a `horizon` (30/60/90) tag per activity and a
   swimlane view. Lets Denise see "what must land in the next 30 days" at a glance.
2. **KPI tracking per pillar** — slide 10 lists concrete KPIs (e.g. *Services Attach Rate, Joint Win Rate,
   ARI backlog, Flex Credit consumption %, Cycle-time reduction*). Add a KPI object with baseline/target/
   current so the cockpit shows outcome trends, not just task status.
3. **Pillar owners + ELT view** — slides name pillar owners (Robin Gray & Julian Mesa; Mariano Butti;
   Cleri Inhauser & L. Ventura; Cleri Inhauser & Claudio Salas). Show a per-owner accountability roll-up.
4. **"Quick wins / ✅ done this phase" feed** — slides highlight completed wins (25% efficiency default,
   White-Label Telco, TV Azteca Phase 2). A momentum/wins panel is good for exec storytelling.
5. **Mexico focus flag** — Attrition Prevention centers on Mexico pilots (Freeway, TS4). A country tag +
   filter would surface geo-specific risk.
6. **Escalation / help-needed → Slack** — items with "Help Needed" could auto-notify Denise or a channel,
   not just the owner. (`SLACK_SUMMARY_CHANNEL` already posts a weekly send summary — extend it.)
7. **Consumption / $ tracking** — several items carry dollar figures (~$13M pending SOWs, Flex Credit).
   A currency field enables a pipeline/at-risk value tile.
8. **Weekly snapshot history** — persist a Monday snapshot to chart progress week-over-week (needs a DB).

## Data-quality note
The seeded data has a duplicate owner spelling — **"Cleri Inhauser"** vs **"Cleri inhauser"** — which
splits her in owner rollups/Slack. Normalize on import (the app already trims; add case-folding on the
canonical owner list, or fix the two records).
