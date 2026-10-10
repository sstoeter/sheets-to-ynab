/**
 * Code.js
 * Main entry point and RPC endpoints for the YNAB Google Sheets Editor Add-on.
 */

/**
 * Standard trigger executed when the spreadsheet is opened.
 */
function onOpen(e) {
  var ui = SpreadsheetApp.getUi();

  // Create Add-on menu (Extensions > YNAB Sync)
  if (ui.createAddonMenu) {
    ui.createAddonMenu()
      .addItem('Open Sidebar', 'showSidebar')
      .addSeparator()
      .addItem('1. Match Existing Transactions', 'menuMatchExisting')
      .addItem('2. Upload Unmatched to YNAB', 'menuUploadUnmatched')
      .addItem('Reset Status Columns', 'menuResetStatus')
      .addSeparator()
      .addItem('Log Out from YNAB', 'menuLogOut')
      .addToUi();
  }

  // Also try top-level menu if environment permits
  try {
    ui.createMenu('YNAB Sync')
      .addItem('Open Sidebar', 'showSidebar')
      .addSeparator()
      .addItem('1. Match Existing Transactions', 'menuMatchExisting')
      .addItem('2. Upload Unmatched to YNAB', 'menuUploadUnmatched')
      .addItem('Reset Status Columns', 'menuResetStatus')
      .addSeparator()
      .addItem('Log Out from YNAB', 'menuLogOut')
      .addToUi();
  } catch (err) {
    // Top-level menu is disallowed in certain Add-on auth modes; safely ignore
  }
}

/**
 * Standard trigger executed when the Add-on is installed.
 */
function onInstall(e) {
  onOpen(e);
}

/**
 * Displays the main Add-on sidebar.
 */
function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('YNAB Sync')
    .setWidth(340);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Prompt for developer to set Client ID and Client Secret in Script Properties.
 */
function promptDeveloperCredentials() {
  var ui = SpreadsheetApp.getUi();
  var redirectUri = OAuthManager.getRedirectUri();

  var promptText = 'To configure the Add-on, register an application at:\n' +
                   'https://app.ynab.com/settings/developer\n\n' +
                   'With Redirect URI:\n' + redirectUri + '\n\n' +
                   'Enter your YNAB Client ID:';
  var resId = ui.prompt('Configure YNAB OAuth', promptText, ui.ButtonSet.OK_CANCEL);
  if (resId.getSelectedButton() !== ui.Button.OK) return;
  var clientId = resId.getResponseText().trim();

  var resSecret = ui.prompt('Configure YNAB OAuth', 'Enter your YNAB Client Secret:', ui.ButtonSet.OK_CANCEL);
  if (resSecret.getSelectedButton() !== ui.Button.OK) return;
  var clientSecret = resSecret.getResponseText().trim();

  if (clientId && clientSecret) {
    OAuthManager.setDeveloperCredentials(clientId, clientSecret);
    ui.alert('Success', 'Developer credentials saved successfully.', ui.ButtonSet.OK);
  } else {
    ui.alert('Error', 'Client ID and Secret cannot be blank.', ui.ButtonSet.OK);
  }
}

/**
 * Menu action: Match Existing
 */
function menuMatchExisting() {
  try {
    var result = apiRunMatch();
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Match complete: ' + result.matchedCount + ' matched, ' + result.unmatchedCount + ' ready to upload.',
      'YNAB Match'
    );
  } catch (err) {
    SpreadsheetApp.getUi().alert('Match Error: ' + err.message);
  }
}

/**
 * Menu action: Upload Unmatched
 */
function menuUploadUnmatched() {
  try {
    var result = apiRunUpload();
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Upload complete: ' + result.uploadedCount + ' uploaded to YNAB.',
      'YNAB Upload'
    );
  } catch (err) {
    SpreadsheetApp.getUi().alert('Upload Error: ' + err.message);
  }
}

/**
 * Menu action: Reset Status
 */
function menuResetStatus() {
  try {
    apiResetStatus();
    SpreadsheetApp.getActiveSpreadsheet().toast('Status columns reset.', 'YNAB Reset');
  } catch (err) {
    SpreadsheetApp.getUi().alert('Error: ' + err.message);
  }
}

/**
 * Menu action: Log Out from YNAB
 */
function menuLogOut() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    'Log Out from YNAB',
    'Are you sure you want to log out and disconnect your YNAB account? You will need to reconnect before syncing again.',
    ui.ButtonSet.YES_NO
  );
  if (resp === ui.Button.YES) {
    OAuthManager.disconnect();
    SpreadsheetApp.getActiveSpreadsheet().toast('Successfully logged out from YNAB.', 'YNAB Sync');
  }
}

/* ==========================================================================
   RPC API Methods called from Sidebar.html
   ========================================================================== */

/**
 * Retrieves the current state of authentication, active sheet, and account link.
 */
function apiGetState() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var sheetName = sheet ? sheet.getName() : 'Unknown';
  var libLoaded = OAuthManager.isLibraryLoaded();
  var hasDev = OAuthManager.hasDeveloperCredentials();
  var isAuth = libLoaded && OAuthManager.isAuthorized();
  var redirectUri = OAuthManager.getRedirectUri();
  var authUrl = (libLoaded && !isAuth && hasDev) ? OAuthManager.getAuthorizationUrl() : null;

  var linked = MetadataManager.getLinkedAccount(sheet);
  var stats = { total: 0, matched: 0, unmatched: 0 };

  if (sheet) {
    try {
      var headerMap = SheetLifecycle.detectHeaders(sheet);
      var txs = SheetLifecycle.readTransactions(sheet, headerMap);
      stats.total = txs.length;
      for (var i = 0; i < txs.length; i++) {
        var st = txs[i].status;
        if (st === 'Matched' || st === 'Uploaded' || st === 'Duplicate') {
          stats.matched++;
        } else {
          stats.unmatched++;
        }
      }
    } catch (e) {
      // Header map or validation issue, keep stats at 0
    }
  }

  return {
    isLibraryLoaded: libLoaded,
    hasDeveloperCredentials: hasDev,
    isAuthorized: isAuth,
    redirectUri: redirectUri,
    authUrl: authUrl,
    activeSheetName: sheetName,
    linkedAccount: linked,
    stats: stats
  };
}

/**
 * Fetches all budgets and accounts for the account linking picker.
 */
function apiGetBudgetsAndAccounts() {
  var budgets = YnabClient.fetchBudgets();
  var result = [];

  for (var i = 0; i < budgets.length; i++) {
    var b = budgets[i];
    var accounts = [];
    try {
      accounts = YnabClient.fetchAccounts(b.id);
    } catch (e) {
      // Skip accounts if inaccessible
    }
    result.push({
      id: b.id,
      name: b.name,
      accounts: accounts.map(function(a) {
        return { id: a.id, name: a.name, type: a.type };
      })
    });
  }

  return result;
}

/**
 * Links the active sheet to the selected YNAB Budget and Account.
 */
function apiLinkActiveSheet(budgetId, budgetName, accountId, accountName) {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet) throw new Error('No active sheet.');
  MetadataManager.setLinkedAccount(sheet, budgetId, budgetName, accountId, accountName);
  return { success: true };
}

/**
 * Unlinks the active sheet.
 */
function apiUnlinkActiveSheet() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet) throw new Error('No active sheet.');
  MetadataManager.clearLinkedAccount(sheet);
  return { success: true };
}

/**
 * Runs the Match & Mark pipeline on the active sheet.
 */
function apiRunMatch() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet) throw new Error('No active sheet.');

  var linked = MetadataManager.getLinkedAccount(sheet);
  if (!linked) {
    throw new Error('This sheet tab is not linked to any YNAB account. Please link an account first.');
  }

  var headerMap = SheetLifecycle.detectHeaders(sheet);

  // 1. Clear status columns first (idempotent lifecycle for formula-driven data)
  SheetLifecycle.clearStatusColumns(sheet, headerMap);

  // 2. Read transactions from sheet
  var sheetTxs = SheetLifecycle.readTransactions(sheet, headerMap);
  if (sheetTxs.length === 0) {
    return { matchedCount: 0, unmatchedCount: 0, total: 0 };
  }

  // 3. Determine earliest date in sheet transactions
  var minDate = sheetTxs[0].date;
  for (var i = 1; i < sheetTxs.length; i++) {
    if (sheetTxs[i].date < minDate) {
      minDate = sheetTxs[i].date;
    }
  }

  // 4. Fetch YNAB transactions for this account since minDate
  var ynabTxs = YnabClient.fetchTransactionsSince(linked.budgetId, linked.accountId, minDate);

  // 5. Run matching with 1-to-1 consumption pool
  var matchResult = Matcher.matchSheetWithYnab(sheetTxs, ynabTxs);

  // 6. Batch update sheet
  SheetLifecycle.updateRowStatuses(sheet, matchResult.updates, headerMap);

  return {
    matchedCount: matchResult.matchedCount,
    unmatchedCount: matchResult.unmatchedCount,
    total: sheetTxs.length
  };
}

/**
 * Runs the Upload pipeline on unmatched rows of the active sheet.
 */
function apiRunUpload() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet) throw new Error('No active sheet.');

  var linked = MetadataManager.getLinkedAccount(sheet);
  if (!linked) {
    throw new Error('This sheet tab is not linked to any YNAB account. Please link an account first.');
  }

  var headerMap = SheetLifecycle.detectHeaders(sheet);
  var sheetTxs = SheetLifecycle.readTransactions(sheet, headerMap);

  var uploadResult = Uploader.uploadNewTransactions(linked.budgetId, linked.accountId, sheetTxs);

  if (uploadResult.updates.length > 0) {
    SheetLifecycle.updateRowStatuses(sheet, uploadResult.updates, headerMap);
  }

  return {
    uploadedCount: uploadResult.uploadedCount,
    duplicateCount: uploadResult.duplicateCount
  };
}

/**
 * Resets status columns on the active sheet.
 */
function apiResetStatus() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet) throw new Error('No active sheet.');
  var headerMap = SheetLifecycle.detectHeaders(sheet);
  SheetLifecycle.clearStatusColumns(sheet, headerMap);
  SheetLifecycle.formatManagedColumns(sheet, headerMap);
  return { success: true };
}

/**
 * Disconnects OAuth authorization.
 */
function apiDisconnect() {
  OAuthManager.disconnect();
  return { success: true };
}

/**
 * Alias for apiDisconnect to log out.
 */
function apiLogOut() {
  return apiDisconnect();
}

/**
 * Saves developer credentials from the UI.
 */
function apiSaveDeveloperCredentials(clientId, clientSecret) {
  OAuthManager.setDeveloperCredentials(clientId, clientSecret);
  return { success: true };
}
