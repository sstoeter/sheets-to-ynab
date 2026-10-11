# Google Sheets to YNAB Synchronizer

A lightweight Google Sheets script that synchronizes bank transactions directly with [YNAB (You Need A Budget)](https://www.ynab.com/) using the official YNAB REST API and **Personal Access Tokens (PAT)**.

---

## Features

- **Personal Access Token (PAT) Authentication**: Zero developer apps, zero redirect URI whitelists, and no Google OAuth session conflicts.
- **Family & Multi-Sheet Friendly**: Anyone in your family can duplicate the spreadsheet, enter their own YNAB token once in the sidebar, and start syncing immediately. Tokens are stored in private Google `UserProperties`.
- **Formula-Driven Friendly**: Safely handles formula-populated sheets (e.g. `=FILTER(...)` or `=ARRAYFORMULA(...)` referencing raw bank CSV exports). Status columns are refreshed idempotently on every sync.
- **Timezone-Safe ISO Dates**: Preserves the exact spreadsheet calendar date using the sheet's configured timezone and displayed cell values, eliminating 1-day timezone shifts.
- **Deterministic Deduplication**: Generates official YNAB `import_id` values (`YNAB:[milliunits]:[date]:[occurrence]`) to protect against duplicate uploads.
- **Milliunit Conversion**: Automatically converts human-readable decimals (e.g. `42.13`) into YNAB integer milliunits (`-42130`).
- **Tab-to-Account Binding**: Links each sheet tab independently to any YNAB Budget and Account via Google Sheets Developer Metadata.
- **Live Account Anchor**: The sidebar displays a real-time receipt card of the most recent YNAB record to provide a visual checkpoint before uploading.

---

## Sheet Column Format

The target sheet requires the following headers in row 1 (order independent for columns 1–5, directly entered or formula-generated):

| Header | Type | Format Example | Description |
| :--- | :--- | :--- | :--- |
| `Date` | String / Date | `2026-10-11` | **ISO 8601 (`YYYY-MM-DD`)** |
| `Payee` | String | `Coop` | Payee name |
| `Memo` | String (Optional) | `Groceries` | Notes or bank description |
| `Outflow` | Number | `43.00` or `0` | Outflow expense amount (**numeric only**) |
| `Inflow` | Number | `1250.00` or `0` | Inflow deposit amount (**numeric only**) |
| `YNAB Import ID` | Managed | `YNAB:-43000:2026-10-11:1` | Auto-inserted between Inflow and YNAB Status (width: 200px) |
| `YNAB Status` | Managed | `Uploaded`, `Duplicate`, `Skipped` | Auto-created, semantic color badges (blank before upload) |
| `YNAB ID` | Managed | `45f6a9e2-...` | Auto-created, monospace 9pt (populated for newly uploaded records) |

> [!NOTE]
> If managed columns (`YNAB Import ID`, `YNAB Status`, `YNAB ID`) are not present in row 1, the script creates, arranges, and formats them automatically on first run.

### Status Badge Legend

- 🟢 **`Uploaded`**: Successfully posted to YNAB with its newly assigned YNAB UUID.
- 🔴 **`Duplicate`**: YNAB recognized an existing transaction with this `YNAB Import ID` and skipped it.
- 🟡 **`Skipped`**: Row has 0.00 amount or missing required fields.
- *(Blank)*: Freshly generated Import ID; ready for upload.

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

1. Paste or populate your bank transactions in the sheet (direct entry or formulas like `=FILTER(...)`).
2. In the sidebar, click **Upload Transactions**:
   - Deterministic `YNAB Import ID`s are freshly regenerated for all rows.
   - All transactions are uploaded to YNAB.
   - New records receive status **`Uploaded`** and their new YNAB UUID.
   - Existing records receive status **`Duplicate`**.
   - The "Most Recent YNAB Record" card in the sidebar immediately refreshes to show the latest state.

### Menu Shortcuts

You can also run actions directly from the Google Sheets menu (**YNAB Sync**):
- **Open Sidebar**: Launches the interactive control panel.
- **Upload Transactions**: Regenerates Import IDs and uploads all rows.
- **Generate Import IDs**: Generates or refreshes Import IDs on the sheet without uploading.
- **Reset Status Columns**: Clears `YNAB Import ID`, `YNAB Status`, and `YNAB ID` columns.
- **Log Out from YNAB**: Disconnects your account and removes stored token from private `UserProperties`.

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
   npm run push
   ```

---

## Security Architecture

- **Private Storage**: Tokens are stored exclusively in `UserProperties` (isolated per Google user account).
- **Masked Credentials**: The sidebar only displays masked representations of tokens (`••••••••1234`).
- **XSS & Injection Protection**: User and API inputs are escaped with strict entity encoding, and dropdown options are instantiated via safe DOM manipulation.
- **Minimal Scopes**: The script requests only the minimal necessary Google OAuth scopes: `spreadsheets.currentonly`, `script.external_request`, and `script.container.ui`.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

*Google Sheets™ is a trademark of Google LLC.*  
*YNAB® is a registered trademark of You Need A Budget LLC.*
