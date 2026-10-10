# Privacy Policy for YNAB Sync for Google Sheets™

**Last Updated:** October 10, 2026

This Privacy Policy explains how **YNAB Sync for Google Sheets™** ("the Add-on", "we", "our") handles your data. We are committed to protecting your privacy and ensuring transparency about how your information is accessed and processed.

---

## 1. Overview and Architecture

**YNAB Sync for Google Sheets™** is a client-side Google Workspace Editor Add-on built using Google Apps Script. 

- **No Intermediate Servers:** The Add-on does not operate any external web servers, databases, or cloud backends.
- **Direct Communication:** All data processing occurs entirely within your Google account's Google Apps Script runtime and communicates directly between your Google Sheets document and the official YNAB REST API (`https://api.ynab.com`).
- **No Third-Party Analytics or Tracking:** We do not track user behavior, inject third-party analytics scripts, or collect telemetry of any kind.

---

## 2. Information Accessed and Processed

To perform its synchronization functionality, the Add-on requests access to the following information:

### A. Google Sheets Data
- **Scope Used:** `https://www.googleapis.com/auth/spreadsheets.currentonly`
- **What is accessed:** The Add-on only accesses the active Google Sheet spreadsheet you explicitly open the Add-on in. It reads transaction rows (Date, Payee, Memo, Outflow, Inflow) and writes status indicators (`YNAB Status`, `YNAB ID`).
- **What is NOT accessed:** The Add-on cannot access, view, or modify any other files in your Google Drive or other spreadsheets.

### B. YNAB Account Data
- **Access:** When you authorize the Add-on with your YNAB account via OAuth 2.0, the Add-on requests access to your YNAB budgets, accounts, and transactions.
- **Purpose:** 
  1. Fetching available budgets and accounts to allow you to link a sheet tab.
  2. Fetching recent transactions for matching against sheet data to prevent duplicate imports.
  3. Uploading approved unmatched transactions to your chosen YNAB budget account.

### C. Authentication Credentials & Metadata
- **OAuth Access Tokens:** After authorization, OAuth tokens are stored exclusively in your Google account's secure `UserProperties` store provided by Google Apps Script. These tokens are tied to your personal Google account and are never accessible to the developer or any third party.
- **Developer Metadata:** Sheet tab-to-account bindings (Budget ID, Account ID) are stored locally within the spreadsheet document's Google Developer Metadata.

---

## 3. How We Use Your Information

The information accessed is used solely for:
- Authenticating your connection to YNAB.
- Reading and writing bank transaction rows in your active spreadsheet.
- Comparing spreadsheet rows with your YNAB account to identify matched and unmatched transactions.
- Posting new transactions to your linked YNAB account upon your request.

We do not use your personal, financial, or spreadsheet data for any other purpose, including advertising, profiling, or machine learning training.

---

## 4. Data Sharing and Disclosure

- **No Sale of Data:** We do not sell, rent, or trade your personal or financial data under any circumstances.
- **No Third-Party Sharing:** Your data is never shared with third parties. Data moves strictly between your Google Sheet and YNAB’s secure API.
- **Legal Requirements:** Because we do not store or collect your data on any server, we have no user data to disclose to third parties or law enforcement.

---

## 5. Google API Services User Data Policy Compliance

YNAB Sync for Google Sheets' use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the **Limited Use** requirements.

---

## 6. Data Retention and Deletion

- **Zero Server Retention:** Because we do not operate external servers, no user data or transaction records are retained by us.
- **Revoking Access:**
  - **In Google Sheets:** You can click **Log Out** in the Add-on sidebar or select **Extensions > YNAB Sync > Log Out from YNAB** at any time, which immediately deletes the stored OAuth tokens from your `UserProperties`.
  - **In YNAB:** You can revoke the Add-on's authorization at any time in your [YNAB Account Settings](https://app.ynab.com/settings/developer).
  - **In Google Account:** You can manage or revoke third-party app permissions anytime at [Google Account Permissions](https://myaccount.google.com/permissions).
- **Uninstalling:** Uninstalling the Add-on removes the script execution from your Google account.

---

## 7. Security

- All communication between Google Apps Script and YNAB is encrypted in transit using industry-standard TLS / HTTPS.
- Authentication tokens are handled following OAuth 2.0 specifications and stored in Google's protected per-user storage (`UserProperties`).

---

## 8. Changes to This Policy

If we update this Privacy Policy, the revised policy will be posted in this repository with an updated "Last Updated" date.

---

## 9. Contact Us

If you have any questions, concerns, or requests regarding this Privacy Policy, please contact:

- **Developer:** Sascha Stoeter
- **Email:** stoeter@gmail.com
- **Repository:** [https://github.com/sstoeter/sheets-to-ynab](https://github.com/sstoeter/sheets-to-ynab)

---

*Google Sheets™ is a trademark of Google LLC.*
*YNAB® is a registered trademark of You Need A Budget LLC.*

