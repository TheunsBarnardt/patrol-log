# FDL — AI Feature Definition Language

This project uses **ai-fdl-kit** for feature specifications. Blueprints are YAML files defining software features as acceptance criteria, fields, rules, and error codes — independent of any tech stack.

## Blueprint source

Local blueprints in the `blueprints/` directory of this project (prefer local; fall back to remote).

## How to find a blueprint

**Local:** `blueprints/{category}/{feature}.blueprint.yaml`
Categories: auth, data, access, ui, integration, notification, payment, workflow, inventory, manufacturing, crm, asset, project, quality, procurement, ai, trading, infrastructure, observability

**Remote fallback:**
1. `GET https://theunsbarnardt.github.io/ai-fdl-kit/api/registry.json` — list all blueprints
2. `GET https://theunsbarnardt.github.io/ai-fdl-kit/api/blueprints/{category}/{feature}.json` — fetch a specific one

## How to generate code from a blueprint

1. Load the blueprint (local or remote)
2. Read `outcomes` — acceptance criteria, sorted by `priority` (lower = checked first)
3. Read `rules` — constraints (security, business logic) — `MUST:` > `SHOULD:` > `MAY:`
4. Read `fields` — data model
5. Read `errors` — error responses with user-safe messages
6. Generate code that satisfies ALL outcomes for the target framework

## Priority = execution order
Lower priority number = checked first (guard clauses). Higher = success path.

## Structured conditions
- `source: input` — request body
- `source: db` — database lookup
- `source: session` — authenticated session state
- `any:` — OR group (at least one must match)
- Top-level `given[]` items are AND

## Structured side effects
- `action: set_field` — update field/variable
- `action: emit_event` — publish event
- `action: transition_state` — state-machine move
- `action: create_record` / `delete_record` — DB write
- `action: call_service` — external call

## Terminal discipline
When authoring new blueprints:
- Every blueprint MUST validate against the schema AND pass the completeness check
- No placeholder text (TODO, TBD, "fill this in")
- Every outcome bound to an `error:` must reference a code in `errors[]`
- Every blueprint must model both success and failure outcomes

See https://github.com/TheunsBarnardt/ai-fdl-kit for the full specification.

