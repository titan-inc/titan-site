# Discord Apply Flow Specification

> **Status: IMPLEMENTED on 09/08/2026.**
> Written 09/08/2026 against commit `2365745`, which is identical to `origin/main`.
> The target statements below record the behavior implemented from this specification.
>
> The repository's working language is Portuguese: code comments, `CLAUDE.md` and the
> other `docs/` files are in Portuguese and must stay that way. This spec is in English
> because its structure was dictated in English; **code and comments written from it must
> be in Portuguese**, matching the surrounding files.

---

## 1. Objective

Replace the _planned_ database-backed application pipeline with a stateless one: the public
Apply form posts to the Nest API, the API validates and sanitizes, the API delivers one
formatted message to a single configured Discord channel, and **nothing is persisted**.

### The single most important finding of this review

**There is no persistence to remove.** The database-backed apply architecture was designed
but never built. Verified across every ref in the repository:

- `apps/api/src/applications/` **has never existed in any commit** (`git log --all --diff-filter=A`)
- no `model Application` in `apps/api/prisma/schema.prisma`, and none in any branch
- no application-related migration among the 10 in `apps/api/prisma/migrations/`
- no repository, service, controller, DTO, seed or fixture
- no admin UI that reads applications

So this change is **not a removal of working code**. It is:

1. a **greenfield build** of the Discord delivery path (sections 8, 9, 13, 14, 15);
2. a **small cleanup** of contract leftovers in `packages/shared` and one UI teaser
   (sections 11, 12, 18);
3. a **documentation correction**, which is where the old architecture actually lives —
   `CLAUDE.md` describes the stored-application model as settled fact in four places
   (section 17).

That makes the change far cheaper than the request assumes, and it removes the entire class
of risk around migration-history rewriting: there is no history to rewrite.

### The tradeoff this decision accepts

Removing persistence contradicts a rule the project wrote down deliberately. `CLAUDE.md`
Regra 7 says _"O que é durável, guarda (site)"_ and _"Gravar vem antes de exibir… semana não
gravada não volta."_ Under the target architecture, if Discord is unreachable at the moment
someone submits, **that application is gone** — there is no record, no retry queue, nothing
to replay.

This is a legitimate product decision (a guild that recruits through Discord anyway does not
need a second inbox), but it must be made with eyes open, and it is why section 15 requires
the failure path to tell the applicant honestly that the submission did **not** go through.
Section 21 lists the deferred mitigation. Per the repository's own convention, the reversal
is recorded rather than erased — see the `CLAUDE.md` edit in section 17.

---

## 2. Current State

### 2.1 Frontend

| File                                            | Role                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| `apps/web/app/page.tsx`                         | landing; renders `<Apply />`                                          |
| `apps/web/app/_components/apply/apply.tsx`      | `<section id="candidatura">` wrapper: heading, copy, visual treatment |
| `apps/web/app/_components/apply/apply-form.tsx` | the form itself — **the only file that changes for submission**       |
| `apps/web/app/_components/apply/campo.tsx`      | presentational field wrapper (label, help text, error)                |
| `apps/web/lib/config.ts`                        | exports `API_URL` (client-safe)                                       |

There is **no `/apply` route**. The form is a section of the home page, reached by the
`#candidatura` anchor. (Linear TIT-15 describes a `/apply` route; the landing work chose a
section instead. Not in scope to change.)

Current behavior of `apply-form.tsx`:

- validates on blur (`validarAoSair`, line 21) and on submit (`submeter`, line 35) using
  `createApplicationSchema` from `@titan/shared`
- collects values through `dados()` (line 9) from a `FormData`
- keeps errors in `useState<Record<string, string>>`, rendered in a `role="alert"` block
- focuses the first invalid field (line 50)
- **on successful validation it does not submit.** Lines 39-44 set
  `erros.envio = 'O envio pelo site ainda não está aberto. Seus dados não foram enviados.'`
- the submit button is `disabled` (line 126) and described by a `<Chapa>` note saying
  submission is not open (lines 117-122)

So the form is fully built and honest about the missing backend.

### 2.2 Backend

**Nothing.** There is no applications controller, service, repository or module.
`grep -ri application apps/api/src` returns only `application/json` in outbound HTTP headers.
`app.module.ts` registers 13 modules; none is recruitment-related.

Relevant existing infrastructure the new code should reuse:

| File                                         | What it gives us                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/api/src/common/zod-validation.pipe.ts` | validates a body against a shared Zod schema; returns 400 with `{ message, issues: [{ path, message }] }` |
| `apps/api/src/config/guild.config.ts`        | the established config pattern: a `load…Config()` function that throws loudly on bad values               |
| `apps/api/src/blizzard/blizzard.service.ts`  | the outbound-HTTP pattern: global `fetch` + `AbortSignal.timeout(…)`, no axios, no `@nestjs/axios`        |
| `apps/api/src/main.ts`                       | CORS with `origin: WEB_URL, credentials: true`; `cookie-parser`                                           |

### 2.3 Shared contract

`packages/shared/src/application.ts`:

```ts
export const createApplicationSchema = z.object({
  characterRealm: z.string().min(2).max(80),
  roleSpec: z.string().min(2).max(80),
  contact: z.string().min(2).max(100),
  additionalInfo: z.string().max(2000).optional(),
  website: z.string().max(0).optional(), // honeypot
});
export type CreateApplication = z.infer<typeof createApplicationSchema>;

export const APPLICATION_STATUSES = ['pending', 'reviewing', 'accepted', 'rejected'] as const;
export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;
```

`APPLICATION_STATUSES` and everything derived from it have **zero consumers** anywhere in the
repository. They exist only for the review workflow that is now cancelled.

`packages/shared/src/application.spec.ts` (vitest) covers required fields, max lengths and the
honeypot.

History worth knowing: commit `38c1dd5` (06/08/2026, _"refactor(apply): simplify recruitment
intake"_) deliberately replaced a richer schema — `character: characterInputSchema`, `class`,
`mainRole`, `offRole`, availability days — with the four flat fields above, and shrank the
form by 171 lines. The earlier shape survives on the stale `origin/leonardodasilveira/tit-44-*`
branches. **Do not restore it**; see section 6.

### 2.4 Permission and internal UI

| File                                           | Line    | What it does                                                                             |
| ---------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `packages/shared/src/membership.ts`            | 163     | `canReviewApplications()` — delegates to `isActingOfficer()`                             |
| `packages/shared/src/membership.spec.ts`       | 75-95   | four tests for it                                                                        |
| `apps/api/src/internal/internal.controller.ts` | 11, 39  | exposes `canReviewApplications` in `GET /internal/summary`                               |
| `apps/web/lib/api.ts`                          | 69      | mirrors the field in the `InternalSummary` interface                                     |
| `apps/web/app/interno/page.tsx`                | 186-190 | renders _"Sua conta tem permissão de oficial: o painel de candidaturas aparecerá aqui."_ |

That paragraph is the **entire** admin surface. There is no list, no detail view, no status
control, no history — nothing to redesign, only a promise to retract.

`apps/web/app/interno/_components/sidebar-nav.tsx` has **no** applications entry.

### 2.5 Discord

No Discord integration exists. `.env.example` declares `DISCORD_WEBHOOK_URL=""` (unused,
placed there for Linear TIT-17) and `CLAUDE.md` lists it among secrets never to commit. No
bot, no library, no client, no gateway connection.

### 2.6 Linear

Epic **TIT-39** (apply → review), all children in Backlog: **TIT-13** schema, **TIT-14**
`POST /applications` with persistence, **TIT-16** enrichment, **TIT-17** Discord notification,
**TIT-23** review panel. Under the target architecture TIT-14 changes meaning, TIT-17 becomes
the whole feature, and **TIT-16 and TIT-23 become obsolete**. Closing them is a human decision
in Linear, outside this spec's scope.

---

## 3. Target State

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser — apply-form.tsx (client component)                     │
│   validates with createApplicationSchema (unchanged)            │
└───────────────────────────┬─────────────────────────────────────┘
                            │ POST ${API_URL}/applications
                            │ Content-Type: application/json
                            │ NO cookies, NO credentials
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Nest — ApplicationsController (public, no guard, throttled)     │
│   ZodValidationPipe(createApplicationSchema)  → 400 on bad body │
└───────────────────────────┬─────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ ApplicationsService                                             │
│   honeypot check → silent 201, no delivery                      │
│   builds the embed, escapes free text                           │
└───────────────────────────┬─────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ DiscordService.send(payload)                                    │
│   POST webhook URL, allowed_mentions: { parse: [] }             │
│   AbortSignal.timeout(10_000)                                   │
└───────────────────────────┬─────────────────────────────────────┘
                            ▼
                   Discord private channel
                            │
                            ▼
              201 { delivered: true }  ── or ──  502 / 503 / 429
                            │
                            ▼
        Frontend success block, or honest failure message
```

**No Prisma call anywhere in this path.** `ApplicationsModule` must not import
`PrismaModule`; that absence is the architectural guarantee, and section 16 makes it a test.

---

## 4. Architecture Decision

### Selected: **Discord Incoming Webhook**

One environment variable, one `fetch`, no new dependency, no new process.

### Comparison

| Criterion                        | **A. Incoming Webhook** ✅                                                                                                                                                       | B. Bot API                                                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Implementation complexity        | one `POST` with a JSON body; ~40 lines including error mapping                                                                                                                   | register app, invite bot with scopes, manage token, call `POST /channels/{id}/messages` with `Authorization: Bot …`; or add `discord.js` (heavy, gateway-oriented)                         |
| New dependencies                 | **none** — global `fetch` on Node ≥ 22, already the repo's outbound pattern                                                                                                      | `discord.js` (~large, pulls a gateway client we would never connect) or hand-rolled REST                                                                                                   |
| Required credentials             | one webhook URL (contains its own auth token)                                                                                                                                    | bot token **+** channel ID **+** an invited bot with `Send Messages` in that channel                                                                                                       |
| Blast radius if the secret leaks | attacker can post messages **to that one channel**; fix = delete webhook in channel settings, create a new one, update env. No read access, no member data, no moderation powers | bot token is an identity: everything the bot's permissions allow across the whole Discord server, including reading channel history. Rotation means regenerating the token and redeploying |
| Operational overhead             | none — stateless HTTP                                                                                                                                                            | keep an application registered; permissions drift when channels are reorganized; bots get removed by admins who don't know what they're for                                                |
| Rate limiting                    | per-webhook bucket (roughly 5 requests / 2 s, plus a global cap); a guild receives a handful of applications per week — orders of magnitude below the limit                      | same order, plus global per-bot limits shared with anything else the bot ever does                                                                                                         |
| Reliability                      | one HTTP call; failure is immediately visible in the response                                                                                                                    | same, with more moving parts that can be misconfigured silently (bot removed from channel → 403 that looks like a code bug)                                                                |
| Testability                      | mock `globalThis.fetch`, assert URL + body                                                                                                                                       | same, but the token/permission surface is harder to simulate faithfully                                                                                                                    |
| Reuse of an existing integration | `.env.example` **already reserves `DISCORD_WEBHOOK_URL`** for exactly this purpose (TIT-17)                                                                                      | nothing to reuse                                                                                                                                                                           |

### Rejected

- **B. Bot API** — buys nothing this use case needs. A bot earns its complexity when it must
  _read_ Discord, react to messages, or run slash commands. Linear TIT-35 sketches exactly
  that (`/naoraidou`, `/presenca`) as a **future** item. If that day comes, the bot becomes a
  second, independent integration; a webhook now does not block it, because the delivery
  boundary defined in section 8 is a service interface, not a wire format leaked across the app.
- **An existing bot in the repository** — there is none. Verified: zero Discord code in
  `apps/`, `packages/` and `.github/`.
- **Frontend posting to Discord directly** — would put the webhook URL in the browser bundle.
  Non-negotiable violation of section 14, and of `CLAUDE.md` Regra 6.
- **A Next.js route handler as the delivery point** — violates Regra 1: route handlers are
  for cookies, webhooks _inbound_ and file uploads. This is business logic with its own
  secret, so it belongs in the Nest.

---

## 5. Data Flow

1. Visitor fills the form in the `#candidatura` section of the landing page.
2. On blur, `apply-form.tsx` validates the whole form client-side and shows per-field errors.
   **Unchanged.**
3. On submit, the same schema validates. If it fails, nothing is sent. **Unchanged.**
4. If it passes, the client `POST`s `resultado.data` (the parsed object, not the raw
   `FormData`) to `${API_URL}/applications` as JSON, **without** `credentials`.
5. The throttler guard checks the caller's IP bucket. Over the limit → **429**.
6. `ZodValidationPipe` re-validates server-side. Malformed → **400** with per-field `issues`.
   Client-side validation is UX; this is the real gate — same relationship as Regra 5.
7. `ApplicationsService` inspects the honeypot. Filled → log at `debug`, return the normal
   success shape, **do not call Discord**.
8. The service builds the embed: escapes free text, truncates to Discord's limits, sets
   `allowed_mentions: { parse: [] }`, stamps an ISO timestamp.
9. `DiscordService` `POST`s the webhook URL with a 10 s timeout.
10. Discord returns 204 → the API returns **201 `{ delivered: true }`**.
    Discord fails → the API maps it per section 15 and **the applicant is told it did not go
    through**.
11. The frontend replaces the form with a success block, or keeps the form intact (values
    preserved) and shows the failure message.

Nothing is written to Postgres at any step.

---

## 6. Current Form Fields

Read directly from `apps/web/app/_components/apply/apply-form.tsx` and
`packages/shared/src/application.ts`. **These four visible fields are all that exist.**

| Field            | Label (pt-BR)                                                                                                | Type               | Required | Validation                                                                    | Discord destination                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | ------------------ | -------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| `characterRealm` | "Nome / realm do personagem" (help: _"Ex.: Thrall — Azralon"_)                                               | single-line text   | **yes**  | `z.string().min(2).max(80)`; HTML `minLength=2 maxLength=80 autoComplete=off` | embed **title** suffix and first field, `Personagem` |
| `roleSpec`       | "Role / spec" (help: _"Ex.: Tank / Protection Warrior"_)                                                     | single-line text   | **yes**  | `z.string().min(2).max(80)`                                                   | embed field `Role / spec`, `inline: true`            |
| `contact`        | "Contato (Discord / Battle.net)" (help: _"Informe a tag e a plataforma que prefere."_)                       | single-line text   | **yes**  | `z.string().min(2).max(100)`                                                  | embed field `Contato`, `inline: true`                |
| `additionalInfo` | "Informações adicionais" (help: _"Experiência, disponibilidade ou qualquer contexto que ajude a conversa."_) | textarea, `rows=7` | no       | `z.string().max(2000).optional()`                                             | embed **description**                                |
| `website`        | "Website", visually hidden (`absolute -left-[9999px]`, `aria-hidden`, `tabIndex=-1`)                         | honeypot input     | no       | `z.string().max(0).optional()`                                                | **never sent to Discord**                            |

### Fields that do NOT exist — do not invent them

The brief lists possible content such as Battle.net identity, character name, realm,
class/spec, role, availability, experience, log/profile links and authenticated user
metadata. In this repository:

- **there is no separate character name, realm, class, spec, availability, experience or
  logs field.** `characterRealm` is one free-text box where the applicant types
  `Thrall — Azralon`; `roleSpec` is one free-text box. They were deliberately collapsed in
  `38c1dd5`.
- **there is no authenticated user metadata to attach.** The applicant is by definition not
  a guild member and is not logged in; the endpoint is public and takes no cookie. There is
  no Battle.net identity, no session, no `SessionUser`. Any "authenticated user metadata" in
  the Discord message would be fabricated.
- the only non-form metadata legitimately available server-side is the **submission
  timestamp** (section 7) — and the caller IP, which section 14 forbids putting in the message.

If richer fields are wanted, that is a **separate, product-led change**: extend
`createApplicationSchema`, the form, `application.spec.ts` and the embed builder together.
Out of scope here (section 21).

---

## 7. Discord Message Format

One embed per submission. Target payload:

```jsonc
{
  "username": "Candidaturas", // optional; overrides the webhook's display name
  "embeds": [
    {
      "title": "Nova candidatura — <characterRealm, escaped, ≤ 200 chars>",
      "color": 3066993, // pick one constant; keep it stable
      "description": "<additionalInfo, escaped, ≤ 4000 chars>", // omitted when absent
      "fields": [
        { "name": "Personagem / realm", "value": "<characterRealm>", "inline": false },
        { "name": "Role / spec", "value": "<roleSpec>", "inline": true },
        { "name": "Contato", "value": "<contact>", "inline": true },
      ],
      "timestamp": "2026-08-09T18:30:00.000Z",
    },
  ],
  "allowed_mentions": { "parse": [] },
}
```

### Rules

- **Ordering** is fixed and matches the form: identity, then role, then contact, then free
  text. An officer triaging ten of these reads the same shape every time.
- **Title** carries `characterRealm` so the channel list is scannable without opening
  anything.
- **Timestamp**: server-generated ISO 8601, `new Date().toISOString()`. Never trust a
  client-supplied time.
- **Empty optional values**: when `additionalInfo` is absent or whitespace-only, **omit
  `description` entirely**. Do not emit `"—"`, `"N/A"` or an empty field — Discord rejects
  empty `value` strings on fields with a 400, and a placeholder is noise.
- **Length handling** (Discord's hard limits; exceeding any of them is a 400):
  | Limit                                                                                 | Value | Our margin                                                                                  |
  | ------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------- |
  | embed `title`                                                                         | 256   | truncate to 200                                                                             |
  | embed `description`                                                                   | 4096  | `additionalInfo` is capped at 2000 by the schema; escaping can grow it, so truncate to 4000 |
  | field `value`                                                                         | 1024  | inputs are capped at 80/80/100; escaping can grow them, so truncate to 1000                 |
  | fields per embed                                                                      | 25    | we send 3                                                                                   |
  | total embed characters                                                                | 6000  | far below                                                                                   |
  | Truncation must append an ellipsis so a cut is visible, and must be applied **after** |
  | escaping, not before.                                                                 |
- **Escaping/sanitization** — every value that came from the form passes through one shared
  helper before it enters the payload:
  1. normalize newlines, collapse runs of more than two blank lines;
  2. strip zero-width and control characters (they are used to smuggle text past a reader);
  3. escape Discord markdown control characters — `` ` ``, `*`, `_`, `~`, `|`, `>` at line
     start, and `[`…`]`(…) link syntax — by backslash-prefixing them, so an applicant cannot
     forge formatting, fake a quote from someone else, or render a link whose text disagrees
     with its target;
  4. **do not** wrap the text in a code fence as the sanitization strategy. A payload
     containing ``` breaks straight out of it; escaping is the robust move.
     Raw URLs may remain readable — officers need to open the applicant's logs — but because
     markdown link syntax is escaped, the visible text always equals the actual destination.
- **`allowed_mentions: { parse: [] }` is mandatory and is the single most important line in
  the payload.** Discord's default is to parse every mention it finds. Without this key, an
  applicant typing `@everyone` in "Informações adicionais" pings the entire server from the
  guild's own webhook. Escaping alone does **not** stop this; the field must be present on
  every request. Section 16 requires a test asserting it.

---

## 8. Backend Changes

### 8.1 `packages/shared/src/application.ts` — **MODIFY**

- **Current**: request schema + the four-state status vocabulary.
- **Target**: request schema kept **unchanged**; status vocabulary removed; a response
  contract added.

```ts
// REMOVE — no stored record has a status any more, and nothing consumes these:
//   APPLICATION_STATUSES, applicationStatusSchema, ApplicationStatus

/** Resultado do envio. `delivered` só é true se o Discord aceitou a mensagem. */
export const applyResultSchema = z.object({ delivered: z.literal(true) });
export type ApplyResult = z.infer<typeof applyResultSchema>;
```

Keep the file's name and the `PROVISÓRIO` doc comment, but update it: it currently promises
_"antes de virar migration definitiva"_, which is no longer the plan.

The honeypot decision needs an explicit call here. `website: z.string().max(0)` sits **inside**
the validated schema, so the pipe rejects a filled honeypot with **400 and `website` named in
`issues`** — which tells a bot precisely which field to leave alone. Two acceptable
resolutions:

- **(recommended)** keep `website` in the schema as `z.string().optional()` (no `max(0)`) and
  move the emptiness check into the service, which returns the normal success shape without
  delivering. Update `application.spec.ts` accordingly.
- or leave it as-is and accept that the honeypot is weak.

Either way the choice must be deliberate and commented, because `application.spec.ts:43-47`
currently pins the rejecting behavior in a test.

### 8.2 `packages/shared/src/index.ts` — **VERIFY**

Re-exports `./application.js` with `export *`; no edit needed unless names change. Confirm
`applyResultSchema` is exported after the change.

### 8.3 `apps/api/src/discord/discord.service.ts` — **CREATE**

- **Responsibility**: the only place in the codebase that knows Discord's wire format.
- Public surface: `send(payload: DiscordWebhookPayload): Promise<void>`, throwing typed
  errors the caller maps to HTTP.
- Implementation notes:
  - global `fetch` + `AbortSignal.timeout(10_000)`, matching `blizzard.service.ts`. Do **not**
    add `axios` or `@nestjs/axios`; the repo has no HTTP client dependency and should not gain one.
  - success is **HTTP 204 No Content**, not 200. Treat any 2xx as success but log a warning
    on an unexpected code.
  - distinguish, for section 15: `429` (read `retry_after`), `401`/`403`/`404` (dead or wrong
    webhook — a configuration fault, must be loud), other `4xx` (our payload is malformed —
    a code fault), `5xx`/network/timeout (Discord's fault).
  - never log the webhook URL, and never log the payload body (section 14).
- Put it in its own module (`discord.module.ts`) exporting the service, so a future second
  caller — the raid-night digest of Regra 7, say — reuses it instead of re-implementing.

### 8.4 `apps/api/src/config/discord.config.ts` — **CREATE**

- Mirror `guild.config.ts` exactly: a `loadDiscordConfig(env = process.env)` returning a typed
  object, throwing with an actionable message on a malformed value.
- Validate that `DISCORD_APPLY_WEBHOOK_URL`, **when present**, parses as a URL whose host is
  `discord.com` or `discordapp.com` and whose path starts with `/api/webhooks/`. A typo here
  otherwise surfaces as a runtime 404 that reads like a bug.
- **Absence policy** — deliberate departure from `guild.config.ts`, which throws at boot:
  `GUILD_NAME` missing makes _every_ member a non-member, so it must kill the process. A
  missing recruitment webhook only breaks recruitment, and killing the API would also take
  down the internal area, the roster and attendance. Therefore: **log an error at boot and
  make the apply endpoint answer 503**, rather than refusing to start. Comment this reasoning
  in the file — it is the kind of asymmetry a future reader will otherwise "fix".

### 8.5 `apps/api/src/applications/applications.controller.ts` — **CREATE**

- `@Controller('applications')`, `@Post()`, **no guard** — the applicant is not a member, by
  definition. This is the only unauthenticated write endpoint in the system, which is why
  8.7 is mandatory rather than optional.
- Body validated by `new ZodValidationPipe(createApplicationSchema)` — reuse, do not rewrite.
- Returns **201** with `ApplyResult`.
- HTTP only: no business logic, per Regra 3.

### 8.6 `apps/api/src/applications/applications.service.ts` — **CREATE**

- Honeypot short-circuit; embed construction; escaping/truncation helpers (a separate
  `apps/api/src/applications/embed.ts` keeps them unit-testable in isolation); calls
  `DiscordService`; maps Discord failures to Nest exceptions per section 15.
- **Must not import `PrismaService`.** There is intentionally **no
  `applications.repository.ts`** — the module owns no data. Regra 3 mandates a repository as
  the only Prisma touch-point; a domain that persists nothing simply has none, and the
  absence should be commented so nobody "completes" the pattern later. This exception is
  recorded in `CLAUDE.md` (section 17).

### 8.7 `apps/api/src/applications/applications.module.ts` + `app.module.ts` — **CREATE / MODIFY**

Register the new module. Forgetting this yields a 404 that looks like a routing typo.

### 8.8 Rate limiting — **CREATE**

`@nestjs/throttler` is **not installed**. Add it, register `ThrottlerModule` in
`app.module.ts`, and apply a tight per-IP limit to the apply route (suggested: **5 per hour**;
a human applies once).

This is more important than it was under the old design. Previously an unthrottled endpoint
meant junk rows in a table nobody had opened yet. **Now the public endpoint is a
message-delivery amplifier pointed at the guild's own private channel** — a bot that finds it
can flood the officers' channel until the webhook's own rate limit kicks in, and there is no
"delete the rows" cleanup, only manual message deletion. Ship the throttler in the same PR as
the endpoint, never after.

**Deployment trap**: without `app.set('trust proxy', …)` in `main.ts`, behind a reverse proxy
Nest sees the proxy's IP for every request, so the per-IP bucket becomes **global** and the
first spammer locks out every legitimate applicant. `main.ts` does not configure this today.

### 8.9 Errors and logging

Nest exception filters map thrown exceptions; see section 15 for the status table.
Logging rules are in section 14 — the summary is: log that a submission happened and whether
delivery succeeded, never log its content.

### 8.10 Tests

See section 16.

---

## 9. Frontend Changes

Only `apps/web/app/_components/apply/apply-form.tsx` changes. The frontend never learns the
webhook URL; it only knows `API_URL` from `lib/config.ts`, which is already client-safe.

| Concern                 | Current                                                                                   | Target                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submission              | valid input sets `erros.envio = 'O envio pelo site ainda não está aberto…'` (lines 39-44) | `POST ${API_URL}/applications`, JSON body `resultado.data`, **no `credentials`** (unlike `gestao-oficiais.tsx`, this caller has no session)                                                                                       |
| Loading                 | none                                                                                      | `useTransition`; disable submit while pending so a double click cannot send twice                                                                                                                                                 |
| Success                 | none                                                                                      | replace the form with a confirmation block; parse the response with `applyResultSchema`                                                                                                                                           |
| Error — 400             | n/a                                                                                       | map `issues[].path` into the existing `Record<string, string>` error state; the pipe's `path` already equals the field name                                                                                                       |
| Error — 429             | n/a                                                                                       | dedicated message ("muitos envios, tente novamente em alguns minutos"). Generic wording makes people retry, which is exactly wrong                                                                                                |
| Error — 502/503/timeout | n/a                                                                                       | honest message: the submission did **not** arrive, please try again shortly or reach the guild on Discord. **Preserve everything typed.** Losing a long text because Discord blinked is the worst outcome this screen can produce |
| Retry                   | n/a                                                                                       | keep the form usable and let the person press submit again. No automatic retry — it risks duplicate messages with no dedupe on the receiving end                                                                                  |

**Must be removed** (they will actively lie once the endpoint exists):

- lines 117-122 — the `<Chapa>` note "O envio pelo site ainda não está aberto…"
- lines 126-127 — `disabled` and `aria-describedby="envio-fechado"` on the submit button
- the `erros.envio` branch in `submeter`

Check `apply.tsx` copy too (line 26-29 currently promises contact, which stays true).

**Accessibility**: the error block is `role="alert"`. The success block needs equivalent
treatment and must receive focus — otherwise a keyboard or screen-reader user submits and
perceives nothing.

**Reuse the pattern, not the credentials**: `apps/web/app/interno/oficiais/_components/gestao-oficiais.tsx`
is the repository's reference for a client component calling the Nest directly, including why
it is not a Next route handler. Read it first; copy the shape, drop `credentials: 'include'`.

---

## 10. Database / Prisma Cleanup

**Nothing to clean.** This section exists to record the verification, because the request
assumed otherwise and a future reader deserves the evidence.

| Artifact                                               | Status                                             | Action |
| ------------------------------------------------------ | -------------------------------------------------- | ------ |
| `model Application` in `apps/api/prisma/schema.prisma` | does not exist                                     | none   |
| `enum ApplicationStatus` in the schema                 | does not exist                                     | none   |
| `applications.repository.ts`                           | never existed in any commit                        | none   |
| Application migrations                                 | none among the 10 in `apps/api/prisma/migrations/` | none   |
| Seeds / fixtures                                       | the repository has none at all                     | none   |

Verification commands (re-run before implementing, in case something lands first):

```bash
grep -nE "^(model|enum) " apps/api/prisma/schema.prisma          # 17 models, 4 enums, none application-related
ls apps/api/prisma/migrations                                     # 10 dirs, none application-related
git log --all --diff-filter=A --name-only --format="" | grep -i "api/src/applications"   # empty
```

### Migration-history strategy: **do nothing**

- **Remain in history**: yes, all 10 existing migrations, untouched. None of them mentions
  applications, so there is nothing obsolete to supersede.
- **New superseding migration**: **not needed.** Do not create an empty or "cleanup" migration
  to mark this decision — a migration that changes no schema is noise that future readers will
  spend time explaining to themselves.
- **Squashing**: **explicitly forbidden here.** Squashing is only ever defensible before a
  schema reaches a database anyone depends on, and this project ships a Docker image (commit
  `2365745`, PR #27), so an applied history may already exist somewhere. Rewriting applied
  migration history desynchronizes `_prisma_migrations` from the files and produces failures
  at deploy time that are painful to unwind. There is **zero** upside here, because there is
  nothing application-related in the history to remove.
- **`prisma migrate reset` / `db push --force-reset`**: never, as part of this change.

The only truthful summary: **this change touches no database artifact at all.** If an
implementation agent finds itself writing a migration, it has misread this spec.

---

## 11. Shared Types / Contracts Cleanup

| Symbol                                                              | File                                           | Verdict             | Reason                                                                                                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `createApplicationSchema`, `CreateApplication`                      | `packages/shared/src/application.ts`           | **KEEP**            | still the request contract; Regra 2 requires exactly one declaration, used by both the form and the pipe                                        |
| `APPLICATION_STATUSES`                                              | same                                           | **REMOVE**          | a stored record's lifecycle. No stored record, and zero consumers today                                                                         |
| `applicationStatusSchema`                                           | same                                           | **REMOVE**          | derived from the above                                                                                                                          |
| `ApplicationStatus`                                                 | same                                           | **REMOVE**          | derived from the above                                                                                                                          |
| `applyResultSchema`, `ApplyResult`                                  | same                                           | **CREATE**          | the frontend needs something to `safeParse`, matching how `officerListSchema` is used                                                           |
| `website` honeypot rule                                             | same                                           | **MODIFY / VERIFY** | see 8.1 — its current placement leaks which field is the trap                                                                                   |
| `application.spec.ts`                                               | `packages/shared/src/`                         | **MODIFY**          | keep the field tests; update the honeypot test to whatever 8.1 decides; add one for `applyResultSchema`                                         |
| `canReviewApplications()`                                           | `packages/shared/src/membership.ts:163`        | **REMOVE**          | it gates a review panel that will never exist. Leaving a permission whose subject is gone invites someone to build the subject                  |
| its four tests                                                      | `packages/shared/src/membership.spec.ts:75-95` | **REMOVE**          | with the function                                                                                                                               |
| `isActingOfficer()`, `canManageOfficers()`, `canSeeOthersHistory()` | `membership.ts`                                | **KEEP**            | unrelated to applications; `canSeeOthersHistory` carries Regra 7, `canManageOfficers` gates `/interno/oficiais`                                 |
| `characterInputSchema`                                              | `packages/shared/src/wow.ts`                   | **KEEP**            | used by `createOfficerGrantSchema`; **not** used by the apply schema since `38c1dd5`, despite what `CLAUDE.md` says today (fixed in section 17) |

**Careful with `canReviewApplications` — it is load-bearing across three files.** Removing it
means also editing `internal.controller.ts` (interface field + the `canReviewApplications:`
line), `apps/web/lib/api.ts:69`, and `apps/web/app/interno/page.tsx:186`. Miss one and the
build breaks; miss it in the right order and the API silently stops sending a field the web
still reads. Change all four in one commit.

Note for later, out of scope: the `InternalSummary` interface is declared **twice** —
`internal.controller.ts:6` and `lib/api.ts:65` — which is the duplication Regra 2 forbids. It
predates this change; do not fix it here, but do not deepen it either.

---

## 12. Admin / Internal UI Impact

| Capability                | Exists?                                                                                          | Action                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Viewing applications      | **no**                                                                                           | none                                                                  |
| Approving / rejecting     | **no**                                                                                           | none                                                                  |
| Status workflow           | **no**                                                                                           | none                                                                  |
| Application history       | **no**                                                                                           | none                                                                  |
| Sidebar entry             | **no** (`sidebar-nav.tsx` has Home, Roster, Progressão, Raid, Presença, + Oficiais for officers) | none                                                                  |
| Promise of a future panel | **yes** — `apps/web/app/interno/page.tsx:186-190`                                                | **REMOVE** the `summary?.canReviewApplications && (…)` block entirely |

No replacement workflow is invented: officers now read candidates in the Discord channel,
which is the whole point of the change. The surrounding "A definir" section on that page
stays as it is.

---

## 13. Environment Variables

| Variable                    | Purpose                                                                                                        | Service      | Secret?                         | Required?                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------- | ------------------------------------------------------------------------------------ |
| `DISCORD_APPLY_WEBHOOK_URL` | full Discord incoming-webhook URL for the private recruitment channel; contains its own auth token in the path | **API only** | **YES — treat as a credential** | required for the feature; absent ⇒ endpoint answers 503 and boot logs an error (8.4) |

That is the complete list. No channel ID, no bot token, no client ID — the webhook URL
encodes its destination and its authorization together, which is precisely why it is the
simplest option and why it must never leave the backend.

### Changes required in files this task may not edit

- **`.env.example`** — rename the existing placeholder `DISCORD_WEBHOOK_URL` to
  `DISCORD_APPLY_WEBHOOK_URL` and document it in the file's established commented style: what
  it is, that the channel **must be private**, and that a leak is fixed by deleting the
  webhook in Discord and creating a new one (not by editing git history). Keep the value empty.
- **`CLAUDE.md` "Segredos"** — update the never-commit list to the new name (done in
  section 17, since docs are in scope).
- **Deployment environment** — the Docker image from PR #27 needs the variable wired in
  wherever it runs.

### Naming

`DISCORD_APPLY_WEBHOOK_URL`, not the current generic `DISCORD_WEBHOOK_URL`, because Regra 7
anticipates other Discord pushes (raid digests, roster events). A generic name guarantees
that the second integration either reuses the recruitment channel by accident — leaking
applicant PII into a general channel — or triggers a confusing rename later.

**`NEXT_PUBLIC_` prefix is forbidden for this variable.** Next inlines any `NEXT_PUBLIC_*`
value into the browser bundle; prefixing it would publish the webhook to every visitor.

---

## 14. Security Requirements

1. **Secret handling** — the webhook URL is read only in the Nest, only from `process.env`,
   only through `discord.config.ts`. Never imported by `apps/web`, never returned by any
   endpoint, never given a `NEXT_PUBLIC_` name, never written to a log line or an error
   message (an unhandled `fetch` rejection can otherwise print the full URL, token included).
2. **The destination channel must be private**, restricted to officers. The message contains a
   Discord/Battle.net tag and free text the person wrote expecting leadership to read it —
   the exact confidentiality concern `CLAUDE.md` Regra 4 raises about the applications panel.
   Under this architecture the Discord channel's permissions _are_ the access control, so
   getting them wrong is the new version of the old leak. Say this in the `.env.example` comment.
3. **Validation** — server-side `ZodValidationPipe` is authoritative; client-side validation
   is UX only (same logic as Regra 5).
4. **Sanitization** — section 7: control/zero-width stripping, markdown escaping, truncation
   after escaping.
5. **`allowed_mentions: { parse: [] }` on every request.** Without it, `@everyone`, `@here` and
   role mentions typed into the form fire for real. Escaping markdown does not prevent
   mention parsing — these are two independent defenses and both are required.
6. **Payload limits** — the schema caps the body at roughly 2.3 KB of text. Also cap the raw
   request body at the Express layer (a small `json({ limit: '16kb' })` is generous) so a
   multi-megabyte body is rejected before Zod ever runs.
7. **Rate limiting** — section 8.8. Mandatory, same PR, plus the `trust proxy` caveat.
8. **Honeypot** — section 8.1; keep it, but stop advertising which field it is.
9. **Duplicate submissions** — with no database there is no dedupe key and no idempotency.
   Mitigate in the UI (disable while pending, replace the form on success) and accept that a
   determined double-submit yields two messages. Do **not** build a server-side dedupe cache;
   that is state, which is what this architecture is removing. Two identical messages
   thirty seconds apart are self-evident to a human reader.
10. **Logging restrictions** — log a submission event with **no field values**: timestamp,
    outcome, and a Discord-side status code are enough. Never log `contact` (a real person's
    Discord tag), never log `additionalInfo`, never log the request body on validation
    failure, and **never log the caller's IP alongside submission content**. The repository is
    public and its rule against versioning member/applicant data extends to anything that can
    end up in a log aggregator.
11. **Failure behavior** — never report success when Discord refused. The response must
    reflect actual delivery; see section 15.
12. **Timeouts** — 10 s via `AbortSignal.timeout`, consistent with the other outbound services.
13. **CORS** — already correct: `main.ts` restricts `origin` to `WEB_URL`. Do not loosen it to
    `*` for this public endpoint; CORS is not the auth boundary, but widening it for no reason
    is free attack surface.

---

## 15. Error Handling

| Condition                                              | Detection                            | API response                                                              | Frontend behavior                                                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invalid payload                                        | `ZodValidationPipe`                  | **400** `{ message, issues: [{path, message}] }`                          | map `issues` to per-field errors; focus the first                                                                                                                              |
| Honeypot filled                                        | service                              | **201** `{ delivered: true }` (silent discard)                            | normal success — the bot learns nothing                                                                                                                                        |
| Webhook not configured                                 | `discord.config.ts` returned nothing | **503** `{ message: 'Envio indisponível no momento.' }`                   | failure message; log an operator-facing error server-side                                                                                                                      |
| Invalid / revoked webhook (401, 403, 404 from Discord) | `DiscordService`                     | **503**                                                                   | same message to the applicant — this is an operator fault, not theirs. Log at `error` with the status code, **without the URL**; this is the one case that should page a human |
| Discord 5xx                                            | `DiscordService`                     | **502** `{ message: 'Não foi possível entregar sua candidatura agora.' }` | honest failure, values preserved, retry invited                                                                                                                                |
| Discord timeout / network error                        | `AbortError` / `TypeError`           | **502**                                                                   | same. **Do not retry inline** — the first request may have landed, and a retry would duplicate the message                                                                     |
| Discord 429                                            | `DiscordService` reads `retry_after` | **503** (log `retry_after`)                                               | "muitos envios agora, tente em alguns minutos"                                                                                                                                 |
| Our own rate limit hit                                 | `ThrottlerGuard`                     | **429**                                                                   | dedicated message; do not encourage immediate retry                                                                                                                            |
| Duplicate submit                                       | not detected by design               | **201** twice                                                             | UI prevention only (disabled button, form replaced on success)                                                                                                                 |
| Unexpected internal error                              | Nest default filter                  | **500**, generic body                                                     | generic failure message; never surface a stack trace or the webhook URL                                                                                                        |

**Principle**: `delivered: true` is returned **only** when Discord accepted the message. The
applicant must never be told "we got it" when nothing arrived — under this architecture there
is no record to recover from, so a false success is a silently lost candidate.

---

## 16. Testing Plan

`packages/shared` uses **vitest**; `apps/api` uses **jest**. Follow each package's existing setup.

### Shared (vitest)

- `application.spec.ts`: keep the field/limit tests; update the honeypot test to match 8.1;
  add `applyResultSchema` coverage.
- `membership.spec.ts`: delete the `canReviewApplications` block; confirm the remaining
  permission tests still pass.

### API — unit (jest)

- **embed builder** (`embed.ts`), the highest-value tests in this change:
  - `@everyone` / `@here` / `<@&roleid>` in `additionalInfo` ⇒ present as text, and the
    payload always carries `allowed_mentions: { parse: [] }`
  - markdown injection (`` ` ``, `**`, `[texto](http://evil)`) ⇒ escaped, link text and target
    cannot diverge
  - a 2000-character `additionalInfo` ⇒ description within limits, truncation marked
  - absent / whitespace-only `additionalInfo` ⇒ `description` key omitted, no empty field
  - control and zero-width characters stripped
- **`applications.service`**:
  - happy path calls `DiscordService.send` exactly **once** with the expected embed
  - honeypot filled ⇒ `send` **not called**, success shape returned
  - Discord 5xx / timeout / 429 / 401 ⇒ the exception mapped per section 15
  - **an architectural test**: the module's provider graph contains no `PrismaService`. This is
    the guard that keeps "just store it too" from creeping back in
- **`discord.config`**: valid URL accepted; wrong host rejected; missing value yields the
  "not configured" state rather than throwing at boot

### API — integration / endpoint (jest + supertest)

- `POST /applications` with a valid body ⇒ **201** `{ delivered: true }`, with the Discord
  client mocked
- invalid body ⇒ **400** with `issues` naming the offending field
- throttle limit exceeded ⇒ **429**
- endpoint reachable **without** a session cookie (it is public by design) — the mirror image
  of the Regra 5 test, which asks whether an internal endpoint returns 401 without a cookie

### Frontend

- submit with a valid form ⇒ one `fetch` to `${API_URL}/applications`, **without**
  `credentials`, body matching the parsed schema
- 400 ⇒ per-field errors rendered
- 502 / 503 ⇒ failure message shown **and the typed values still in the inputs**
- 429 ⇒ the rate-limit-specific message
- success ⇒ confirmation block replaces the form and receives focus
- double click ⇒ exactly one request

### Hard rule

**No test may reach the real Discord.** Mock `globalThis.fetch` (or inject a fake
`DiscordService`) in every test that touches the delivery path. A test that reads
`DISCORD_APPLY_WEBHOOK_URL` from the environment is a defect: it will post junk into the
guild's private channel from CI, and it will fail for any contributor who has no webhook.

---

## 17. Documentation Changes

| Document                                                   | Current old assumption                                                                                            | Required change                                                                                                                                                                                                                                                              | Status                                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `CLAUDE.md` — Regra 3 (module layout)                      | uses `applications` as the example domain, with `applications.repository.ts` as "o único lugar que toca o Prisma" | swap the example to a domain that really has a repository; record that the apply module is the one domain **without** one, because it persists nothing                                                                                                                       | **updated in this task**                                                                       |
| `CLAUDE.md` — Regra 4, "A exceção: painel de candidaturas" | an officer-gated panel holds applicant PII; `canReviewApplications()` is the gate                                 | rewrite: candidaturas are not stored, there is no panel, `canReviewApplications()` is slated for removal, and the confidentiality concern moves to the Discord channel's permissions. Record the reversal in the file's established style rather than deleting the reasoning | **updated in this task**                                                                       |
| `CLAUDE.md` — permissions table                            | lists `canReviewApplications()` as a live permission                                                              | drop the row, keep the three-permission reasoning intact for the survivors                                                                                                                                                                                                   | **updated in this task**                                                                       |
| `CLAUDE.md` — Regra 6, region paragraph                    | claims `createApplicationSchema` uses `characterInputSchema`                                                      | factually wrong since `38c1dd5`; correct it while keeping the US-only rule, which is unaffected                                                                                                                                                                              | **updated in this task**                                                                       |
| `CLAUDE.md` — Segredos                                     | lists `DISCORD_WEBHOOK_URL`                                                                                       | rename to `DISCORD_APPLY_WEBHOOK_URL` and state that rotation means deleting the webhook in Discord                                                                                                                                                                          | **updated in this task**                                                                       |
| `docs/candidatura/backend-pendente-e-integracao.md`        | exists **only** to specify the DB-backed `POST /applications` (Prisma model, migration, repository, status)       | its entire purpose is superseded; replaced by a pointer to this spec that preserves the still-valid repository findings                                                                                                                                                      | **updated in this task**                                                                       |
| `docs/landing/04-implementation-spec.md`                   | mentions "candidatura" as a landing section whose form and validation are preserved                               | still accurate — it describes layout, not persistence                                                                                                                                                                                                                        | **KEEP, no change**                                                                            |
| `docs/landing/05-identidade-visual.md`                     | same, plus "Formulário, schema, honeypot e relações ARIA permanecem intactos"                                     | still accurate under the target architecture                                                                                                                                                                                                                                 | **KEEP, no change**                                                                            |
| `README.md`                                                | "Landing pública com formulário de apply + área interna"                                                          | still accurate — the form exists either way                                                                                                                                                                                                                                  | **KEEP, no change**                                                                            |
| `apps/api/README.md`, `apps/web/README.md`                 | framework boilerplate; "application" only in the NestJS/Next sense                                                | irrelevant                                                                                                                                                                                                                                                                   | **KEEP, no change**                                                                            |
| `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`                 | Next 16 warning; no application references                                                                        | irrelevant                                                                                                                                                                                                                                                                   | **KEEP, no change**                                                                            |
| `.env.example`                                             | declares unused `DISCORD_WEBHOOK_URL`                                                                             | rename + document (private channel, rotation)                                                                                                                                                                                                                                | **NOT DONE — env files are out of bounds for this task; implementation agent must do it (13)** |
| Linear TIT-16, TIT-23                                      | enrichment and review panel over stored applications                                                              | obsolete under the target architecture; TIT-14 changes meaning, TIT-17 becomes the feature                                                                                                                                                                                   | **NOT DONE — a human decision in Linear, outside the repository**                              |

---

## 18. Legacy Cleanup Inventory

| #   | Artifact                                                                                                    | Class                            | Note                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/api/prisma/schema.prisma` — application model/enum                                                    | **KEEP**                         | never existed; nothing to remove                                                                                                                                                                                              |
| 2   | `apps/api/prisma/migrations/*`                                                                              | **KEEP**                         | untouched; see section 10 for why squashing is forbidden                                                                                                                                                                      |
| 3   | `apps/api/src/applications/*` (repository/service/controller)                                               | **KEEP**                         | never existed; the new module is a fresh build, not a refactor                                                                                                                                                                |
| 4   | `packages/shared/src/application.ts` — `APPLICATION_STATUSES`                                               | **REMOVE**                       | zero consumers                                                                                                                                                                                                                |
| 5   | `packages/shared/src/application.ts` — `applicationStatusSchema`                                            | **REMOVE**                       | derived                                                                                                                                                                                                                       |
| 6   | `packages/shared/src/application.ts` — `ApplicationStatus`                                                  | **REMOVE**                       | derived                                                                                                                                                                                                                       |
| 7   | `packages/shared/src/application.ts` — `createApplicationSchema`                                            | **KEEP**                         | still the request contract                                                                                                                                                                                                    |
| 8   | `packages/shared/src/application.ts` — doc comment mentioning "migration definitiva"                        | **MODIFY**                       | now false                                                                                                                                                                                                                     |
| 9   | `packages/shared/src/application.ts` — `website` honeypot placement                                         | **MODIFY**                       | see 8.1                                                                                                                                                                                                                       |
| 10  | `packages/shared/src/application.spec.ts`                                                                   | **MODIFY**                       | honeypot test follows 8.1; add `applyResultSchema`                                                                                                                                                                            |
| 11  | `packages/shared/src/membership.ts:163` — `canReviewApplications()`                                         | **REMOVE**                       | gates a panel that will not exist                                                                                                                                                                                             |
| 12  | `packages/shared/src/membership.spec.ts:75-95`                                                              | **REMOVE**                       | with the function                                                                                                                                                                                                             |
| 13  | `packages/shared/src/membership.ts:53` — comment citing applicant PII as the reason for manual officer flag | **MODIFY**                       | reasoning survives (the Discord channel holds the PII now); the wording needs updating                                                                                                                                        |
| 14  | `apps/api/src/internal/internal.controller.ts:6-11,33-39`                                                   | **MODIFY**                       | drop the `canReviewApplications` field and its comment referencing TIT-23                                                                                                                                                     |
| 15  | `apps/web/lib/api.ts:69`                                                                                    | **MODIFY**                       | drop the mirrored field                                                                                                                                                                                                       |
| 16  | `apps/web/app/interno/page.tsx:186-190`                                                                     | **REMOVE**                       | the "o painel de candidaturas aparecerá aqui" teaser                                                                                                                                                                          |
| 17  | `apps/web/app/_components/apply/apply-form.tsx:39-44`                                                       | **MODIFY**                       | replace the "envio fechado" branch with the real POST                                                                                                                                                                         |
| 18  | `apps/web/app/_components/apply/apply-form.tsx:117-122,126-127`                                             | **REMOVE**                       | the closed-submission note and the `disabled` button                                                                                                                                                                          |
| 19  | `.env.example` — `DISCORD_WEBHOOK_URL`                                                                      | **MODIFY**                       | rename to `DISCORD_APPLY_WEBHOOK_URL`, document the private-channel requirement                                                                                                                                               |
| 20  | `CLAUDE.md` — four application passages                                                                     | **MODIFY**                       | done in this task (section 17)                                                                                                                                                                                                |
| 21  | `docs/candidatura/backend-pendente-e-integracao.md`                                                         | **MODIFY**                       | superseded pointer; done in this task                                                                                                                                                                                         |
| 22  | `apps/api/src/auth/auth.controller.ts:130` — comment mentioning Discord                                     | **VERIFY DURING IMPLEMENTATION** | unrelated (the three-state login messaging of TIT-20); almost certainly untouched                                                                                                                                             |
| 23  | `apps/web/app/_components/site-footer.tsx:42` — "Discord — endereço pendente"                               | **VERIFY DURING IMPLEMENTATION** | unrelated content placeholder; may be worth filling once the channel exists                                                                                                                                                   |
| 24  | Linear TIT-16 / TIT-23                                                                                      | **VERIFY DURING IMPLEMENTATION** | cancel or rewrite; human decision                                                                                                                                                                                             |
| 25  | `InternalSummary` declared in both `internal.controller.ts` and `lib/api.ts`                                | **KEEP**                         | pre-existing Regra 2 smell; out of scope, do not deepen                                                                                                                                                                       |
| 26  | `apps/web/app/layout.tsx:44` — `TITAN_FEL_CONTRACT` marker containing `STORY=…candidatura_como_registro`    | **KEEP**                         | borderline, and a false positive: "registro" here is the landing's narrative device (the heading reads _"Entrar para o registro"_), not a claim about database records. Leave it alone unless the landing copy itself changes |

---

## 19. Implementation Order

Grounded in this repository, smallest reversible steps first. Each numbered step should build
and test green on its own.

1. **Shared contract** — remove the status vocabulary, add `applyResultSchema`, settle the
   honeypot placement (8.1), update `application.spec.ts`. Run `pnpm --filter @titan/shared build`
   so the apps see it.
2. **Discord config + service** — `discord.config.ts`, `discord.service.ts`, `discord.module.ts`,
   with unit tests against a mocked `fetch`. Nothing consumes it yet; it is safe on its own.
3. **Embed builder** — `applications/embed.ts` plus the escaping/mentions/truncation tests.
   Pure functions, no I/O; get these right before wiring anything.
4. **Throttler** — install `@nestjs/throttler`, register it, and handle `trust proxy` in
   `main.ts`. **Before** the endpoint exists, so the endpoint is never briefly unthrottled.
5. **Endpoint** — controller + service + module, registered in `app.module.ts`, with the
   endpoint tests including the "no Prisma in this module" assertion.
6. **Environment** — add `DISCORD_APPLY_WEBHOOK_URL` to `.env.example` (renaming the old
   placeholder) and to the deployment environment. Verify end-to-end against a **throwaway
   webhook in a private test channel**, never the real recruitment channel.
7. **Frontend** — wire `apply-form.tsx`: submit, loading, success, the four error paths;
   remove the "envio fechado" note and the `disabled` button; add the success block with focus
   management.
8. **Permission cleanup** — remove `canReviewApplications` across all four files (11) and the
   internal-page teaser (12), in one commit.
9. **Docs** — reconcile anything this spec did not already cover, and mark the target sections
   of `CLAUDE.md` as implemented rather than planned.
10. **Full validation** — stop `pnpm dev` first (it and the build fight over `apps/api/dist`),
    then run, in this order:
    ```bash
    pnpm format:check && pnpm build && pnpm lint && pnpm typecheck && pnpm test
    ```
    `build` must come first: lint and typecheck are type-aware and need `packages/shared`
    compiled, or they report `no-unsafe-*` on correct code. Locally a stale `dist` hides this;
    CI does not.

Branch naming comes from Linear (`gitBranchName` on the issue), otherwise the issue↔PR link
breaks. TIT-14 and TIT-17 are the natural homes for this work — both need their descriptions
rewritten first, since they currently describe the persistence design.

---

## 20. Acceptance Criteria

1. Submitting the Apply form results in **exactly one** message in the configured Discord
   channel.
2. **No row is written to any table.** `ApplicationsModule` does not import `PrismaModule`,
   and a test asserts it.
3. `prisma/schema.prisma` and `prisma/migrations/` are **byte-identical** to before the change.
4. The Discord webhook URL appears **only** in the API's environment and `discord.config.ts`.
   `grep -r "DISCORD" apps/web` finds nothing, and the built web bundle does not contain the
   URL.
5. Free text containing `@everyone`, `@here`, role mentions and markdown link syntax arrives
   **inert**: no ping fires, no forged link renders. Covered by tests.
6. Discord failure (5xx, timeout, 429, misconfigured webhook) produces an honest failure
   response; the frontend shows it and **preserves what the applicant typed**. `delivered: true`
   is never returned for an undelivered message.
7. The public endpoint is rate-limited per IP, and the limit is exercised by a test.
8. `APPLICATION_STATUSES`, `applicationStatusSchema`, `ApplicationStatus` and
   `canReviewApplications()` no longer exist, and nothing references them.
9. The "o painel de candidaturas aparecerá aqui" teaser is gone from `/interno`.
10. The "O envio pelo site ainda não está aberto" note and the `disabled` submit button are gone.
11. No documentation describes applications as stored records, as having a status, or as
    reviewable in a panel.
12. `pnpm format:check && pnpm build && pnpm lint && pnpm typecheck && pnpm test` passes, in
    that order, from a clean clone.
13. No test contacts the real Discord.

---

## 21. Out of Scope

- **Any recruitment management system.** No status tracking, no review queue, no assignment,
  no decision history, no notes, no analytics. That is precisely what this change removes.
- **Storing applications anywhere** — including "just a log file", an audit table, or a
  write-behind cache. Accepted consequence: an application submitted while Discord is
  unreachable is lost. If that proves unacceptable in practice, the honest fix is a deliberate
  new decision (a small outbox table with retry), not a quiet re-introduction of persistence.
- **New form fields.** `characterRealm`, `roleSpec`, `contact`, `additionalInfo` are what
  exists (section 6). Battle.net identity, class/spec, availability, experience and log links
  are **not** in the form and must not be invented in the Discord message.
- **Authenticating the applicant.** They are not a member; the endpoint stays public.
- **A `/apply` route.** The form stays a section of the landing page.
- **A Discord bot, slash commands, or reading from Discord** (Linear TIT-35) — a separate
  future integration.
- **Enrichment from Blizzard / Raider.IO at submit time** (TIT-16) — obsolete as specified;
  if ever revived it must not sit in the synchronous submit path.
- **Fixing the duplicated `InternalSummary` interface** — pre-existing, unrelated.
- **Restoring the richer pre-`38c1dd5` schema** — that was a deliberate simplification.
  Reversing it is a product decision, not a side effect of this change.
- **Editing `.env.example`, source code, migrations or tests** — forbidden in the review task
  that produced this document; they are the implementation agent's job.
