/**
 * Matcher.js
 * Implements transaction matching with a 1-to-1 consumption pool to handle ambiguous duplicates.
 */

var Matcher = (function() {
  /**
   * Cleans and normalizes a payee string for comparison.
   * Strips diacritics/accents, converts to lowercase, and removes punctuation.
   */
  function normalizePayee(str) {
    if (!str) return '';
    return String(str)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Computes string similarity between two strings using bigram / Dice's coefficient (0.0 - 1.0).
   */
  function stringSimilarity(s1, s2) {
    var n1 = normalizePayee(s1);
    var n2 = normalizePayee(s2);

    if (n1 === n2) return 1.0;
    if (!n1 || !n2) return 0.0;
    if (n1.indexOf(n2) !== -1 || n2.indexOf(n1) !== -1) {
      // Substring match with reasonable length
      var shorter = Math.min(n1.length, n2.length);
      var longer = Math.max(n1.length, n2.length);
      if (shorter >= 4 && (shorter / longer) >= 0.5) {
        return 0.9;
      }
    }

    if (n1.length < 2 || n2.length < 2) return 0.0;

    var bigrams1 = {};
    for (var i = 0; i < n1.length - 1; i++) {
      var bg = n1.substring(i, i + 2);
      bigrams1[bg] = (bigrams1[bg] || 0) + 1;
    }

    var intersection = 0;
    for (var j = 0; j < n2.length - 1; j++) {
      var bg2 = n2.substring(j, j + 2);
      if (bigrams1[bg2] && bigrams1[bg2] > 0) {
        intersection++;
        bigrams1[bg2]--;
      }
    }

    var totalBigrams = (n1.length - 1) + (n2.length - 1);
    return (2.0 * intersection) / totalBigrams;
  }

  /**
   * Builds an in-memory consumption pool of YNAB transactions.
   * Key: {date}_{milliunits} -> Array<ynabTransaction>
   */
  function buildConsumptionPool(ynabTransactions) {
    var pool = {};
    for (var i = 0; i < ynabTransactions.length; i++) {
      var tx = ynabTransactions[i];
      if (tx.deleted) continue;

      var key = tx.date + '_' + tx.amount;
      if (!pool[key]) {
        pool[key] = [];
      }
      pool[key].push(tx);
    }
    return pool;
  }

  /**
   * Matches sheet transactions against YNAB transactions using 1-to-1 consumption.
   *
   * @param {Array<Object>} sheetTransactions
   * @param {Array<Object>} ynabTransactions
   * @return {Object} {
   *   matchedCount: number,
   *   unmatchedCount: number,
   *   updates: Array<{ rowNum, status, ynabId }>
   * }
   */
  function matchSheetWithYnab(sheetTransactions, ynabTransactions) {
    var pool = buildConsumptionPool(ynabTransactions);
    var updates = [];
    var matchedCount = 0;
    var unmatchedCount = 0;

    for (var i = 0; i < sheetTransactions.length; i++) {
      var sheetTx = sheetTransactions[i];
      var key = sheetTx.date + '_' + sheetTx.milliunits;
      var candidates = pool[key];

      var matchedIndex = -1;
      var bestScore = 0;

      if (candidates && candidates.length > 0) {
        for (var c = 0; c < candidates.length; c++) {
          var ynabPayee = candidates[c].payee_name || '';
          var score = stringSimilarity(sheetTx.payee, ynabPayee);
          if (score >= 0.85 && score > bestScore) {
            bestScore = score;
            matchedIndex = c;
            if (score === 1.0) break; // Exact match found
          }
        }
      }

      if (matchedIndex !== -1) {
        // Matched! Consume candidate from pool so it cannot be matched again
        var matchedYnabTx = candidates.splice(matchedIndex, 1)[0];
        matchedCount++;
        updates.push({
          rowNum: sheetTx.rowNum,
          status: 'Matched',
          ynabId: matchedYnabTx.id
        });
      } else {
        // Unmatched (ready for upload)
        unmatchedCount++;
        updates.push({
          rowNum: sheetTx.rowNum,
          status: 'Unmatched',
          ynabId: ''
        });
      }
    }

    return {
      matchedCount: matchedCount,
      unmatchedCount: unmatchedCount,
      updates: updates
    };
  }

  return {
    normalizePayee: normalizePayee,
    stringSimilarity: stringSimilarity,
    buildConsumptionPool: buildConsumptionPool,
    matchSheetWithYnab: matchSheetWithYnab
  };
})();
