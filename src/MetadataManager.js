/**
 * MetadataManager.js
 * Manages Developer Metadata on individual Google Sheet tabs to bind them to specific YNAB Budgets & Accounts.
 */

var MetadataManager = (function() {
  var KEY_BUDGET_ID = 'YNAB_BUDGET_ID';
  var KEY_BUDGET_NAME = 'YNAB_BUDGET_NAME';
  var KEY_ACCOUNT_ID = 'YNAB_ACCOUNT_ID';
  var KEY_ACCOUNT_NAME = 'YNAB_ACCOUNT_NAME';

  /**
   * Reads the linked YNAB Budget and Account information from the specified Sheet's metadata.
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @return {Object|null} Object containing budgetId, budgetName, accountId, accountName or null if not linked.
   */
  function getLinkedAccount(sheet) {
    if (!sheet) return null;
    var metadataList = sheet.getDeveloperMetadata();
    var data = {};

    for (var i = 0; i < metadataList.length; i++) {
      var meta = metadataList[i];
      var key = meta.getKey();
      var val = meta.getValue();
      if (key === KEY_BUDGET_ID) data.budgetId = val;
      if (key === KEY_BUDGET_NAME) data.budgetName = val;
      if (key === KEY_ACCOUNT_ID) data.accountId = val;
      if (key === KEY_ACCOUNT_NAME) data.accountName = val;
    }

    if (data.budgetId && data.accountId) {
      return data;
    }
    return null;
  }

  /**
   * Sets or updates the linked YNAB Budget and Account on the specified Sheet.
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @param {string} budgetId
   * @param {string} budgetName
   * @param {string} accountId
   * @param {string} accountName
   */
  function setLinkedAccount(sheet, budgetId, budgetName, accountId, accountName) {
    if (!sheet) throw new Error('No sheet provided.');
    clearLinkedAccount(sheet);

    var visibility = SpreadsheetApp.DeveloperMetadataVisibility.DOCUMENT;
    sheet.addDeveloperMetadata(KEY_BUDGET_ID, budgetId, visibility);
    sheet.addDeveloperMetadata(KEY_BUDGET_NAME, budgetName || 'Budget', visibility);
    sheet.addDeveloperMetadata(KEY_ACCOUNT_ID, accountId, visibility);
    sheet.addDeveloperMetadata(KEY_ACCOUNT_NAME, accountName || 'Account', visibility);
  }

  /**
   * Removes all YNAB metadata from the specified Sheet.
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
   */
  function clearLinkedAccount(sheet) {
    if (!sheet) return;
    var metadataList = sheet.getDeveloperMetadata();
    for (var i = 0; i < metadataList.length; i++) {
      var meta = metadataList[i];
      var key = meta.getKey();
      if (key === KEY_BUDGET_ID || key === KEY_BUDGET_NAME || key === KEY_ACCOUNT_ID || key === KEY_ACCOUNT_NAME) {
        meta.remove();
      }
    }
  }

  return {
    getLinkedAccount: getLinkedAccount,
    setLinkedAccount: setLinkedAccount,
    clearLinkedAccount: clearLinkedAccount
  };
})();
