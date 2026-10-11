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
    .addItem('Upload Transactions', 'menuUploadTransactions')
    .addItem('Generate Import IDs', 'menuGenerateImportIds')
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
 * Menu action: Generate Import IDs
 */
function menuGenerateImportIds() {
  try {
    var result = apiGenerateImportIds();
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Generated ' + result.generatedCount + ' Import IDs (Total rows: ' + result.total + ').',
      'YNAB Sync'
    );
  } catch (err) {
    SpreadsheetApp.getUi().alert('Import ID Error: ' + err.message);
  }
}

/**
 * Menu action: Upload Transactions
 */
function menuUploadTransactions() {
  try {
    var result = apiUploadTransactions();
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Upload complete: ' + result.uploadedCount + ' uploaded, ' + result.duplicateCount + ' duplicates.',
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
    SpreadsheetApp.getActiveSpreadsheet().toast('Managed columns reset.', 'YNAB Reset');
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
 * Calculates quick transaction stats by reading managed column values.
 */
function getQuickSheetStats(sheet) {
  var stats = { total: 0, pending: 0, uploaded: 0, duplicate: 0, withImportId: 0 };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return stats;

  stats.total = lastRow - 1;
  try {
    var headerMap = SheetLifecycle.detectHeaders(sheet);
    var importIdCol = headerMap['YNAB Import ID'];
    var statusCol = headerMap['YNAB Status'];

    if (statusCol) {
      var numRows = lastRow - 1;
      var statusVals = sheet.getRange(2, statusCol, numRows, 1).getValues();
      var importIdVals = importIdCol ? sheet.getRange(2, importIdCol, numRows, 1).getValues() : null;

      for (var i = 0; i < numRows; i++) {
        var stVal = String(statusVals[i][0] || '').trim();
        var impVal = importIdVals ? String(importIdVals[i][0] || '').trim() : '';

        if (impVal) stats.withImportId++;
        if (stVal === 'Uploaded') {
          stats.uploaded++;
        } else if (stVal === 'Duplicate') {
          stats.duplicate++;
        } else {
          stats.pending++;
        }
      }
    } else {
      stats.pending = stats.total;
    }
  } catch (e) {
    stats.pending = stats.total;
  }
  return stats;
}

/**
 * Tab change detector & state sync in a single roundtrip.
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
  var stats = sheet ? getQuickSheetStats(sheet) : { total: 0, withImportId: 0, uploaded: 0, duplicate: 0, ready: 0 };

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
 * Generates deterministic YNAB Import IDs on the active sheet.
 */
function apiGenerateImportIds() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet) throw new Error('No active sheet.');

  var linked = MetadataManager.getLinkedAccount(sheet);
  if (!linked) {
    throw new Error('This sheet tab is not linked to any YNAB account. Please link an account first.');
  }

  var headerMap = SheetLifecycle.detectHeaders(sheet);

  // Read transactions from sheet
  var sheetTxs = SheetLifecycle.readTransactions(sheet, headerMap);
  if (sheetTxs.length === 0) {
    return { generatedCount: 0, total: 0 };
  }

  // Generate deterministic Import IDs
  var result = Uploader.generateSheetImportIds(sheetTxs);

  // Batch update sheet rows
  SheetLifecycle.updateRowStatuses(sheet, result.updates, headerMap);

  return {
    generatedCount: result.generatedCount,
    total: sheetTxs.length
  };
}

/**
 * Uploads all transaction rows on the active sheet to YNAB.
 * Ensures deterministic YNAB Import IDs are generated and written to the sheet first.
 */
function apiUploadTransactions() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet) throw new Error('No active sheet.');

  var linked = MetadataManager.getLinkedAccount(sheet);
  if (!linked) {
    throw new Error('This sheet tab is not linked to any YNAB account. Please link an account first.');
  }

  var headerMap = SheetLifecycle.detectHeaders(sheet);
  var sheetTxs = SheetLifecycle.readTransactions(sheet, headerMap);

  if (sheetTxs.length === 0) {
    return { uploadedCount: 0, duplicateCount: 0, total: 0 };
  }

  // 1. Ensure deterministic Import IDs are generated and written to the sheet first
  var idResult = Uploader.generateSheetImportIds(sheetTxs);
  if (idResult.updates.length > 0) {
    SheetLifecycle.updateRowStatuses(sheet, idResult.updates, headerMap);
    // Re-read transactions to ensure in-memory array has fresh Import IDs
    sheetTxs = SheetLifecycle.readTransactions(sheet, headerMap);
  }

  // 2. Dispatch upload to YNAB
  var uploadResult = Uploader.uploadAllTransactions(linked.budgetId, linked.accountId, sheetTxs);

  // 3. Batch update row statuses (Uploaded with YNAB ID, or Duplicate)
  if (uploadResult.updates.length > 0) {
    SheetLifecycle.updateRowStatuses(sheet, uploadResult.updates, headerMap);
  }

  return {
    uploadedCount: uploadResult.uploadedCount,
    duplicateCount: uploadResult.duplicateCount,
    total: sheetTxs.length
  };
}

/**
 * Retrieves the most recent YNAB transaction for the linked account on the active sheet.
 */
function apiGetLatestTransaction() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet) return null;

  var linked = MetadataManager.getLinkedAccount(sheet);
  if (!linked || !linked.budgetId || !linked.accountId) return null;

  return YnabClient.getLatestAccountTransaction(linked.budgetId, linked.accountId);
}

/**
 * Resets managed columns (YNAB Import ID, YNAB Status, YNAB ID) on the active sheet.
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
