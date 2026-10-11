# Technical Design Specification: YNAB & Google Sheets Synchronizer

## 1. Executive Summary

This document specifies the technical design, data structures, and algorithms for synchronizing bank transactions from a Google Sheet to **YNAB (You Need A Budget)** using the YNAB REST API v1.

The solution enables users to:
1. Maintain imported bank transactions in a Google Sheet populated directly or via formulas referencing raw bank exports.
2. Link any individual sheet tab to a specific YNAB Budget and Account via an interactive sidebar.
3. Authenticate with YNAB securely using **Personal Access Tokens (PAT)** persisted in private Google `UserProperties` (zero developer app registration, zero redirect URIs, zero session conflicts).
4. Safely handle dynamic formula recalculations and CSV updates through idempotent regeneration of managed columns (`YNAB Import ID`, `YNAB Status`, `YNAB ID`).
5. Ensure timezone consistency between Google Sheets local timezone and Apps Script runtime to guarantee exact calendar day agreement.
6. Generate official deterministic `import_id` values (`YNAB:[milliunits]:[YYYY-MM-DD]:[occurrence]`) to protect against duplicate uploads.
7. Automatically resolve and write the existing YNAB transaction UUID into `YNAB ID` for rows recognized as duplicates by YNAB.
8. Maintain a live visual anchor in the sidebar displaying the most recent YNAB transaction.

---

## 2. Architecture & Distribution Model

### 2.1 Distribution Strategy: Container-Bound Script with Personal Access Tokens

The project is architected as a container-bound **Google Sheets Apps Script**:

```
+---------------------------------------------------------------------------------------+
|                 Container-Bound Script with Personal Access Tokens                    |
|                                                                                       |
|  * Bound directly to Google Sheets with native custom menu: "YNAB Sync".              |
|  * Authentication via YNAB Personal Access Token (PAT):                               |
|      - Generated in YNAB Settings > Developer Settings.                               |
|      - Saved into private UserProperties (never shared across users or sheets).       |
|  * Family / Multi-Sheet Experience:                                                   |
|      1. User makes a copy of the Google Sheet (File > Make a copy).                   |
|      2. Opens menu: YNAB Sync > Open Sidebar.                                         |
|      3. Pastes their personal YNAB token.                                             |
|      4. Ready to link budget & sync immediately.                                      |
+---------------------------------------------------------------------------------------+
```

### 2.2 System Architecture

```
+---------------------------------------------------------------------------------------+
|                                    Google Sheets                                      |
|                                                                                       |
|   +--------------------------+          Formulas          +-----------------------+   |
|   |  Raw CSV Import Tab      | ------------------------>  |  Transactions Tab     |   |
|   |  (Pasted/imported data)  |  (ARRAYFORMULA / FILTER)   |  (ISO Date, Payee,    |   |
|   +--------------------------+                            |   Memo, In/Outflow)   |   |
|                                                           +-----------------------+   |
|                                                                       |               |
|                                                                       |               |
|                             Container-Bound Sync Engine               v               |
|   +-------------------------------------------------------------------------------+   |
|   |  * Sheet Lifecycle Manager: Header detection, timezone formatting, managed    |   |
|   |    column sizing (200px) and soft edit protections                            |   |
|   |  * Metadata Manager: DeveloperMetadata per Sheet (Budget ID & Account ID)     |   |
|   |  * Auth Manager: Bearer Personal Access Token stored in UserProperties        |   |
|   |  * Batch Uploader: Milliunit math, deterministic import_id generation,        |   |
|   |    and batch POST upload with duplicate detection                             |   |
|   +-------------------------------------------------------------------------------+   |
|                  |                                                    ^               |
|          (HTML Service)                                       (YNAB REST API)         |
+------------------+----------------------------------------------------+---------------+
                   |                                                    |
            Sidebar Dialog                                         api.ynab.com
         (Account Destination,                                (Budgets, Accounts,
        Most Recent Record Card,                                  Transactions)
          Sync Action Button)
```

---

## 3. Authentication & Security

### 3.1 Personal Access Token (PAT) Architecture
1. **User Authorization**:
   - The user opens the Add-on sidebar and pastes their PAT from [YNAB Developer Settings](https://app.ynab.com/settings/developer).
   - The token is validated against the `/user` endpoint before saving.
2. **Private Storage**:
   - Stored in `PropertiesService.getUserProperties()`, ensuring complete isolation: each collaborator on a shared Google Sheet uses their own private credentials.
   - Fallback read from `ScriptProperties` if configured for automated single-user environments.
3. **Token Masking**:
   - The sidebar displays only the last 4 characters (`••••••••1234`).
4. **Disconnect / Logout**:
   - Removes stored credentials from `UserProperties` and `ScriptProperties`.

### 3.2 Add-on OAuth Scopes
The Add-on declares minimal, least-privilege scopes in `appsscript.json`:
- `https://www.googleapis.com/auth/spreadsheets.currentonly`: Read and write transaction data and formatting on the active spreadsheet.
- `https://www.googleapis.com/auth/script.external_request`: Connect to `api.ynab.com` for account queries and transaction uploads.
- `https://www.googleapis.com/auth/script.container.ui`: Render sidebar panels, alerts, and modal prompts.

### 3.3 Injection & XSS Mitigations
- All dynamic HTML in `Sidebar.html` is escaped via `escapeHtml()`, encoding `&`, `<`, `>`, `"`, and `'`.
- Budget and Account `<option>` elements are created programmatically using `document.createElement('option')` and `textContent`.

---

## 4. Sheet Schema & Timezone Integrity

### 4.1 Input & Managed Columns
The active sheet requires the following table headers in row 1:

| Header Name | Type | Format / Constraints | Origin | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Date** | String / Date | **ISO 8601 strictly (`YYYY-MM-DD`)** | Direct / Formula | Transaction calendar date |
| **Payee** | String | Text (e.g. `Coop`) | Direct / Formula | Payee name |
| **Memo** | String | Text (Optional) | Direct / Formula | Bank memo or notes |
| **Outflow** | Number | **Numeric only** (e.g. `43.00` or `0`) | Direct / Formula | Debit expense amount |
| **Inflow** | Number | **Numeric only** (e.g. `1250.00` or `0`) | Direct / Formula | Credit deposit amount |
| **YNAB Import ID** | String | **`YNAB:[milliunits]:[YYYY-MM-DD]:[occurrence]`** | Add-on (Managed) | Width: 200px, monospace 9pt |
| **YNAB Status** | String | Managed (`Uploaded`, `Duplicate`, `Skipped`) | Add-on (Managed) | Synchronization status (blank until uploaded) |
| **YNAB ID** | String | Managed (UUID) | Add-on (Managed) | YNAB UUID (filled on upload & duplicate) |

### 4.2 Timezone-Safe Date Resolution
- Google Sheets stores dates as timestamps at midnight in the spreadsheet's local timezone (e.g. `2026-10-11 00:00:00 CEST`).
- Because Google Apps Script runtimes frequently execute in UTC (`Etc/UTC`), calling native JavaScript `date.getDate()` can result in a 1-day backward shift (e.g. `22:00 UTC` on the previous day).
- **Resolution Strategy**:
  1. `readTransactions` reads `getDisplayValues()` alongside `getValues()`. If the cell displays a strict ISO date (`YYYY-MM-DD`), it is used directly without Date object conversion.
  2. For Date objects or locale-formatted dates, `formatIsoDate` explicitly evaluates the calendar day using `Utilities.formatDate(dateVal, spreadsheetTimeZone, 'yyyy-MM-dd')`.

---

## 5. Sheet-to-Account Binding

Each sheet tab is bound to a specific YNAB Budget and Account using Google Sheets **Developer Metadata**:
- `YNAB_BUDGET_ID`: Selected YNAB budget UUID.
- `YNAB_BUDGET_NAME`: Display name of budget.
- `YNAB_ACCOUNT_ID`: Selected YNAB account UUID.
- `YNAB_ACCOUNT_NAME`: Display name of account.

The sidebar displays the active connection in the **Account Destination** card:
- `Sheet: [Sheet Name]`
- `YNAB Budget: [Budget Name]`
- `YNAB Account: [Account Name]`

---

## 6. Currency & Milliunit Conversion

YNAB calculates all monetary amounts as integers in **milliunits** ($1.00 = 1000 milliunits).

### Conversion Rules
- Values in `Outflow` and `Inflow` are numeric.
- Outflows represent negative amounts (debts/payments).
- Inflows represent positive amounts (deposits/credits).
- Calculation:
  $$\text{milliunits} = \text{Math.round}\left( (\text{Inflow} - \text{Outflow}) \times 1000 \right)$$
- Examples:
  - Outflow `43.00`, Inflow `0` $\rightarrow$ `-43000` milliunits
  - Outflow `0`, Inflow `1250.00` $\rightarrow$ `1250000` milliunits

---

## 7. Deterministic Import ID & Upload Pipeline

### 7.1 Import ID Generation
YNAB enforces import deduplication using the official `import_id` format:
$$\text{YNAB:[milliunit\_amount]:[iso\_date]:[occurrence]}$$
* Maximum length: 36 characters.
* Tracks occurrences of identical `[milliunits]:[date]` within the sheet:
  * First occurrence: `YNAB:-43000:2026-10-11:1`
  * Second occurrence: `YNAB:-43000:2026-10-11:2`
* Computed IDs are written to the `YNAB Import ID` column.

### 7.2 Upload & Deduplication Pipeline
1. **Always-Active Action**:
   - The sidebar provides an always-active **Upload Transactions** button.
   - When clicked, Import IDs are regenerated for all rows, and the entire transaction batch is dispatched to YNAB.
2. **Batch POST Request**:
   - Dispatches transactions in chunks of up to 250 items to:
     `POST /v1/budgets/{budget_id}/transactions`
3. **Response Handling**:
   - **Created Rows** (`transaction_ids`): Marked as `Uploaded` with their newly assigned YNAB UUID.
   - **Duplicate Rows** (`duplicate_import_ids`): Marked as `Duplicate` (retaining any existing YNAB ID already on the sheet). No additional API calls are executed.

---

## 8. User Interface & Menu Structure

### 8.1 Google Sheets Menu (`YNAB Sync`)
- **Open Sidebar**: Launches the interactive sidebar.
- **Upload Transactions**: Regenerates Import IDs and uploads all rows.
- **Generate Import IDs**: Generates or refreshes Import IDs on the sheet without uploading.
- **Reset Status Columns**: Clears managed columns (`YNAB Import ID`, `YNAB Status`, `YNAB ID`).
- **Log Out from YNAB**: Disconnects authorization and clears stored PAT.

### 8.2 Interactive Sidebar
- **Header**: Live connection badge (`Connected` / `Disconnected`) and Log Out button.
- **Account Destination Card**:
  - Displays Sheet name, YNAB Budget, and YNAB Account.
  - Refresh button (`↻`), Change button, and Unlink button.
  - **Most Recent YNAB Record**: Receipt card previewing the latest transaction in YNAB (Payee, Date, Memo, Amount pill).
- **Sync Transactions Card**:
  - Always-active prominent **`Upload Transactions`** button.
  - Informative status line indicating total and pending transactions.
- **Dismissible Alert Banners**: Provides feedback for successes, errors, and warnings.
- **Activity Log**: Collapsible technical log console.
