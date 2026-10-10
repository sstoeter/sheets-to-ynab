/**
 * Code.js
 * Main entry point and RPC endpoints for the YNAB Google Sheets Editor Add-on.
 */

/**
 * Standard trigger executed when the spreadsheet is opened.
 */
function onOpen(e) {
  SpreadsheetApp.getUi()
    .createMenu('YNAB Sync')
    .addItem('Open Sidebar', 'showSidebar')
    .addSeparator()
    .addItem('1. Match Existing Transactions', 'menuMatchExisting')
    .addItem('2. Upload Unmatched to YNAB', 'menuUploadUnmatched')
    .addItem('Reset Status Columns', 'menuResetStatus')
    .addSeparator()
    .addItem('Log Out from YNAB', 'menuLogOut')
    .addToUi();
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
    'Are you sure you want to log out and disconnect your YNAB account? You will need to re-enter your Personal Access Token before syncing again.',
    ui.ButtonSet.YES_NO
  );
  if (resp === ui.Button.YES) {
    AuthManager.disconnect();
    SpreadsheetApp.getActiveSpreadsheet().toast('Successfully disconnected from YNAB.', 'YNAB Sync');
  }
}

/* ==========================================================================
   RPC API Methods called from Sidebar.html
   ========================================================================== */

/**
 * Calculates quick transaction stats by reading only the single YNAB Status column
 * instead of reading every cell in the spreadsheet.
 */
function getQuickSheetStats(sheet) {
  var stats = { total: 0, matched: 0, unmatched: 0 };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return stats;

  stats.total = lastRow - 1;
  try {
    var headerMap = SheetLifecycle.detectHeaders(sheet);
    var statusCol = headerMap['YNAB Status'];
    if (statusCol) {
      var values = sheet.getRange(2, statusCol, lastRow - 1, 1).getValues();
      for (var i = 0; i < values.length; i++) {
        var val = values[i][0];
        if (val === 'Matched' || val === 'Uploaded' || val === 'Duplicate') {
          stats.matched++;
        } else {
          stats.unmatched++;
        }
      }
    } else {
      stats.unmatched = stats.total;
    }
  } catch (e) {
    stats.unmatched = stats.total;
  }
  return stats;
}

/**
 * Ultra-fast tab change detector & state sync in a single roundtrip.
 * If the active sheet matches clientSheetName, returns { changed: false } in ~15ms.
 * If changed, returns full state for the new sheet in a single call without a second roundtrip.
 */
function apiCheckActiveSheet(clientSheetName) {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet) return { changed: false };
  var activeName = sheet.getName();

  if (clientSheetName && activeName === clientSheetName) {
    return { changed: false };
  }

  return {
    changed: true,
    activeSheetName: activeName,
    linkedAccount: MetadataManager.getLinkedAccount(sheet),
    stats: getQuickSheetStats(sheet)
  };
}

/**
 * Retrieves the current state of authentication, active sheet, and account link.
 */
function apiGetState() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var sheetName = sheet ? sheet.getName() : 'Unknown';
  var isAuth = AuthManager.isAuthorized();
  var maskedToken = AuthManager.getMaskedToken();

  var linked = sheet ? MetadataManager.getLinkedAccount(sheet) : null;
  var stats = sheet ? getQuickSheetStats(sheet) : { total: 0, matched: 0, unmatched: 0 };

  return {
    isAuthorized: isAuth,
    maskedToken: maskedToken,
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

  // Subtract 10 days buffer so transactions cleared or entered slightly earlier are included
  var parts = minDate.split('-');
  var minDateObj = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
  minDateObj.setUTCDate(minDateObj.getUTCDate() - 10);
  var safeSinceDate = Utilities.formatDate(minDateObj, 'UTC', 'yyyy-MM-dd');

  // 4. Fetch YNAB transactions for this account since safeSinceDate
  var ynabTxs = YnabClient.fetchTransactionsSince(linked.budgetId, linked.accountId, safeSinceDate);

  // 5. Run matching with 1-to-1 consumption pool
  var matchResult = Matcher.matchSheetWithYnab(sheetTxs, ynabTxs);

  // 6. Batch update sheet
  SheetLifecycle.updateRowStatuses(sheet, matchResult.updates, headerMap);

  return {
    matchedCount: matchResult.matchedCount,
    unmatchedCount: matchResult.unmatchedCount,
    total: sheetTxs.length,
    ynabFetchedCount: ynabTxs.length,
    details: matchResult.details || []
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
 * Disconnects YNAB authorization.
 */
function apiDisconnect() {
  AuthManager.disconnect();
  return { success: true };
}

/**
 * Alias for apiDisconnect to log out.
 */
function apiLogOut() {
  return apiDisconnect();
}

/**
 * Validates and saves a Personal Access Token into UserProperties.
 * @param {string} token
 */
function apiSaveToken(token) {
  if (!token || !token.trim()) {
    throw new Error('Please enter a valid Personal Access Token.');
  }
  var trimmed = token.trim();
  // Strip optional "Bearer " prefix if included
  if (trimmed.toLowerCase().indexOf('bearer ') === 0) {
    trimmed = trimmed.substring(7).trim();
  }
  // Validate token against YNAB API before saving
  YnabClient.validateToken(trimmed);
  // Persist token in private UserProperties
  AuthManager.setAccessToken(trimmed);
  return { success: true };
}
