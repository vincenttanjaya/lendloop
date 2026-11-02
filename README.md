# LendLoop

> Borrow what you need. Lend what you don’t.

LendLoop is a tool-lending board for neighbors. You list the tools you're willing to lend, and you ask to borrow someone else's for a date range. Lenders approve or decline requests, and either side can mark a loan returned. n8n sends a notification whenever a request changes state, and sends a daily reminder for overdue loans. Convex and n8n call each other over HMAC-signed HTTP in both directions.

**Stack:**
- Next.js 16 (App Router, TypeScript, Tailwind 4)
- Clerk (authentication)
- Convex 1.49 (database, functions, HTTP actions, scheduler)
- n8n 2.45.7, self-hosted with Docker Compose
- Vitest and convex-test

[Setup](#local-setup) · [Environment variables](#environment-variables) · [Architecture](#architecture) · [Security](#security-and-data-minimization-decisions) · [Testing](#testing) · [Production](#running-this-in-production-what-i-would-change)

```
app/ components/ lib/   Next.js UI: client components using Convex hooks; proxy.ts guards the signed-in routes
convex/
  schema.ts             tables and indexes
  lib/auth.ts           RBAC helpers (requireUser, requireToolOwner, requireAdmin, ...)
  lib/signature.ts      HMAC sign/verify, used in both directions
  lib/events.ts         the one idempotent insert behind both n8n write-backs
  tools.ts loans.ts     listings and the loan lifecycle
  admin.ts users.ts     admin views; user upsert from the Clerk JWT
  n8n.ts                outbound loan-event webhook, with retries
  http.ts reminders.ts  GET /api/overdue and POST /api/reminders, called by n8n
  seed.ts               demo data
  __tests__/            vitest + convex-test suites
n8n/
  docker-compose.yml .env.example import.sh
  workflows/            exported workflows: loan-event-notification, overdue-reminders, error-handler
.github/workflows/ci.yml  lint, typecheck, test and build on every push and PR
```

Comments that start with `ponytail:` mark a deliberate simplification. Each one names its limit and the upgrade path.

## Local setup

You need:
- Node 22 (see `.node-version`) and npm
- Docker Desktop
- `openssl`
- a Clerk application (a development instance is enough)

Run every command from the repo root.

**1. Install dependencies**

```sh
npm ci
```

**2. Clerk**

1. Create an application in the Clerk dashboard.
2. In **User & authentication**, turn on **First and last name** (or **Username**), or offer a social sign-in such as Google. LendLoop shows people by the name in their token. A user without one is stored as *Neighbor* plus the last 4 characters of their Clerk user id (for example *Neighbor 9fQz*), so two such users can still be told apart on `/admin`.
3. Connect Clerk to Convex with a **JWT template**: create one from the **Convex** preset and name it exactly `convex`. The preset carries `name` (`{{user.full_name}}`) and `nickname` (`{{user.username}}`), which is where LendLoop gets display names. `ConvexProviderWithClerk` asks Clerk for that template, and `convex/auth.config.ts` accepts its audience, `convex`.

   Don't also turn on Clerk's one-click *Convex integration*. When it's on, the provider sees `aud: "convex"` in the session and sends Clerk's default session token instead of the template. That token has no name claims, so every user would show as *Neighbor …*. If you prefer the integration, use it instead of the template and add `"name": "{{user.full_name}}"` and `"nickname": "{{user.username}}"` under **Sessions → Customize session token**, next to the `aud` claim it already maps.
4. Note the **Frontend API URL** (`https://<your-instance>.clerk.accounts.dev`). You'll set it as `CLERK_JWT_ISSUER_DOMAIN`.
5. Note the publishable key and the secret key.

If this wiring is wrong (no `convex` template, or a wrong `CLERK_JWT_ISSUER_DOMAIN`), Clerk signs you in but Convex rejects the token. The app then shows a red banner saying it couldn't verify your session, rather than loading forever.

**3. Convex.** In terminal 1, start the dev deployment and leave it running:

```sh
npx convex dev
```

- **Local deployment:** choose *Start without an account (run Convex locally)*. The API is then at `http://127.0.0.1:3210` and HTTP actions are at `http://127.0.0.1:3211`. `CONVEX_AGENT_MODE=anonymous npx convex dev` does the same without the prompt.
- **Cloud dev deployment:** log in instead.

`convex dev` writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` to `.env.local`.

The first push stops with *"Environment variable CLERK_JWT_ISSUER_DOMAIN is used in auth config file but its value was not set"*. That's expected: `convex dev` keeps watching and pushes again as soon as you set the variable.

In terminal 2, set the deployment variables:

```sh
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-instance>.clerk.accounts.dev
npx convex env set LENDLOOP_WEBHOOK_SECRET "$(openssl rand -hex 32)"
npx convex env set N8N_LOAN_EVENT_WEBHOOK_URL http://127.0.0.1:5678/webhook/lendloop/loan-event
```

Wait until terminal 1 prints *Convex functions ready!*. Until then the deployment has no functions, and the seed would fail with *Could not find function*. Then seed the demo data:

```sh
npx convex run seed:demo   # optional; run it before the first sign-in, because it does nothing once any user exists
```

The seed creates two users, Alice and Bob, with the placeholder Clerk ids `user_alice` and `user_bob`. Nobody can sign in as them. They own 4 tools, and they're party to one pending loan and one approved loan that ended 3 days ago, which gives the reminder workflow something to do.

On a cloud deployment, Convex can't reach `127.0.0.1`. Use a public URL for n8n, such as a tunnel.

**4. Next.js.** Add the Clerk keys to `.env.local`. `.env.example` lists every variable.

```sh
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

Then start the app and open http://localhost:3000:

```sh
npm run dev
```

**5. Make yourself an admin.** Sign in once, then find your Clerk user id (`user_...`). It's shown in the Clerk dashboard under Users, and in the `clerkId` column of `npx convex data users`. Then set it:

```sh
npx convex env set ADMIN_CLERK_IDS user_xxxxxxxxxxxx   # comma-separated for several admins
```

Admin rights take effect on your next request, because the variable is checked on every admin call. The **Admin** nav link appears after a page reload, when `users.ensure` recomputes your stored role.

**6. n8n.** Write `n8n/.env`, start n8n and import the workflows. `n8n/.env` is git-ignored. Its secret must match the one Convex has, so the command reads it back from Convex. Alternatively, `cp n8n/.env.example n8n/.env` and fill it in by hand.

```sh
printf 'N8N_ENCRYPTION_KEY=%s\nLENDLOOP_WEBHOOK_SECRET=%s\nCONVEX_SITE_URL=http://host.docker.internal:3211\n' \
  "$(openssl rand -hex 32)" "$(npx convex env get LENDLOOP_WEBHOOK_SECRET)" > n8n/.env
docker compose -f n8n/docker-compose.yml up -d
curl -s http://127.0.0.1:5678/healthz   # repeat until it prints {"status":"ok"}
./n8n/import.sh                          # imports the 3 workflows, publishes (activates) them, restarts n8n
docker compose -f n8n/docker-compose.yml exec -T n8n n8n list:workflow --active=true
```

- On a cloud deployment, set `CONVEX_SITE_URL=https://<deployment>.convex.site` instead.
- Everything is driven from the n8n CLI, so you don't need the n8n editor. Compose publishes n8n on `127.0.0.1:5678` only, so nobody else on your network can reach it.
- If you open http://localhost:5678, or expose n8n through a tunnel, create the owner account straight away. Until someone claims it, whoever reaches the editor first becomes the owner and can read `$env` secrets from a Code node.

**7. Watch the automations**

*Notification:* in the app, request to borrow one of the seeded tools, such as Alice's *Leaf rake*, then check the n8n logs:

```sh
docker compose -f n8n/docker-compose.yml logs n8n | grep "LendLoop notify"
```

Once n8n has answered 200, the loan's activity on `/my/requests` shows *Notified Alice (requested)*.

*Reminders:* the schedule fires daily at 09:00 UTC. To run it now:

```sh
docker compose -f n8n/docker-compose.yml exec -T -e N8N_RUNNERS_BROKER_PORT=5680 n8n n8n execute --id lendloop-overdue-reminders
npx convex data automationEvents
```

- **Command output:** a `[LendLoop reminder] Alice Four-person tent 3 days overdue` line. CLI runs print to the command's own output, not to `docker compose logs`.
- **Data:** the table gains one row, `reminder:<loanId>:<today>`.
- **In the app:** as an admin, open `/admin` → *All loans*. The *Four-person tent* loan shows *Overdue* and *Reminder sent via mock · N seconds ago*. Alice and Bob can't sign in, so `/admin` is the only page that shows their loan.
- **Second run the same day:** it finds nothing to remind and writes nothing.
- **Why the extra flag:** `-e N8N_RUNNERS_BROKER_PORT=5680` keeps the CLI's task broker off port 5679, which the server already uses.

*Both sides of a loan:* Alice and Bob can't sign in, so nobody can approve your *Leaf rake* request, and your *Incoming requests* page stays empty. To try approve, decline and lender-side *Mark returned*, play the second party in one of two ways:

- **Act as Alice from the CLI.** Find the loan id, then approve it as her. `--identity` runs the mutation as that Clerk user, through the same Convex checks as the UI.

  ```sh
  npx convex data loans   # the Leaf rake loan's _id
  npx convex run loans:approve '{"loanId":"<id>"}' --identity '{"subject":"user_alice","name":"Alice"}'
  ```

  `/my/requests` then shows the loan as approved, with a *Notified … (approved)* activity line addressed to you, and you can mark it returned yourself.
- **Use a second Clerk account.** Sign up as someone else in a private window. Account A lists a tool on `/my/listings`. Account B requests it on `/tools`. A approves it on `/my/incoming`, and B marks it returned on `/my/requests`. Each step adds a `LendLoop notify` line to the n8n logs and an activity line to the loan. As an admin, tick *Trusted Lender* for A on `/admin` to see the badge on `/tools`.

**Stop:** `docker compose -f n8n/docker-compose.yml down`.

**Reset:** `down -v` also deletes the volume, including the imported workflows. The volume keeps the `N8N_ENCRYPTION_KEY` it was first started with, so reset it whenever you change that key.

## Environment variables

**Next.js**: `.env.local`, git-ignored. `.env.example` is the template.

| Variable | Purpose | Example |
|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | Convex client URL. Written by `npx convex dev`. | `http://127.0.0.1:3210` |
| `CONVEX_DEPLOYMENT` | Deployment the Convex CLI targets. Written by `npx convex dev`. | *(generated)* |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk frontend key | `pk_test_…` |
| `CLERK_SECRET_KEY` | Clerk server key, used by `proxy.ts` | `sk_test_…` |

**Convex deployment**: set with `npx convex env set NAME value`. These are never stored in a repo file.

| Variable | Purpose | Example |
|---|---|---|
| `CLERK_JWT_ISSUER_DOMAIN` | Issuer that `convex/auth.config.ts` trusts (audience `convex`) | `https://verb-noun-12.clerk.accounts.dev` |
| `ADMIN_CLERK_IDS` | Comma-separated Clerk user ids with admin rights; checked on every admin call | `user_2abc…,user_2def…` |
| `LENDLOOP_WEBHOOK_SECRET` | HMAC secret shared with n8n, used in both directions. If unset, the HTTP actions return a loud 500. | output of `openssl rand -hex 32` |
| `N8N_LOAN_EVENT_WEBHOOK_URL` | n8n production webhook for loan events. If unset, events are skipped with a warning. | `http://127.0.0.1:5678/webhook/lendloop/loan-event` |

**n8n**: `n8n/.env`, git-ignored. `n8n/.env.example` is the template.

| Variable | Purpose | Example |
|---|---|---|
| `N8N_ENCRYPTION_KEY` | Encrypts n8n's credential store. Compose refuses to start without it, and the volume keeps the first value. | output of `openssl rand -hex 32` |
| `LENDLOOP_WEBHOOK_SECRET` | Must equal the Convex value | same as Convex |
| `CONVEX_SITE_URL` | Origin of the Convex HTTP actions, as seen from the container | `http://host.docker.internal:3211` |

`n8n/docker-compose.yml` also fixes these values:

| Setting | Why |
|---|---|
| port `127.0.0.1:5678` | Loopback only. The owner account is usually left unclaimed (the CLI does everything), and nodes can read `$env`, so n8n must not be reachable from the LAN. |
| `NODE_FUNCTION_ALLOW_BUILTIN=crypto` | Code nodes compute the HMAC. |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` | Nodes read `$env.*`. |
| `CODE_ENABLE_STDOUT=true` | Mock messages reach `docker compose logs`. |
| `GENERIC_TIMEZONE=UTC` | The schedule fires at 09:00 UTC. It must be an IANA zone name. |

## Architecture

```
Browser ─Clerk session─▶ Next.js UI ─Convex client + Clerk JWT─▶ Convex queries/mutations (all RBAC here)
                                                                     │ scheduler.runAfter(0)
                                                                     ▼
                          n8n "Loan event notification" ◀─signed POST─ n8n.sendLoanEvent
n8n "Overdue reminders" (09:00 UTC) ─signed GET /api/overdue, signed POST /api/reminders─▶ Convex HTTP actions
n8n "Error handler" ◀─ any failed execution of the two workflows above
```

**UI routes.** `/` is public. `proxy.ts` (Clerk middleware) sends signed-out visitors away from every other route, but authorization itself happens in Convex.

| Route | Shows |
|---|---|
| `/` | `LendLoop`, the tagline, available tools (name and category only), and the *Sign in to lend or borrow* button |
| `/tools` | Every tool, with a category filter, owner, *Trusted Lender* badge, Available/On loan status, and a date-range request form |
| `/my/listings` | Create, edit and delete your own tools |
| `/my/requests` | Your loans: cancel a pending one, or mark an approved one returned (asks to confirm, since it can't be undone) |
| `/my/incoming` | Requests for your tools: approve, decline, or mark returned |
| `/admin` | Admins only: all loans, all listings with Remove (which also ends an active loan), and users with a *Trusted Lender* toggle |

Each loan row shows:
- the dates
- the status, plus an *Overdue* tag when it applies
- recent automation activity, for example *Reminder sent via mock · 2 days ago*

### Data model (`convex/schema.ts`)

| Table | Fields | Indexes |
|---|---|---|
| `users` | `clerkId`, `name`, `role` (`admin`\|`user`), `trustedLender` | `by_clerkId` |
| `tools` | `ownerId`, `name`, `category`, `condition`, `description` | `by_owner`, `by_category` |
| `loans` | `toolId`, `toolName` (a copy, so history survives deleting the tool), `borrowerId`, `lenderId`, `startDate`, `endDate`, `status`, `createdAt`, `updatedAt` | `by_tool`, `by_borrower`, `by_lender`, `by_status_endDate` |
| `automationEvents` | `loanId`, `kind` (`notification`\|`reminder`), `idempotencyKey`, `message`, `createdAt` | `by_loan`, `by_key` |

Rules:
- **Fixed value lists:** categories, conditions and statuses are defined in `convex/constants.ts` and enforced by validators.
- **Dates:** `YYYY-MM-DD` strings. "Today" means today in UTC.
- **Available:** a tool is available if it has no `approved` loan.
- **Overdue:** a loan is overdue if it is `approved` and its `endDate` is before today.

### Loan lifecycle (`convex/loans.ts`)

```
loans.request (borrower) ─▶ pending ─approve (lender; tool must be free)─▶ approved ─markReturned (lender or borrower)─▶ returned
                              ├─decline (lender)───────────────────────▶ declined     └─tools.remove (admin)─▶ cancelled
                              └─cancel (borrower), or tools.remove ────▶ cancelled
                                (removing a tool cancels its pending requests)
```

`request` runs these checks in order:
1. the caller is signed in
2. the tool exists and isn't the caller's own
3. both dates are real `YYYY-MM-DD` dates
4. the end date is on or after the start date, and not in the past
5. the tool isn't on loan
6. the caller has no other pending request for this tool

Other rules:
- `approve` checks availability again, and refuses a request whose end date has passed. A request can wait behind another loan past its own dates; approving it then would create a loan that is overdue from the start. The lender can still decline it.
- **Removing a tool on loan:** its owner can't, and is told to mark the loan returned first. An admin can remove any listing; that also cancels the active loan, and the borrower is notified.
- **Either side can mark a loan returned.** The borrower is trusted with this so a lender who never confirms can't leave them getting daily overdue reminders. The lender is notified straight away, and in the app the action asks for confirmation because it can't be undone. A lender who disagrees has no in-app way to reopen the loan yet (see the production notes).
- **Event scheduling:** every transition goes through `setLoanStatus`. It sets `status` and `updatedAt`, and schedules `n8n.sendLoanEvent` in the same transaction. An event is queued only if the change commits.

Who gets each event:

| Event | Recipient |
|---|---|
| `requested` | the lender |
| `approved`, `declined` | the borrower |
| `cancelled`, `returned` | whichever party did not act (the borrower, when an admin removed the tool) |

### Automation 1: loan-event notification

```
mutation commits ─▶ scheduler ─▶ n8n.sendLoanEvent (internalAction)
   loadLoanEvent builds the 8-field payload (its `returns` validator rejects any extra field)
   POST N8N_LOAN_EVENT_WEBHOOK_URL  + X-LendLoop-Timestamp, X-LendLoop-Signature
n8n "LendLoop - Loan event notification"
   Webhook (raw body) ─▶ Verify signature ─▶ valid? ─no──▶ Respond 401 {"error":"invalid signature"}
                                                    └yes─▶ Compose notification ─▶ Mock deliver (log) ─▶ Respond 200 {"ok":true}
Convex, on 2xx                         ─▶ recordNotification  notify:<loanId>:<event>:<updatedAt>  (shown as loan activity)
Convex, on non-2xx/error/10 s timeout  ─▶ retry after 5 s, then 30 s; the third failure throws
```

Only the HTTP call is retried. If n8n has answered 2xx and the bookkeeping write then fails, the action throws instead of retrying, because a retry would notify the recipient a second time.

The payload contains only `eventId, event, loanId, toolName, startDate, endDate, recipient {clerkId, name}, actorName`.

To deliver for real, replace the one *Mock deliver* node with an Email, Slack or Discord node. For email, look up the address with Clerk's Backend API using `recipient.clerkId`, so Convex still never stores an email address.

### Automation 2: overdue reminders

```
n8n "LendLoop - Overdue reminders": Schedule 09:00 UTC  (or the Manual Trigger "Run now (CLI)")
   Sign GET ─▶ GET {CONVEX_SITE_URL}/api/overdue                     10 s timeout; retry: 3 tries, 2 s apart
        Convex: verify ─▶ reminders.overdue(asOf = today UTC)
                approved, endDate < asOf, no reminder:<loanId>:<asOf> row yet
                ─▶ {asOf, loans: [{loanId, toolName, endDate, daysOverdue, borrower {clerkId, name}}]}
   Split Out loans ─▶ Loop over loans, one at a time:
      Mock remind (log) ─▶ Sign write-back
      ─▶ POST {CONVEX_SITE_URL}/api/reminders {loanId, reminderDate: asOf, status: "sent", channel: "mock"}
                                                                     10 s timeout; retry: 3 tries, 2 s apart
           Convex: verify the raw body ─▶ validate ─▶ reminders.record ─▶ 200 {ok, duplicate} | 400 | 401 | 404
      ─▶ back to the loop for the next loan
Any failed execution ─▶ "LendLoop - Error handler": Error Trigger ─▶ Format ─▶ Mock alert
                        log line: [LendLoop automation error] {workflow, executionId, error, lastNode}
```

The loop writes each loan's reminder back right after sending it. n8n otherwise runs every node over all items before the next node starts, so every borrower would be reminded before anything was recorded. A failure partway (Convex down, or a real Email/Slack node throwing) would then leave many borrowers reminded but unrecorded, and a re-run would remind them all again.

### Where RBAC is enforced

Every rule is enforced inside Convex functions. The UI and `proxy.ts` only decide what to show. The helpers live in `convex/lib/auth.ts`:

| Helper | Rule | Used by |
|---|---|---|
| `requireUser` | A Clerk identity with a `users` row. Otherwise `Sign in required`. | every non-public query and mutation |
| `requireToolOwner` | The caller owns the tool. Otherwise `Forbidden` (or `Not found`). | `tools.update` |
| `requireAdmin` | The caller's `clerkId` is in `ADMIN_CLERK_IDS`. The env var is checked, not the stored role. | `admin.allLoans`, `admin.allTools`, `admin.users`, `admin.setTrustedLender` |
| `isAdminClerkId` | The same env check | `tools.remove` (owner or admin; only an admin can remove a tool on loan), role sync in `getOrCreateUser` |
| `getOrCreateUser` | Upserts the user from the JWT. The name is trimmed and capped at 80 characters, falling back to "Neighbor" plus the last 4 characters of the Clerk id. | `users.ensure` |

Loan actions go through `loanForTransition` in `convex/loans.ts`, which checks, in order:
1. sign-in
2. that the loan exists
3. that the caller is the right party:
   - the lender, for `approve` and `decline`
   - the borrower, for `cancel`
   - either one, for `markReturned` (why the borrower may: see *Other rules* above)
4. the current state

Authorization comes before the state check, so outsiders learn nothing about a loan.

Scoping and access:
- **Lists:** `loans.mine` and `loans.incoming` read only the caller's slice of the index.
- **Public functions:** only `tools.listPublic` and `users.current` (which returns `null` when signed out).
- **Internal functions:** everything n8n touches is an `internal*` function. Clients can't call these; they're reachable only from other Convex functions (the scheduler and the signed HTTP actions) or with the CLI's admin key.

### Signature scheme (`convex/lib/signature.ts`, n8n Code nodes)

Both directions use the same headers:
- `X-LendLoop-Timestamp`: epoch milliseconds.
- `X-LendLoop-Signature`: `sha256=` + lowercase hex of HMAC-SHA256(`LENDLOOP_WEBHOOK_SECRET`, `` `${timestamp}.${rawBody}` ``). `rawBody` is the exact body as UTF-8, or `""` for GET.

The receiver rejects a request in three cases:
- a header is missing
- `|now − timestamp| > 300000` ms (this also catches a non-numeric timestamp)
- the HMAC doesn't match. The comparison is constant-time: Convex XOR-accumulates every byte, and n8n uses `crypto.timingSafeEqual`.

Both receivers check the signature against the raw bytes before parsing JSON. Convex uses `request.text()`, and the n8n Webhook node has *Raw Body* enabled. Senders stringify once and send exactly that string.

### Idempotency

| Key | Written by | Effect |
|---|---|---|
| `notify:${loanId}:${event}:${updatedAt}` | `n8n.recordNotification`, after n8n returns 2xx | Inserts only if absent, so a retried delivery leaves one row. |
| `reminder:${loanId}:${reminderDate}` | `reminders.record`, via `POST /api/reminders` | A repeat returns `{duplicate: true}`. `/api/overdue` skips loans already reminded that day. |

Both mutations go through one helper, `insertEventOnce` in `convex/lib/events.ts`. Its check-then-insert runs inside the calling Convex mutation, and mutations are serializable transactions. Concurrent retries therefore can't both insert.

The keys stop duplicate rows, not duplicate deliveries: sending a notification or reminder is at-least-once. A notification whose 2xx is lost in transit is sent again, and a reminder whose write-back fails is sent again by the next run (see *Known trade-offs*).

### Retries and failure visibility

| Path | On failure | Where it shows |
|---|---|---|
| Convex → n8n webhook | Each attempt times out after 10 s. Retries after 5 s, then 30 s. The third failure throws `n8n webhook failed after 3 attempts: …` | `npx convex logs` / Convex dashboard |
| n8n → Convex (both HTTP nodes) | 10 s timeout per try. Retry On Fail: 3 tries, 2 s apart, about 34 s at worst, well inside the 5-minute signature window. After that the execution fails. | the error workflow |
| Any node throws in either workflow | `settings.errorWorkflow = lendloop-error-handler` | a `[LendLoop automation error] …` line in `docker compose -f n8n/docker-compose.yml logs n8n` |
| n8n rejects a signature | Responds 401. This is a normal response, not a failed execution. | Convex sees a non-2xx response, retries, then throws |
| Secret unset (either side) | Plain `Error`, never a silent pass | a 500 or a failed action / Code node |
| `N8N_LOAN_EVENT_WEBHOOK_URL` unset | `console.warn`, then the event is skipped (for local dev without n8n) | Convex logs |

**Recovering a failed reminder run:** run the whole workflow again (the `n8n execute` command in step 7, or wait for the next day). Don't use n8n's *Retry* on the failed execution. It resumes at the failed HTTP node with the signature computed during the first run, and Convex rejects that once it is 5 minutes old.

Known trade-offs:
- **Reminders are at-least-once.** If a write-back fails after its reminder went out, a re-run reminds that one borrower again. The per-loan loop keeps this to at most one loan per failed run; loans after it wait for the re-run instead of being reminded unrecorded.
- **A `failed` write-back blocks the loan for the day.** A reminder written back with status `failed` still uses that loan's key for the day, so the loan drops out of `/api/overdue` until tomorrow. The shipped workflow only ever writes `sent`: if delivery fails, the execution fails and raises an alert instead.
- **The `eventId` can be newer than the change.** It's built when the event is sent, not when it was scheduled. If the loan changes again before the send, the payload carries the newer `updatedAt`. Keys stay unique.
- **Availability is a yes/no flag.** A tool is either on loan or not; there's no booking calendar.

## Security and data-minimization decisions

- **Authorization lives in Convex.** Every query and mutation checks identity and ownership itself (see the RBAC table above). Hiding a button in the UI is only for convenience.
- **Admin status comes from deployment config.** `ADMIN_CLERK_IDS` is read on every admin call. The stored `role` is display-only, so revoking an admin takes effect immediately. A client that never calls `users.ensure` can't keep a stale role.
- **No email addresses in Convex.** `users` holds only the Clerk id, display name, role and trusted flag. The Clerk JWT may carry more claims; `getOrCreateUser` reads only `subject`, `name` and `nickname`. A user with no name in the token gets *Neighbor* plus the last 4 characters of their Clerk id: enough to tell such users apart on `/admin` without collecting anything else.
- **Minimal payloads, enforced by `returns` validators.** Convex itself rejects any extra field in:
  - the webhook payload (8 fields)
  - the overdue feed (`loanId, toolName, endDate, daysOverdue, borrower {clerkId, name}`)
  - the public list (`_id, name, category`)

  `admin.users` doesn't expose `clerkId`. In n8n, *Compose notification* uses only the fields its message needs.
- **The public page shows only available tools' name and category.** It shows no owners, conditions, descriptions or loans.
- **Signed in both directions.** HMAC-SHA256 over the timestamp and raw body, a 5-minute timestamp window, and a constant-time comparison.
- **Secrets live only in environment variables.**
  - Convex keeps them in deployment env vars, and n8n in `n8n/.env`. Git ignores `.env*` except `.env.example`.
  - The workflow JSON refers to secrets only as `$env.LENDLOOP_WEBHOOK_SECRET` and `$env.CONVEX_SITE_URL`. The exported files were grepped for the secret, the encryption key and `sk_`/`pk_` strings: 0 hits.
  - Compose won't start without `N8N_ENCRYPTION_KEY`.
- **n8n listens on loopback only.** Compose publishes `127.0.0.1:5678`. Nodes can read `$env` (so the Code nodes can sign), and the owner account is usually left unclaimed because the CLI does everything. On an address the LAN could reach, the first visitor could claim the owner account and read the shared secret from a Code node.
- **Idempotent write-backs.** Keys are per notification transition and per loan per day, as described above.
- **Input validation.**
  - Every argument has a Convex validator: ids, and the fixed category, condition and status lists.
  - Names are trimmed and must be 1–80 characters; descriptions at most 500.
  - Dates must be real calendar dates (`2026-02-30` is rejected).
  - The HTTP write-back body is validated (400 if not). An unknown or malformed loan id gets 404, not 500.
  - An owner can list at most 50 tools. That caps how much any one account adds to the public full-scan query; sign-ups are open, so pagination (see the production notes) is the real bound.
- **Errors don't leak.** User-facing failures are `ConvexError`s with plain messages (`Sign in required`, `Forbidden`, `Not found`). Misconfiguration throws a plain `Error`, so it's loud in the logs.

## Testing

```sh
npm test            # vitest run: convex-test exercises the real schema and functions in edge-runtime
npm run typecheck   # next typegen && tsc --noEmit
npm run lint        # eslint
```

`.github/workflows/ci.yml` runs these three plus `npm run build` on every push and pull request. None of them needs a secret: `convex/_generated` is committed, and the build gets placeholder Clerk and Convex values.

The suites go through the public Convex API wherever they can, with signed-in identities from `convex/__tests__/test.setup.ts`. The loans, admin and integration suites use fake timers to pin "today" to 2026-11-02, which also keeps scheduled n8n calls queued instead of running.

| File | Covers |
|---|---|
| `tools.test.ts` | `users.ensure` upsert and admin role from `ADMIN_CLERK_IDS`; `listPublic` returns exactly `_id, name, category` and hides tools on loan; `list` availability, ownership, *Trusted Lender* flag and category filter; `mine`; non-owners can't update or remove; admins can remove any tool; name and description limits |
| `loans.test.ts` | `request` creates a pending loan and schedules `requested`; every `request` rejection (own tool, bad dates, end before start, past end, tool on loan, duplicate pending); only the lender approves or declines; `approve` refuses a request whose end date has passed; only the borrower cancels; lender or borrower returns; illegal state transitions; availability flips on approve and return; `mine`/`incoming` with names, overdue flag and activity; an owner can't remove a tool on loan, removal cancels pending requests, and an admin's removal also cancels the active loan and notifies the borrower |
| `admin.test.ts` | Non-admins get `Forbidden` on every admin function; admins see all loans and tools; trusted-lender toggle; `seed.demo` runs once |
| `auth.test.ts` | Table-driven: every non-public Convex function rejects anonymous callers with `Sign in required`, with a guard that fails if a new public function is missing from the table; `listPublic` works anonymously; a stored `role: "admin"` not listed in `ADMIN_CLERK_IDS` is `Forbidden` on admin functions and `tools.remove`; JWT names are trimmed, capped at 80 characters and fall back to "Neighbor" plus an id suffix; the 51st tool per owner is rejected |
| `lib/__tests__/format.test.ts` | `formatDate` (UTC calendar date) and `relativeTime` formatting used by the UI |
| `integration.test.ts` | `sign`/`verify` against a pinned Node `createHmac` vector, plus mismatch, stale and missing headers; `GET /api/overdue` returns 401 when unsigned or wrongly signed, returns only the minimal fields, and skips loans already reminded; `POST /api/reminders` is idempotent, returns 400 for a bad body and 404 for an unknown loan; `sendLoanEvent` posts a signed minimal payload and records the notification, picks the right recipient per event, retries after 5 s and 30 s and then throws, aborts a call n8n never answers after 10 s and retries, warns and skips without a URL, and throws without a secret |

### End-to-end n8n verification

These checks ran against n8n 2.45.7 in Docker, using the committed compose file and workflows, with requests signed using the shared secret.

**Inbound webhook**

| Request | Result |
|---|---|
| Valid signature | 200 `{"ok":true}`, plus a `[LendLoop notify] user_alice Hi Alice, …` log line |
| Signature of all zeros | 401 |
| Timestamp 6 minutes old | 401 |
| No signature headers | 401 |
| Non-ASCII body (`Zoë’s`) with non-canonical JSON spacing | 200, showing the HMAC covers the raw bytes |
| Correctly signed, unknown event type | n8n returns 500 (so Convex would retry), and the error workflow logs `[LendLoop automation error] … "lastNode":"Compose notification"` |

**Overdue workflow, against a mock of the Convex endpoints that checks signatures the same way Convex does**

| Scenario | Result |
|---|---|
| Two overdue loans | Each loan reminded and its signed write-back accepted, one loan at a time; a second run finds nothing to do |
| The first loan's write-back fails (500) | *Record reminder* tries 3 times, 2 s apart, and the run exits 1. The second loan is not reminded; it waits for the re-run |
| `/api/overdue` accepts the connection but never answers | Each try times out after 10 s; 3 tries, about 12 s apart, all still inside the signature window; the run exits 1 |
| Empty feed | Succeeds and writes nothing |
| Wrong secret | 401 on all 3 tries; the run exits 1 |
| `CONVEX_SITE_URL` points at a closed port | *Fetch overdue loans* tries 3 times about 2 s apart, then the error workflow logs its alert |

The first three rows ran against the current workflow, with the per-loan loop and the 10 s timeouts. The last three come from the first round, before those changes. They fail at *Fetch overdue loans*, before any loan is processed, so the loop doesn't change them, and the empty feed was checked again against the real backend (below).

The closed-port failure was also fired by the real 09:00 Schedule Trigger inside the server process. A timezone override put 09:00 local within the hour, so the server-side path ran without waiting for 09:00 UTC.

**Exported workflow JSON**
- 0 hits for the secret, the encryption key, or `sk_`/`pk_` strings.
- The current export was re-imported into a fresh volume. A real `returned` event from Convex was then delivered, an all-zeros signature got 401, and the two-loan and failing-write-back runs above gave the same results again.

**Caveat:** under `n8n execute` (the CLI), the error workflow is started without being awaited, so its alert line appears only some of the time. The CLI still exits 1 with the full error. Server-side runs (webhook and schedule) don't have this race.

**Live run against the real Convex functions**

The same stack was then run against the real backend: `npx convex dev` (anonymous local deployment, ports 3210/3211), `npx convex run seed:demo`, and the committed compose file and `n8n/import.sh`, with one shared secret on both sides.

| Check | Result |
|---|---|
| `n8n execute --id lendloop-overdue-reminders`, first run | Succeeds; `[LendLoop reminder] Alice Four-person tent 3 days overdue`; write-back `{"ok":true,"duplicate":false}`; exactly one `reminder:` row in `automationEvents` |
| Same command, second run | Succeeds; the feed is `loans: []`; still exactly one row |
| Signed replay of the same write-back | `{"ok":true,"duplicate":true}`; tampered, stale, unknown-loan and bad-date requests get 401, 401, 404 and 400; still one row |
| The committed daily Schedule Trigger, inside the server process | Fired on schedule (timezone override to bring 09:00 local within the hour), logged the reminder, wrote exactly one row, and re-armed for the next day |
| `internal.n8n.sendLoanEvent` for the seeded pending loan | `[LendLoop notify] user_alice Hi Alice, Bob asked to borrow your Cordless drill …` in `docker compose logs`; one `notify:` row. Sending it again: n8n logs again, Convex still has one row |
| The real mutations (`approve`, `markReturned`, `request`, `cancel`, `tools.remove`) via `npx convex run --identity` | Each produced one notification to the right recipient and one `notify:` row |
| An admin's `tools.remove` on the overdue *Four-person tent* | The loan becomes `cancelled`; `[LendLoop notify] user_alice Hi Alice, Ada Admin cancelled the request for the Four-person tent …`; one `notify:` row |
| `N8N_LOAN_EVENT_WEBHOOK_URL` on a closed port | Attempts at +0 s, +5 s and +35 s (retry delays of 5 s, then 30 s), then `n8n webhook failed after 3 attempts: … Connection refused` in the Convex log and `state: failed` in `_scheduled_functions` |
| `CONVEX_SITE_URL` on a closed port | *Fetch overdue loans* tries 3 times, the run exits 1, and the error workflow logs `[LendLoop automation error] … "lastNode":"Fetch overdue loans"` |

The first two rows, the `request`/`approve`/`markReturned` mutations and the admin removal were run again after the per-loan loop, the 10 s timeouts and the admin-removal change, with the same results. The other rows are from the first live run.

That first run caught one real bug: the `cancelled` message read "cancelled their request for your tool" even when a lender removed a listing and the borrower was the recipient. The template is now direction-neutral, like `returned`.

## Running this in production (what I would change)

- **Hosting**
  - A Convex production deployment (`npx convex deploy`) and the Next.js app on Vercel.
  - A Clerk production instance on our own domain, with `CLERK_JWT_ISSUER_DOMAIN` updated to match. The `convex` token should be trimmed to the claims we read.
  - n8n with Postgres instead of SQLite, queue mode (Redis plus workers), and HTTPS behind a reverse proxy.
  - Expose only `/webhook/*` publicly; put the editor behind SSO or a VPN.
  - Run external task runners (`n8nio/runners`, `N8N_RUNNERS_MODE=external`), since internal mode is deprecated.
  - Pin the n8n image by digest.
- **Secrets**
  - Use a separate secret for each direction, kept in a secret manager.
  - Support rotation by accepting both the current and the previous secret during an overlap window.
  - Move the n8n side from `$env` into n8n credentials, and turn `N8N_BLOCK_ENV_ACCESS_IN_NODE` back on.
- **Replay protection**
  - Today a replay inside the 5-minute window is harmless for write-backs, which are idempotent, but could resend a notification.
  - Store each delivered `eventId` (or a nonce) and reject repeats.
- **Rate limiting** on the HTTP actions (at the proxy, or with Convex's rate-limiter component) and on `loans.request` / `tools.create` per user.
- **Observability**
  - Structured JSON logs carrying `eventId` and `loanId`.
  - Stream Convex logs to Datadog or Axiom, and send Next.js and Convex errors to Sentry.
  - Point the error workflow at Slack or PagerDuty instead of `console.log`.
  - Alert when `sendLoanEvent` gives up after 3 attempts, and record that as a `failed` activity row so the UI shows it.
  - Add a dead-man's switch that alerts if the 09:00 run doesn't happen.
- **Data**
  - Scheduled Convex snapshot exports and Postgres backups for n8n.
  - An `auditLog` table for admin actions (removals, trusted-lender changes) and loan transitions.
  - Paginate `listPublic` and the admin lists, and add a `["toolId", "status"]` index (both are marked `ponytail:` in the code).
- **Correctness upgrades**
  - Pass `updatedAt` into `sendLoanEvent` when the event is scheduled.
  - Make a `failed` reminder not consume the day's key.
  - Let a lender dispute a borrower's *returned* within a few days, reopening the loan, and notify both parties (not only the borrower) when an admin removes a listing that is on loan.
  - Replace the yes/no availability flag with a booking calendar.
- **Web hardening:** CSP and security headers (`frame-ancestors`, `script-src` limited to the Clerk and Convex origins), plus HSTS.
- **Supply chain and process**
  - Pin exact dependency versions and use Renovate or Dependabot.
  - Add `npm audit` to the CI workflow.
  - Preview deployments, with a separate Convex preview deployment for each PR.
