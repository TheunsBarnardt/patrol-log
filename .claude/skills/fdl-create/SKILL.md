---
name: fdl-create
description: Create a new FDL blueprint from a feature description
user_invocable: true
command: fdl-create
arguments: "<feature-name> [category]"
---

# FDL Create — Blueprint Authoring Skill

Create a new FDL blueprint by having a conversation with the user. The user does NOT need to know YAML or the FDL schema — ask plain-language questions, offer smart defaults, and generate everything behind the scenes.

## Usage

```
/fdl-create checkout payment
/fdl-create file-upload data
/fdl-create expense-approval workflow
/fdl-create roles access
```

## Arguments

- `<feature-name>` — Kebab-case feature identifier (e.g., `checkout`, `file-upload`)
- `[category]` — Optional. One of: auth, data, access, ui, integration, notification, payment, workflow. If omitted, infer or ask.

## Core Principle: The User Knows NOTHING About YAML

- NEVER show YAML to the user during the conversation
- NEVER ask the user to "define flows" or "specify validation rules"
- NEVER use FDL jargon (fields, outcomes, events, etc.) — use plain language
- DO use the AskUserQuestion tool to present choices
- DO offer smart defaults based on domain knowledge
- DO summarize what you'll create in plain-English bullet points
- DO generate the YAML silently and just show the final summary

## Workflow

### Phase 0: Socratic Elicitation (only when the input is vague)

**When to use:** The user gave you a feature name with no context, or said something like "help me think through X", or a previous skill (`/fdl-brainstorm`) handed off to you with an open-ended idea.

**When to SKIP:** The user gave a clear, specific feature name with known domain (e.g., `/fdl-create checkout payment` — you already know what checkout does). Skipping is correct 90% of the time. Do NOT interrogate users who already know what they want.

**Borrowed from the Superpowers `brainstorming` skill, re-bound to produce a blueprint (not a markdown design doc). The terminal state is always a validated `.blueprint.yaml` file.**

Run these steps in order, **one question at a time**, never in a batch:

1. **Explore context first** — Glob `blueprints/**/*.blueprint.yaml` to see what already exists. If a similar blueprint exists, tell the user: "There's already a `{existing}` blueprint that covers X — should this be a variant, or something distinct?"

2. **Purpose question** — "What problem does this feature solve for the user?" Listen for the core outcome, not the mechanism.

3. **Constraints question** — "What must be true for this to be considered done?" This surfaces success criteria that become `outcomes[].given` and `outcomes[].result`.

4. **Failure-mode question** — "What should happen when things go wrong? (Invalid input, rate limit, permissions, external service down, ...)" Every blueprint MUST model failure paths — the completeness checker will reject blueprints with no failure outcomes.

5. **Propose 2-3 approaches with trade-offs** — Don't jump to a single design. Example:
   > "There are a few ways to model this:
   >  - **A. Simple CRUD** — one outcome per operation, no state machine. Good if lifecycle is trivial.
   >  - **B. State machine** — add `states:` with transitions and actors. Good if there's a meaningful lifecycle (draft → submitted → approved).
   >  - **C. Workflow** — add `actors:` and `flows:` for human-driven steps. Good if approvals are involved.
   >
   > My recommendation is **B** because you mentioned approvals. Which fits your mental model?"

6. **Present the blueprint design as sections, iteratively** — Not one giant dump. Walk through:
   - Data (what becomes `fields:`)
   - Success outcomes (what becomes `outcomes.success_*`)
   - Failure outcomes (what becomes `outcomes.failure_*` with bound `error:` codes)
   - Security rules (what becomes `rules.security`)
   - Related blueprints (what becomes `related:`)
   Wait for acknowledgment after each section before moving on.

7. **HARD GATE — no YAML written until user approves the full design.** This is non-negotiable. If the user wants to change something, loop back to step 6 for that section only.

8. **Generate the blueprint YAML silently** (see Phase 3 below). Output is a validated `.blueprint.yaml` file, not a markdown design doc.

### Phase 1: Understand the Feature (1-2 questions max)

If the user gave a clear feature name (e.g., `/fdl-create checkout payment`), use domain knowledge to fill in most details. Only ask what you genuinely don't know.

**Use AskUserQuestion with options like:**

Question 1 — Scope (only if unclear):
"What should the checkout feature handle?"
- Options: "Simple one-time payment", "Subscription/recurring billing", "Multi-step with cart review", etc.

Question 2 — Users (only if unclear):
"Who uses this feature?"
- Options: "Any visitor (public)", "Logged-in users only", "Admin/staff only", "Multiple roles"

**DO NOT ask more than 2 questions in Phase 1.** Use domain knowledge for everything else.

### Phase 2: Present Smart Defaults (confirmation, not interrogation)

Based on the feature name, category, and your domain knowledge, draft the full blueprint internally. Then present a plain-English summary for confirmation:

```
Here's what I'll create for the checkout feature:

DATA IT COLLECTS:
  - Payment method (card token from Stripe/payment provider)
  - Billing amount and currency
  - Billing address (street, city, state, zip, country)

WHAT SHOULD HAPPEN:
  ✓ Successful payment → order confirmed, receipt emailed, redirect to confirmation page
  ✗ Card declined → show "Payment was declined, please try another card"
  ✗ Insufficient funds → same message (don't reveal the specific reason)
  ✗ Payment provider down → show "Unable to process payment, please try again"
  ✗ Too many attempts → rate limit (10 per hour per user)

SECURITY:
  - Requires login
  - Card details never touch our server (tokenized via Stripe)
  - Rate limited to prevent abuse
  - Amount validated server-side (can't be modified by client)

CONNECTS TO:
  - Cart (required) — needs items to check out
  - Login (required) — must be authenticated
  - Order history (recommended) — view past orders

Want me to adjust anything, or should I create it?
```

**Use AskUserQuestion:** "Does this look right?"
- "Yes, create it" (proceed)
- "I want to change something" (ask what)
- "Add more detail" (ask which area)

### Phase 3: Generate Silently

**Terminal state rule (non-negotiable):** The only acceptable output of this skill is a validated `.blueprint.yaml` file. Not a markdown spec. Not a task list. Not a design doc. If you cannot produce a blueprint that passes BOTH `node scripts/validate.js` AND `node scripts/completeness-check.js`, the skill has failed — ask the user for more information rather than writing a placeholder blueprint.

1. **Check existing blueprints** — Glob for `blueprints/**/*.blueprint.yaml`, ensure no duplicate
2. **Generate the blueprint YAML** with ALL sections:
   - `feature`, `version`, `description`, `category`, `tags`
   - `fields` — with name, type, required, label, placeholder, validation
   - `rules` — business logic, security, rate limiting
   - Use RFC 2119 prefixes: `MUST:` for non-negotiable (security, data integrity), `SHOULD:` for best practice, `MAY:` for optional enhancements
   - `outcomes` — given/then/result for each scenario (preferred over flows for AI code gen)
   - `flows` — step-by-step procedures ONLY if the feature involves human actors or business processes
   - `errors` — UPPER_SNAKE_CASE codes with user-safe messages
   - `events` — dot.notation names with payloads
   - `actors` — only if multiple roles are involved
   - `states` — only if there's a lifecycle/status field
   - `sla` — only if there are time constraints
   - `related` — connections to existing blueprints
   - `ui_hints` — layout, field order, accessibility
   - `agi` — **consider adding** an AGI-readiness section for blueprints in these categories:
     - `ai` — always include (autonomous agents need goals, safety, coordination)
     - `workflow` — include if the feature involves autonomous execution, approvals, or escalation
     - `integration` — include if the feature processes untrusted external input (webhooks, APIs)
     - `data` — include if the feature involves financial transactions or compliance-sensitive operations
     - For other categories, only include `agi` if the feature has significant autonomous behavior or safety implications
     - When including `agi`, add at minimum: `goals` (with success_metrics), `autonomy` (with level and human_checkpoints), and `safety` (with action_permissions). Add other sub-sections as relevant.
3. **Write the file** to `blueprints/{category}/{feature}.blueprint.yaml`
4. **Validate structure** — run `node scripts/validate.js blueprints/{category}/{feature}.blueprint.yaml`
5. **Validate completeness** — run `node scripts/completeness-check.js blueprints/{category}/{feature}.blueprint.yaml` (catches placeholders, empty outcomes, dangling error refs)
6. **Fix any errors** silently and re-run both checks. Do NOT consider the skill complete until both pass with zero errors.

### Phase 4: Show Summary

Show a clean summary (no YAML):

```
Created: blueprints/payment/checkout.blueprint.yaml

  checkout v1.0.0 — Process a payment for items in the cart

  Data:      4 fields (payment_token, amount, currency, billing_address)
  Outcomes:  4 scenarios (success, card declined, provider error, rate limited)
  Security:  Auth required, rate limited, tokenized payments
  Events:    3 (checkout.success, checkout.failed, checkout.refunded)
  Connects:  cart (required), login (required), order-history (recommended)

  Validation: PASS ✓

  Next: Run /fdl-generate checkout nextjs to create the code
```

### Phase 5: Update Related Blueprints

If existing blueprints should reference this new feature:
1. Tell the user: "The login blueprint should reference checkout — want me to add that?"
2. On confirmation, add the `related` entry to the existing blueprint

## Outcomes Format (use this instead of flows for code generation)

When generating the blueprint, prefer `outcomes` over `flows`:

```yaml
outcomes:
  successful_checkout:
    given:
      - user is authenticated
      - cart has at least one item
      - payment token is valid
      - billing address is complete
      - amount matches server-calculated total
    then:
      - payment is charged via provider
      - order record is created with status "confirmed"
      - cart is cleared
      - confirmation email is sent
      - checkout.success event is emitted
    result: redirect to order confirmation page

  card_declined:
    given:
      - payment provider returns decline
    then:
      - checkout.failed event is emitted
      - no order is created
    result: show "Payment was declined. Please try another payment method."
```

## When to Include `flows` Alongside `outcomes`

Include BOTH `outcomes` AND `flows` when:
- The feature involves **human actors** performing manual steps (approvals, reviews)
- The feature is a **business process** that needs to be documented as a procedure
- The category is `workflow`

For pure technical features (login, checkout, CRUD), `outcomes` alone is sufficient.

## Quality Checklist (internal — don't show to user)

### Security & Data Protection (POPIA)
- [ ] Public features have rate limiting
- [ ] Sensitive fields marked `sensitive: true`
- [ ] Error messages don't leak internal state
- [ ] Auth requirements specified in rules
- [ ] **NO real API keys, tokens, passwords, or PII in field examples, descriptions, rules, or anywhere**
- [ ] **NO real connection strings, URLs with credentials, or private keys**
- [ ] Use fake placeholders: `"example@test.com"`, `"sk-test-key-not-real"`, `"<api-key>"`
- [ ] Field validation patterns described WITHOUT real data samples

### Rule Strength (RFC 2119)
- [ ] Security-critical rules are prefixed `MUST:` (hashing, auth checks, input validation)
- [ ] Best-practice rules are prefixed `SHOULD:` (logging, rate limiting, audit trails)
- [ ] Optional enhancements are prefixed `MAY:` (notifications, analytics, caching)
- [ ] Rules without a prefix are treated as `SHOULD:` by code generators

### Completeness
- [ ] Every success scenario has an outcome
- [ ] Every failure scenario has an outcome
- [ ] Every error has a code, status, and message
- [ ] Related features are identified
- [ ] Events cover success AND failure

### Conventions
- [ ] Feature name: kebab-case
- [ ] Field names: snake_case
- [ ] Error codes: UPPER_SNAKE_CASE
- [ ] Event names: dot.notation
- [ ] Actor IDs: snake_case
- [ ] Comments explain WHY, not WHAT

## Example: What a Good Outcome Looks Like

**User says:** `/fdl-create file-upload data`

**You ask (Phase 1):**
"What kind of files will users upload?"
- Profile pictures / avatars
- Documents (PDF, Word, etc.)
- Any file type
- Mixed (images + documents)

**You present (Phase 2):**
```
Here's what I'll create for file upload:

DATA IT NEEDS:
  - The file itself (max 10MB, accepts images + PDFs)
  - An optional description/label for the file
  - Which record this file belongs to (e.g., user profile, expense report)

WHAT SHOULD HAPPEN:
  ✓ File uploaded → validated, stored, thumbnail generated (for images), linked to record
  ✗ File too large → "File must be under 10MB"
  ✗ Wrong file type → "Only images and PDFs are accepted"
  ✗ Upload fails → "Upload failed, please try again"
  ✗ Storage full → "Unable to store file, please contact support"

SECURITY:
  - File content is validated (not just extension — check magic bytes)
  - Filenames are sanitized (prevent path traversal)
  - Files stored outside webroot (no direct URL access)
  - Virus/malware scanning (optional, recommended)
  - Rate limited: 20 uploads per hour per user

CONNECTS TO:
  - Login (required) — must be authenticated
  - Any feature that accepts attachments

Want me to adjust anything?
```

**You generate (Phase 3):** A complete blueprint with outcomes like:

```yaml
outcomes:
  successful_upload:
    given:
      - user is authenticated
      - file size is under max_size_mb (10MB)
      - file MIME type matches allowed_types (validated via magic bytes, not just extension)
      - filename is sanitized (no path traversal characters)
      - user has not exceeded upload rate limit (20/hour)
    then:
      - file is stored in configured storage backend (local, S3, etc.)
      - file record is created with original_name, stored_path, size, mime_type, uploaded_by
      - if image, thumbnail is generated at configured dimensions
      - file_upload.success event is emitted
    result: return file record with ID and URL

  file_too_large:
    given:
      - file size exceeds max_size_mb
    result: show "File must be under 10MB"
```

Notice: the outcomes describe WHAT must be true, not HOW to implement it. The code generator decides whether to use multer, busboy, S3 SDK, etc.
