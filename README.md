# Personal Finance Command Center

A free, static web app (hosted on GitHub Pages) that runs entirely in your browser on phone and desktop.

- **Database:** one Google Spreadsheet owned by your *primary* Google account.
- **Live data:** Google Calendar and Google Tasks from every Google account you connect (personal, school, work…).
- **No server.** Sign-in uses Google Identity Services in the browser. Tokens are kept in memory only and never saved.

| Page | What it does | Where the data lives |
|---|---|---|
| Home | Today's events + open tasks across all accounts. Create/edit/delete events, create/edit/complete/delete tasks, prev/next day | Google Calendar / Tasks |
| Budget | Zero-based envelope budget, 50/30/20 bucket split, safe-to-spend, plus the month's transactions | `Budget`, `Transactions`, `Settings` tabs |
| Recurring | Bills & subscriptions, with suggestions detected from transactions | `Recurring` tab |
| Goals | Savings goals with projected finish dates | `Goals` tab |
| Workouts | One tab per workout; each is an editable list of exercises (sets, reps, weight, notes) | `Workout - <name>` tabs |
| Settings | Add/remove Google accounts, colors, editable toggle, spreadsheet link | `Settings` tab |

---

## Setup

### 1. Create a Google Cloud project and enable the APIs

1. Go to <https://console.cloud.google.com/> → **New project**.
2. **APIs & Services → Library**, enable:
   - **Google Sheets API**
   - **Google Calendar API**
   - **Google Tasks API**
   - **Google Picker API** (for *Choose from Google Drive*)

### 2. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding / Audience / Data access).
2. User type: **External**. Leave the app in **Testing**.
3. Add these scopes under **Data access**:
   - `.../auth/spreadsheets`
   - `.../auth/calendar.events`
   - `.../auth/calendar.calendarlist.readonly` (lets the app list your calendars so it can show and pick them)
   - `.../auth/tasks`
   - `.../auth/drive.file` (lets the Drive picker open the spreadsheet you choose; the app sees only files you pick or it created)
   - `openid`, `email`, `profile`
4. Under **Audience → Test users**, add **every Google account you'll connect** (personal, school, work). Accounts that aren't listed can't sign in while the app is in Testing.

> **School / work (Google Workspace) accounts:** your Workspace admin may block third-party apps or unverified apps. If sign-in for that account says the app is blocked or needs admin approval, ask the admin to allow (trust) this OAuth client ID under *Admin console → Security → API controls → App access control*.

> In Testing mode Google may ask you to re-consent about every 7 days. That's expected. Just click **Reconnect**.

### 3. Create the OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized JavaScript origins**: add
   - `https://<your-github-username>.github.io` (the GitHub Pages origin, with no path)
   - `http://localhost:5173` (for local development)
4. No redirect URIs are needed (the app uses the popup token flow). There is **no client secret** to store.
5. Copy the **Client ID**.

### 3b. Create an API key for the Drive picker (optional)

1. **Credentials → Create credentials → API key**.
2. Edit the key: **Application restrictions → Websites**, add `https://<your-github-username>.github.io/*` and `http://localhost:5173/*`; **API restrictions → Restrict key → Google Picker API**.
3. The key is not a secret (it ships in the page), but the restrictions keep others from using it.

Without this key the app still works; you paste the spreadsheet link instead of choosing it from Drive.

### 4. Configure GitHub

1. Push this repo to GitHub (default branch `main`).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables** tab → **New repository variable**:
   - `VITE_GOOGLE_CLIENT_ID` = your client ID
   - `VITE_GOOGLE_API_KEY` *(optional)*: the API key from step 3b, for *Choose from Google Drive*.
   - `VITE_SHEET_ID` *(optional, recommended after first run)*: the spreadsheet ID, so every device opens the same sheet without asking.
4. Every push to `main` runs `.github/workflows/deploy.yml`, which builds with `BASE_PATH=/<repo-name>/` and publishes `client/dist` to `https://<username>.github.io/<repo-name>/`.

### 5. First sign-in

1. Open the site and click **Sign in with Google**. The account you choose becomes the **primary** account. It owns the spreadsheet and is the only one that gets the Sheets scope.
2. Choose **Create a new spreadsheet** (named *PFBA Command Center*), **Choose from Google Drive**, or paste the link to an existing one.
3. Copy the spreadsheet ID from **Settings → Spreadsheet** into the `VITE_SHEET_ID` repo variable so phones and other browsers open it automatically.
4. In **Settings → Add account**, connect your other Google accounts. Secondary accounts get Calendar + Tasks only.

## Local development

```bash
cp .env.example .env     # then fill in VITE_GOOGLE_CLIENT_ID (and optionally VITE_SHEET_ID)
npm install
npm run dev              # http://localhost:5173/pfba/
npm run build            # production build into client/dist
```

---

## How it works

### Accounts

- Each connected account has its own OAuth token, held in memory only. The list of accounts (email, display name, color, editable flag) is stored in the `Settings` tab under the `accounts` key.
- **Sign-in flow:** browsers allow one popup per tap. You tap once for the primary account, then the **Connect your other accounts** screen gives each other account a one-tap button. It moves on by itself once all are connected, or you can skip. If you've used an account here before, Google's window closes on its own.
- **Remembered accounts:** the sign-in screen lists the accounts remembered on this device. Only emails, names and colors are stored, in `localStorage`; tokens never are. Signing out clears the list.
- **Refresh on your next tap:** when a token has less than 10 minutes left, or an account isn't connected yet, the app renews it silently (`prompt=none` with `login_hint`) during your next tap anywhere, primary account first and one account per tap. Buttons that open their own Google popup are skipped so they keep their tap.
- If an account needs you to act (consent again, wrong account picked), Home shows an inline error for it with a **Reconnect** button, and the other accounts keep working.
- Google's sign-in script is preloaded at startup so the popup opens immediately inside your tap. Safari blocks popups that open after a delay.
- Home merges events and tasks from all accounts, with a color dot per account and filter toggles. Tasks are grouped by account, then by task list.
- Writes always go to the account that owns the item. New events and tasks default to the primary account, and you can pick any editable account plus a calendar or task list in it. Turn **Editable** off in Settings to make an account read-only.

### Spreadsheet layout

All spreadsheet access goes through `client/src/lib/sheets.js`. It reads every tab once (a single `values:batchGet`) and caches it. Edits update the cache immediately, and a debounced flush writes all changed tabs in a single `spreadsheets:batchUpdate`. The sidebar shows *Saving… / Saved / Not saved, retry*. If you edit the sheet by hand, use **Settings → Reload from sheet**.

Row 1 of each tab is a header, and columns are matched by name. You can add your own columns; the app keeps them.

| Tab | Columns |
|---|---|
| Transactions | `id, txn_id, date, merchant, description, account, is_income, category_id, amount, tags, notes, created_at`. One row per split; a multi-category transaction is several rows sharing `txn_id`. `amount` is negative for spending, positive for income. |
| Budget | `kind, id, name, parent_id, bucket, urgency, cap_type, icon, sort_order, archived, month, category_id, amount`. `kind` is `category`, `allocation` (month + category + amount) or `income` (month + expected income). |
| Recurring | `id, name, amount, frequency, next_due, category_id, account, auto_detected, active` |
| Goals | `id, name, target_amount, current_amount, monthly_contribution, target_date, priority, account, why, created_at` |
| Settings | `key, value` (`split_needs`, `split_investing`, `split_wants`, `accounts`) |
| Workout - *name* | `id, exercise, sets, reps, weight, notes`. Row order is the exercise order. |

The schema lives in `client/src/lib/schema.js`.

## Migrating from the old SQLite app

`scripts/migrate-to-sheets.js` is a dev-only script and is not part of the app bundle. It reads `data/pfba.db` with better-sqlite3 and writes the Budget (categories, allocations, expected income), Transactions, Recurring and Goals data, plus the budget split %, into the spreadsheet.

```bash
npm rebuild better-sqlite3                 # once, if the native module was built on another machine
npm run migrate                            # dry run: prints row counts, writes nothing
SHEET_ID=<id> ACCESS_TOKEN=<token> npm run migrate -- --write
```

`ACCESS_TOKEN` must be an OAuth access token for the sheet's owner with the `spreadsheets` scope. For example, use the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) with the Sheets API v4 scope. The script refuses to overwrite tabs that already contain data unless you add `--force`.

## Privacy and safety

- No financial data, tokens or secrets are committed. `.gitignore` excludes `data/`, `data/backups/` and `.env`.
- The OAuth client ID is not a secret, but it's supplied through a repo variable rather than committed.
- Your data stays in your own Google account. The app talks directly to Google APIs from your browser.
