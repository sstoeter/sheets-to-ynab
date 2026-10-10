# Google Sheets to YNAB Synchronizer

A Google Workspace Editor Add-on for Google Sheets that synchronizes bank transactions directly with [YNAB (You Need A Budget)](https://www.ynab.com/) using the official YNAB REST API and OAuth 2.0.

---

## Features

- **OAuth 2.0 Centralized Model**: Seamless connection using YNAB OAuth 2.0 Authorization Code Grant with automatic refresh token handling.
- **Formula-Driven Friendly**: Safely handles formula-populated sheets (e.g. `=FILTER(...)` or `=ARRAYFORMULA(...)` referencing raw CSV exports). Status columns are treated as an ephemeral cache and refreshed idempotently on every sync.
- **Ambiguous Duplicate Protection**: Uses a 1-to-1 consumption pool so identical transactions on the same day match accurately without double-linking.
- **Milliunit Conversion**: Automatically converts human-readable decimals (e.g. `42.13`) into YNAB integer milliunits (`-42130`).
- **Deduplication Key**: Generates deterministic `import_id` values (`YNAB:[amount]:[date]:[occurrence]`) to protect against duplicate uploads.
- **Tab-to-Account Binding**: Links each sheet tab to any YNAB Budget and Account via Google Sheets Developer Metadata.

---

## Sheet Column Format

The target sheet requires the following headers in row 1 (order independent):

| Header | Type | Format Example | Description |
| :--- | :--- | :--- | :--- |
| `Date` | String / Date | `2026-10-02` | **Strict ISO 8601 (`YYYY-MM-DD`)** |
| `Payee` | String | `Trader Joe's` | Payee name |
| `Memo` | String (Optional) | `Groceries` | Notes or bank description |
| `Outflow` | Number | `42.13` or `0` | Outflow expense amount (**numeric only**) |
| `Inflow` | Number | `1250.00` or `0` | Inflow deposit amount (**numeric only**) |
| `YNAB Status` | Managed | `Matched`, `Unmatched`, `Uploaded`, `Duplicate` | Auto-created, semantic color badges, soft edit protection |
| `YNAB ID` | Managed | `45f6a9e2-...` | Auto-created, monospace 9pt, soft edit protection |

> [!NOTE]
> If `YNAB Status` and `YNAB ID` are not present in row 1, the add-on appends and formats them automatically on first run.

### Status Badge Legend

- 🟢 **`Matched`**: Matches an existing transaction in YNAB (consumed from matching pool).
- 🟡 **`Unmatched`**: New transaction detected; ready to be uploaded to YNAB.
- 🔵 **`Uploaded`**: Successfully posted to YNAB with its newly assigned YNAB ID.
- 🔴 **`Duplicate`**: YNAB recognized this transaction as a duplicate via its `import_id` and prevented duplicate entry.

---

## Deployment & Setup

### 1. Prerequisites
- [Google clasp](https://github.com/google/clasp) installed (`clasp -v`)
- Google Account with access to Google Sheets & Apps Script
- YNAB Account

### 2. Login to Clasp
```bash
clasp login
```

### 3. Create or Link an Apps Script Project
If creating a new standalone Apps Script project:
```bash
clasp create --type sheets --title "YNAB Sync Add-on" --rootDir ./src
```
Or if linking to an existing script project, edit `.clasp.json`:
```json
{
  "scriptId": "YOUR_APPS_SCRIPT_PROJECT_ID",
  "rootDir": "./src"
}
```

### 4. Push Code to Apps Script (With Safeguards)
```bash
npm run push
```
*(This automatically runs `npm run validate` to verify manifest integrity and OAuth2 library dependencies before executing `clasp push -f`)*.

### 5. Add-on OAuth Configuration
1. Open the project in the Apps Script editor:
   ```bash
   clasp open-script
   ```
2. Note your Apps Script project ID from Project Settings.
3. In [YNAB Developer Settings](https://app.ynab.com/settings/developer), click **New Application**:
   - **Name**: `YNAB Sheets Sync`
   - **Redirect URI**:
     ```
     https://script.google.com/macros/d/{YOUR_SCRIPT_ID}/usercallback
     ```
4. Copy the generated **Client ID** and **Client Secret**.
5. Save the credentials in your script's **Project Settings > Script Properties** (as `YNAB_CLIENT_ID` and `YNAB_CLIENT_SECRET`), or enter them directly in the sidebar on first run.

---

## Usage Workflow

1. Open your Google Sheet containing bank transactions.
2. Go to **Extensions > YNAB Sync > Open Sidebar** (or top-level **YNAB Sync** menu).
3. Click **Connect to YNAB** to authorize (uses secure OAuth 2.0 with automated token refresh).
4. Select your target **Budget** and **Account** and click **Link to Sheet** (links can be changed or unlinked anytime).
5. Click **1. Match Existing Transactions**:
   - Wipes old status cache (safe for dynamic formula-driven data).
   - Matches rows against current YNAB records using a 1-to-1 consumption pool.
   - Shows live counts: *Matched in YNAB* vs *Unmatched*.
6. Click **2. Upload Unmatched to YNAB**:
   - Uploads remaining rows with deterministic `import_id` deduplication keys.
   - Marks rows as `Uploaded` with their new YNAB IDs.

### Menu Shortcuts

You can also run common actions directly from the Google Sheets menu (**Extensions > YNAB Sync**):
- **Open Sidebar**: Launches the interactive control panel.
- **1. Match Existing Transactions**: Runs matching in the background and toasts progress.
- **2. Upload Unmatched to YNAB**: Uploads eligible rows and toasts results.
- **Reset Status Columns**: Manually clears status badges and re-applies column formatting.

---

## Architecture Specification
For full technical specifications, data models, and algorithms, see [DESIGN_SPECIFICATION.md](file:///Users/sascha/Documents/Antigravity/sheets-to-ynab/DESIGN_SPECIFICATION.md).

---

## Author & Support

Created and maintained by **Sascha Stoeter** ([@sstoeter](https://github.com/sstoeter)).
- **Support & Inquiries:** [SUPPORT.md](SUPPORT.md) or email [stoeter@gmail.com](mailto:stoeter@gmail.com)
- **Privacy Policy:** [PRIVACY.md](PRIVACY.md)
- **Terms of Service:** [TERMS.md](TERMS.md)

---

## License & Trademarks

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

*Google Sheets™ is a trademark of Google LLC.*  
*YNAB® is a registered trademark of You Need A Budget LLC.*

