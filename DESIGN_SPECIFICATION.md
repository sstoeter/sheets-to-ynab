# Technical Design Specification: YNAB & Google Sheets Synchronizer

## 1. Executive Summary

This document specifies the technical design, data structures, and algorithms for synchronizing bank transactions from a Google Sheet to **YNAB (You Need A Budget)** using the YNAB REST API.

The solution enables users to:
1. Maintain imported bank transactions in a Google Sheet populated automatically via formulas from raw CSV bank exports.
2. Link any sheet/tab to a specific YNAB Budget and Account via an interactive sidebar.
3. Authenticate with YNAB seamlessly via **OAuth 2.0** using a centralized **Google Workspace Editor Add-on** architecture (zero developer portal configuration for end-users).
4. Safely handle dynamic formula recalculations by idempotently clearing and re-matching status columns during every sync.
5. Run a **Match & Mark** pass to detect and label transactions already present in YNAB, properly handling ambiguous multiple matches with a 1-to-1 consumption pool.
6. Upload remaining new transactions to YNAB with deterministic deduplication (`import_id`) and milliunit amount conversions.
7. Distribute the solution to other users via the **Google Workspace Marketplace** (Public or Unlisted Editor Add-on).

---

## 2. Architecture & Distribution Model

### 2.1 Distribution Strategy: Google Workspace Editor Add-on

The project is architected as a **Google Workspace Editor Add-on for Google Sheets**:

```
+---------------------------------------------------------------------------------------+
|                 Google Workspace Editor Add-on Architecture (Model B)                 |
|                                                                                       |
|  * Single, fixed Script ID for all users.                                             |
|  * A single YNAB OAuth Application registered by the developer:                       |
|      Redirect URI: https://script.google.com/macros/d/{ADDON_SCRIPT_ID}/usercallback  |
|  * Client ID & Secret configured in the Add-on's Script Properties.                   |
|  * End-User Experience: ZERO setup friction.                                          |
|      1. User installs Add-on from Google Workspace Marketplace (or domain/test link). |
|      2. Opens any Google Sheet -> Extensions > YNAB Sync.                             |
|      3. Clicks "Connect to YNAB" -> Logs in & grants permission.                      |
|      4. Ready to sync immediately.                                                    |
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
|                             Editor Add-on Engine                      v               |
|   +-------------------------------------------------------------------------------+   |
|   |  * Formula Lifecycle Manager: Clears & resets status columns on fresh sync    |   |
|   |  * Account Binder: DeveloperMetadata per Sheet (Budget ID & Account ID)       |   |
|   |  * OAuth 2.0 Client: Auth Code Grant + Automated Refresh Token handling       |   |
|   |  * Transaction Matcher: Consumption pool for ambiguous duplicates             |   |
|   |  * Batch Uploader: Milliunit conversion & deterministic import_id             |   |
|   +-------------------------------------------------------------------------------+   |
|                  |                                                    ^               |
|          (HTML Service)                                       (YNAB REST API)         |
+------------------+----------------------------------------------------+---------------+
                   |                                                    |
            Sidebar Dialog                                         api.ynab.com
        (Account Picker, OAuth,                               (Budgets, Accounts,
          Sync & Match Status)                                    Transactions)
```

---

## 3. Authentication & OAuth 2.0 Flow

YNAB utilizes standard OAuth 2.0 with the **Authorization Code Grant**.

### 3.1 Seamless Centralized OAuth Flow
1. **Developer Registration**:
   - The developer registers a single OAuth Application in YNAB Developer Settings.
   - Redirect URI: `https://script.google.com/macros/d/{ADDON_SCRIPT_ID}/usercallback`.
   - The developer sets `CLIENT_ID` and `CLIENT_SECRET` in the Add-on's `ScriptProperties`.
2. **User Authorization**:
   - The user opens the Add-on sidebar and clicks **"Connect to YNAB"**.
   - An authorization popup directs the user to `https://app.ynab.com/oauth/authorize`.
   - The user logs in and clicks **Authorize**.
   - YNAB redirects to the fixed usercallback endpoint.
3. **Token Isolation & Refreshing**:
   - The OAuth tokens (`access_token` and `refresh_token`) are stored in `PropertiesService.getUserProperties()`, ensuring complete isolation: each user's financial tokens are private and accessible only to their own Google account.
   - **Access Tokens** expire after 2 hours (7200 seconds).
   - The `OAuth2 for Apps Script` library automatically refreshes expired tokens using the stored `refresh_token` without interrupting the user.

### 3.2 Add-on OAuth Scopes
The Add-on declares minimal, least-privilege scopes:
- `https://www.googleapis.com/auth/spreadsheets.currentonly`: Read and write transaction data and formatting on the active spreadsheet.
- `https://www.googleapis.com/auth/script.external_request`: Connect to `api.ynab.com` for account queries and transaction uploads.
- `https://www.googleapis.com/auth/script.container.ui`: Render sidebar panels, alerts, and modal prompts.

---

## 4. Sheet Schema & Formula-Driven Lifecycle

### 4.1 Input & Managed Columns
The active sheet requires the following table headers (order-independent, auto-detected by header name):

| Header Name | Type | Format / Constraints | Origin | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Date** | String / Date | **ISO 8601 strictly (`YYYY-MM-DD`)** | Formula / Raw | Transaction date |
| **Payee** | String | Text (e.g. `Starbucks`) | Formula / Raw | Payee name |
| **Memo** | String | Text (Optional) | Formula / Raw | Bank memo or notes |
| **Outflow** | Number | **Numeric only** (e.g. `42.13` or `0`) | Formula / Raw | Debit amount |
| **Inflow** | Number | **Numeric only** (e.g. `1250.00` or `0`) | Formula / Raw | Credit amount |
| **YNAB Status** | String | Managed (`Matched`, `Unmatched`, `Uploaded`, `Duplicate`) | Add-on | Synchronization status |
| **YNAB ID** | String | Managed (UUID) | Add-on | YNAB Transaction UUID |

### 4.2 Handling Formula-Driven Data & CSV Re-imports
Because the Transactions sheet is populated via formulas (e.g., `=FILTER(...)` or `=ARRAYFORMULA(...)`) referencing a raw CSV tab, pasting a new CSV changes the row count, order, and contents dynamically.

If `YNAB Status` and `YNAB ID` remained static, formula recalculations would cause severe **row misalignment**.

#### The Lifecycle Solution: Idempotent Clear & Fresh Match
1. **Status as Disposable Cache**: The status columns (`YNAB Status` and `YNAB ID`) are treated as an ephemeral computed cache, never as permanent manual inputs.
2. **Pre-Sync Clear**: Every time a user initiates **"Match Existing"** or **"Sync Sheet"**:
   - The script determines the current data range of the formula output.
   - It **clears all existing values** in `YNAB Status` and `YNAB ID` below the header row.
3. **Idempotent Re-evaluation**:
   - The script queries YNAB for all transactions in the target account within the active date range.
   - It matches all current rows in the sheet against YNAB.
   - Newly written `Matched` labels reflect the exact current formula output.
4. **Safety Confirmation Before Upload**:
   - The user sees a clear breakdown: *"Total Rows: 45 | Matched: 38 | Ready to Upload: 7"*.
   - Only rows that remain unmarked after the fresh match are uploaded.

---

## 5. Sheet-to-Account Binding

Each sheet tab is bound to a specific YNAB Budget and Account using Google Sheets **Developer Metadata**:
- `YNAB_BUDGET_ID`: Selected YNAB budget UUID.
- `YNAB_BUDGET_NAME`: Display name of budget.
- `YNAB_ACCOUNT_ID`: Selected YNAB account UUID.
- `YNAB_ACCOUNT_NAME`: Display name of account.

### Configuration Workflow
1. User activates the desired sheet tab.
2. Opens **Extensions > YNAB Sync > Open Sidebar**.
3. If the active tab has not yet been linked, the sidebar displays an **"Account Setup"** view.
4. The sidebar fetches the user's budgets via `GET /v1/budgets` and populates a dropdown.
5. Selecting a budget dynamically loads its accounts via `GET /v1/budgets/{budget_id}/accounts`.
6. Clicking **"Link Current Sheet"** saves the metadata directly to the active `Sheet` object.

---

## 6. Currency & Milliunit Conversion

YNAB calculates all monetary amounts as integers in **milliunits** ($1.00 = 1000 milliunits).

### Conversion Rules
- Values in `Outflow` and `Inflow` are strictly numeric (e.g. `42.13`, not `$42.13`).
- Outflows represent negative amounts (debts/payments).
- Inflows represent positive amounts (deposits/credits).
- Calculation:
  $$\text{milliunits} = \text{Math.round}\left( (\text{Inflow} - \text{Outflow}) \times 1000 \right)$$
- Examples:
  - Outflow `42.13`, Inflow `0` $\rightarrow$ `-42130` milliunits
  - Outflow `0`, Inflow `1250.00` $\rightarrow$ `1250000` milliunits

---

## 7. Synchronization & Matching Engine

### 7.1 Ambiguous Multiple Matches: 1-to-1 Consumption Pool

#### The Problem
In financial data, identical transactions frequently occur on the same day (e.g., two separate `$4.50` charges at `Starbucks` on `2026-10-02`).
- If YNAB already has **one** `$4.50` Starbucks transaction on that date, and the sheet has **two**:
  - The script must **NOT** link both sheet rows to the single YNAB transaction (which would cause the second legitimate transaction to never be uploaded).
  - Nor must it skip matching entirely.
  - Exactly **one** sheet row must be matched with the existing YNAB transaction, leaving the second sheet row as **unmatched** so it can be uploaded to YNAB.

#### The Solution: 1-to-1 Consumption Pool
1. **Build a Query Pool**:
   - Retrieve all YNAB transactions for the account spanning the sheet's date window (`since_date = min_date`).
   - Group YNAB transactions into an in-memory lookup table indexed by composite key:
     $$\text{Key} = \text{Date} + \text{"\_"} + \text{Milliunits}$$
   - Each key maps to an array (pool) of available YNAB transactions:
     `lookup["2026-10-02_-4500"] = [ ynabTx1, ynabTx2 ]`
2. **Sequential Matching & Consumption**:
   - As each sheet row is evaluated, compute its key (`Date + "_" + Milliunits`).
   - Find candidate YNAB transactions in the pool matching that key.
   - Filter candidates by Payee similarity (exact match or normalized fuzzy score $\ge 0.85$).
   - If a candidate matches:
     - Assign its YNAB ID to the sheet row and mark as `Matched`.
     - **Remove (consume) that candidate from the pool** so it cannot be matched by any subsequent sheet row.
3. **Outcome**:
   - If YNAB has 1 transaction and the sheet has 2: Row 1 matches YNAB transaction 1 and consumes it; Row 2 finds the pool empty for that key and remains **unmatched**, ready for upload.
   - If YNAB has 2 and the sheet has 2: Both rows match 1-to-1 cleanly.

```mermaid
flowchart TD
    Row[Sheet Row: 2026-10-02 | $4.50 | Starbucks] --> Key[Generate Key: 2026-10-02_-4500]
    Key --> PoolLookup{Check Pool for Key}
    PoolLookup -- Candidate Found --> PayeeCheck{Payee Match Score >= 0.85?}
    PayeeCheck -- Yes --> Assign[Assign YNAB ID to Sheet Row<br/>Set Status = 'Matched']
    Assign --> Consume[REMOVE Candidate from Pool]
    Consume --> NextRow([Proceed to Next Row])
    PayeeCheck -- No --> OtherCand{More Candidates in Pool?}
    OtherCand -- Yes --> PayeeCheck
    OtherCand -- No --> Unmatched[Mark Row Unmatched / Ready for Upload]
    PoolLookup -- Empty --> Unmatched
    Unmatched --> NextRow
```

---

### 7.2 Phase 2: Upload New Transactions & Deduplication

1. **Candidate Identification**:
   - Filter sheet rows where `YNAB Status` is blank (unmatched).
2. **Deterministic `import_id` Generation**:
   - YNAB enforces import deduplication using the `import_id` format:
     $$\text{YNAB:[amount]:[date]:[occurrence]}$$
   - Maximum length: 36 characters.
   - The script tracks occurrences of identical `[amount]:[date]` pairs within the batch:
     - First occurrence: `YNAB:-42130:2026-10-02:1`
     - Second occurrence: `YNAB:-42130:2026-10-02:2`
3. **Batch POST Request**:
   - Dispatch up to 250 transactions per request to:
     `POST /v1/budgets/{budget_id}/transactions`
   - Payload:
     ```json
     {
       "transactions": [
         {
           "account_id": "account-uuid",
           "date": "2026-10-02",
           "amount": -42130,
           "payee_name": "Starbucks",
           "memo": "Morning coffee",
           "cleared": "cleared",
           "approved": false,
           "import_id": "YNAB:-42130:2026-10-02:1"
         }
       ]
     }
     ```
4. **Post-Upload Marking**:
   - Receive created transaction IDs from the YNAB response.
   - Batch write `Uploaded` and the newly assigned `id` back into the sheet.

---

## 8. User Interface & Menu Structure

### 8.1 Menu (`Extensions > YNAB Sync`)
- **Open Sidebar**: Main synchronization control center.
- **1. Match Existing Transactions**: Clears status and runs fresh matching against YNAB.
- **2. Upload Unmatched to YNAB**: Uploads unmarked rows to YNAB.
- **Reset Status Columns**: Manually wipes status columns and restores formatting.

### 8.2 Interactive Sidebar (HTML Service)
- **Connection Badge**: Shows active connection status and authenticated user.
- **Account Context**: Shows currently linked Budget and Account name for the active tab.
- **Actions & Counters**:
  - `Match Existing`: Queries YNAB, matches transactions, and renders live breakdown:
    - 🔵 Total Rows Detected
    - 🟢 Matched in YNAB
    - 🟠 Ready for Upload
  - `Upload to YNAB`: Enabled once matching is complete; uploads unmatched transactions and updates the sheet.

---

## 9. Implementation Roadmap

1. **Step 1: Manifest & OAuth 2.0 Integration**
   - Configure `appsscript.json` for Google Workspace Editor Add-on with Sheets extension.
   - Integrate `OAuth2 for Apps Script`.
   - Implement `OAuthManager.js` (Developer Client ID/Secret via ScriptProperties, token persistence in `UserProperties`, auto-refresh).

2. **Step 2: Sheet Metadata & Formula Lifecycle Controller**
   - Implement `MetadataManager.js` (read/write tab-level Developer Metadata).
   - Implement `SheetLifecycle.js` (header detection, column clearing, batch status writeback).

3. **Step 3: YNAB REST Client**
   - Implement `YnabClient.js` (`getBudgets`, `getAccounts`, `getTransactionsSince`, `postTransactions`).

4. **Step 4: Consumption-Based Matching Engine**
   - Implement `Matcher.js` with consumption pool for ambiguous duplicate transactions and ISO 8601 date parsing.

5. **Step 5: Batch Upload Pipeline**
   - Implement `Uploader.js` with `import_id` generator, milliunit math, and batch POST dispatch.

6. **Step 6: Sidebar UI & Add-on Menus**
   - Build `Sidebar.html` with clean modern aesthetics and responsive state management.
