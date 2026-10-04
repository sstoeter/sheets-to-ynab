/**
 * YnabClient.js
 * Wrapper around the YNAB REST API v1.
 */

var YnabClient = (function() {
  var BASE_URL = 'https://api.ynab.com/v1';

  /**
   * Helper to make authenticated requests to YNAB.
   */
  function request(endpoint, options) {
    var token = OAuthManager.getAccessToken();
    var opts = options || {};
    var headers = opts.headers || {};
    headers['Authorization'] = 'Bearer ' + token;
    headers['Accept'] = 'application/json';

    var fetchOptions = {
      method: opts.method || 'get',
      headers: headers,
      muteHttpExceptions: true
    };

    if (opts.payload) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.payload = JSON.stringify(opts.payload);
    }

    var url = BASE_URL + endpoint;
    var response = UrlFetchApp.fetch(url, fetchOptions);
    var code = response.getResponseCode();
    var bodyText = response.getContentText();

    var json = {};
    try {
      json = JSON.parse(bodyText);
    } catch (e) {
      throw new Error('YNAB API returned non-JSON response (HTTP ' + code + '): ' + bodyText);
    }

    if (code >= 400) {
      var errorMsg = (json.error && json.error.detail) ? json.error.detail : ('HTTP ' + code);
      throw new Error('YNAB API Error: ' + errorMsg);
    }

    return json.data;
  }

  /**
   * Fetches all budgets for the authenticated user.
   * @return {Array<Object>} List of budgets { id, name, last_modified_on }
   */
  function fetchBudgets() {
    var data = request('/budgets?include_accounts=false');
    return data.budgets || [];
  }

  /**
   * Fetches all active/open accounts for a specific budget.
   * @param {string} budgetId
   * @return {Array<Object>} List of open accounts { id, name, type, on_budget }
   */
  function fetchAccounts(budgetId) {
    if (!budgetId) throw new Error('Budget ID is required.');
    var data = request('/budgets/' + encodeURIComponent(budgetId) + '/accounts');
    var accounts = data.accounts || [];

    // Filter out closed accounts
    return accounts.filter(function(acc) {
      return !acc.closed && !acc.deleted;
    });
  }

  /**
   * Fetches transactions for an account since a specified ISO date (inclusive).
   * @param {string} budgetId
   * @param {string} accountId
   * @param {string} sinceDate ISO format YYYY-MM-DD
   * @return {Array<Object>} List of transactions
   */
  function fetchTransactionsSince(budgetId, accountId, sinceDate) {
    if (!budgetId || !accountId) throw new Error('Budget ID and Account ID are required.');
    var endpoint = '/budgets/' + encodeURIComponent(budgetId) +
                   '/accounts/' + encodeURIComponent(accountId) +
                   '/transactions';
    if (sinceDate) {
      endpoint += '?since_date=' + encodeURIComponent(sinceDate);
    }
    var data = request(endpoint);
    return data.transactions || [];
  }

  /**
   * Uploads an array of transactions in batches of up to 250 items.
   * @param {string} budgetId
   * @param {Array<Object>} transactions
   * @return {Object} Summary with transaction_ids and duplicate_import_ids
   */
  function postTransactions(budgetId, transactions) {
    if (!budgetId) throw new Error('Budget ID is required.');
    if (!transactions || transactions.length === 0) {
      return { transaction_ids: [], duplicate_import_ids: [], transactions: [] };
    }

    var BATCH_SIZE = 250;
    var allCreated = [];
    var allDuplicates = [];

    for (var i = 0; i < transactions.length; i += BATCH_SIZE) {
      var batch = transactions.slice(i, i + BATCH_SIZE);
      var payload = { transactions: batch };
      var data = request('/budgets/' + encodeURIComponent(budgetId) + '/transactions', {
        method: 'post',
        payload: payload
      });

      if (data.duplicate_import_ids) {
        allDuplicates = allDuplicates.concat(data.duplicate_import_ids);
      }
      if (data.transaction_ids && data.transaction_ids.length > 0) {
        allCreated = allCreated.concat(data.transaction_ids);
      } else if (data.transactions && data.transactions.length > 0) {
        allCreated = allCreated.concat(data.transactions.map(function(t) { return t.id; }));
      }
    }

    return {
      transaction_ids: allCreated,
      duplicate_import_ids: allDuplicates
    };
  }

  return {
    fetchBudgets: fetchBudgets,
    fetchAccounts: fetchAccounts,
    fetchTransactionsSince: fetchTransactionsSince,
    postTransactions: postTransactions
  };
})();
