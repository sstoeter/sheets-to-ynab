# User Support for YNAB Sync for Google Sheets™

Thank you for using **YNAB Sync for Google Sheets™**. We are committed to providing helpful and prompt support to all users.

---

## 1. How to Contact Support

For technical assistance, bug reports, feature suggestions, or general inquiries, please contact us directly via email:

- **Primary Support Email:** [stoeter@gmail.com](mailto:stoeter@gmail.com)
- **Developer Name:** Sascha Stoeter
- **Expected Response Time:** Within 24–48 business hours

> [!NOTE]
> You do **not** need a GitHub account or technical background to receive support. Simply send an email describing your question or issue, and we will assist you.

When sending an email, please include:
1. A brief summary of what happened.
2. The exact error message displayed (if any).
3. The step in the workflow where the issue occurred (e.g. connecting to YNAB, matching transactions, or uploading).

*(Please never include sensitive credentials or passwords in your emails).*

---

## 2. Frequently Asked Questions (FAQ) & Troubleshooting

### Q: The sidebar displays "Authorization Required" or access blocked
**Solution:**
1. In Google Sheets™, refresh the spreadsheet tab.
2. Open the sidebar via **Extensions > YNAB Sync > Open Sidebar**.
3. If prompted to grant Google permissions, click **Continue** and grant the required permissions (current spreadsheet access only).
4. Click **Connect to YNAB** to complete the YNAB authorization.

### Q: Why do my transactions show as "Duplicate"?
**Solution:**
- YNAB provides an automated deduplication system using a transaction `import_id`. If a transaction with the same amount, date, and occurrence was previously imported or added in YNAB, YNAB marks it as duplicate to avoid double-charging your budget balances.

### Q: Can the add-on see my other Google Drive files or spreadsheets?
**Solution:**
- **No.** The add-on uses the strict `spreadsheets.currentonly` scope, which confines access strictly to the active spreadsheet file you are working in.

### Q: How do I log out, disconnect, or remove the add-on?
**Solution:**
1. In the sidebar, click **Log Out** in the top header, or select **Extensions > YNAB Sync > Log Out from YNAB** from the Google Sheets menu to delete your stored OAuth tokens.
2. In Google Sheets™, go to **Extensions > Add-ons > Manage add-ons** and click **Uninstall**.
3. You can also revoke access anytime in your Google Account security settings at [https://myaccount.google.com/permissions](https://myaccount.google.com/permissions).

---

## 3. Legal & Trademarks

- Google Sheets™ is a trademark of Google LLC.
- YNAB® and "You Need A Budget" are registered trademarks of You Need A Budget LLC.
- YNAB Sync for Google Sheets™ is an independent software tool and is not affiliated with, endorsed by, or sponsored by Google LLC or You Need A Budget LLC.
