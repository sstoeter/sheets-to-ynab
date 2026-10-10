# Google Sheets to YNAB Synchronizer

A lightweight Google Sheets script that synchronizes bank transactions directly with [YNAB (You Need A Budget)](https://www.ynab.com/) using the official YNAB REST API and **Personal Access Tokens (PAT)**.

---

## Features

- **Personal Access Token (PAT) Authentication**: Zero developer apps, zero redirect URI whitelists, and no Google OAuth session conflicts.
- **Family & Multi-Sheet Friendly**: Anyone in your family can duplicate the spreadsheet, enter their own YNAB token once in the sidebar, and start syncing immediately. Tokens are stored in private Google `UserProperties`.
- **Formula-Driven Friendly**: Safely handles formula-populated sheets (e.g. `=FILTER(...)` or `=ARRAYFORMULA(...)` referencing raw bank CSV exports). Status columns are refreshed idempotently on every sync.
- **Ambiguous Duplicate Protection**: Uses a 1-to-1 consumption pool so identical transactions on the same day match accurately without double-linking.
- **Milliunit Conversion**: Automatically converts human-readable decimals (e.g. `42.13`) into YNAB integer milliunits (`-42130`).
- **Deduplication Key**: Generates deterministic `import_id` values (`YNAB:[amount]:[date]:[occurrence]`) to protect against duplicate uploads.
- **Tab-to-Account Binding**: Links each sheet tab independently to any YNAB Budget and Account via Google Sheets Developer Metadata.

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
| `YNAB Status` | Managed | `Matched`, `Unmatched`, `Uploaded`, `Duplicate` | Auto-created, semantic color badges |
| `YNAB ID` | Managed | `45f6a9e2-...` | Auto-created, monospace 9pt |

> [!NOTE]
> If `YNAB Status` and `YNAB ID` are not present in row 1, the script appends and formats them automatically on first run.

### Status Badge Legend

- 🟢 **`Matched`**: Matches an existing transaction in YNAB (consumed from matching pool).
- 🟡 **`Unmatched`**: New transaction detected; ready to be uploaded to YNAB.
- 🔵 **`Uploaded`**: Successfully posted to YNAB with its newly assigned YNAB ID.
- 🔴 **`Duplicate`**: YNAB recognized this transaction as a duplicate via its `import_id` and prevented duplicate entry.

---

## Quick Setup Guide

### 1. Generate a Personal Access Token in YNAB
1. Log into YNAB and go to [Account Settings > Developer Settings](https://app.ynab.com/settings/developer).
2. Under **Personal Access Tokens**, click **New Token**.
3. Copy your token (you will only see it once).

### 2. Connect Your Google Sheet
1. Open your Google Sheet.
2. In the top menu, click **YNAB Sync > Open Sidebar**.
3. In the sidebar, paste your **Personal Access Token** and click **Connect to YNAB**.
4. Select your **Budget** and **Account**, then click **Link to Sheet**.

---

## Daily Usage Workflow

1. Paste or populate your bank transactions in the sheet.
2. Click **1. Match Existing Transactions**:
   - Wipes old status cache (safe for dynamic formulas).
   - Matches rows against current YNAB records using a 1-to-1 consumption pool.
   - Shows live counts: *Matched in YNAB* vs *Unmatched*.
3. Click **2. Upload Unmatched to YNAB**:
   - Uploads new rows with deterministic `import_id` deduplication keys.
   - Marks rows as `Uploaded` with their newly assigned YNAB IDs.

### Menu Shortcuts

You can also run common actions directly from the Google Sheets menu (**YNAB Sync**):
- **Open Sidebar**: Launches the interactive control panel.
- **1. Match Existing Transactions**: Runs matching in the background and toasts progress.
- **2. Upload Unmatched to YNAB**: Uploads eligible rows and toasts results.
- **Reset Status Columns**: Manually clears status badges and re-applies column formatting.
- **Log Out from YNAB**: Disconnects your account and removes stored token.

---

## Sharing with Family Members

1. Family members simply make a copy of the Google Sheet: **File > Make a copy**.
2. They open the copy, click **YNAB Sync > Open Sidebar**, and accept the one-time Google permission prompt.
3. They paste their own YNAB Personal Access Token into the sidebar.
4. **Done!** No developer setups, no redirect URIs, and no shared tokens.

---

## Developer Deployment (`clasp`)

To deploy updates to a sheet's bound script from this repository:

1. In `.clasp.json`, specify your bound script ID:
   ```json
   {
     "scriptId": "YOUR_APPS_SCRIPT_ID",
     "rootDir": "src"
   }
   ```
2. Push all files:
   ```bash
   npx @google/clasp push -f
   ```

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

*Google Sheets™ is a trademark of Google LLC.*  
*YNAB® is a registered trademark of You Need A Budget LLC.*
