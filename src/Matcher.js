/**
 * Matcher.js
 * Implements transaction matching with a 1-to-1 consumption pool to handle ambiguous duplicates.
 * Features German/European umlaut transliteration, bank delimiter parsing, token set overlap,
 * fuzzy substring matching, and multi-day clearing window matching (+/- 4 days).
 */

var Matcher = (function() {
  /**
   * Cleans and normalizes a payee string for comparison.
   * Transliterates German/European umlauts (ä->ae, ö->oe, ü->ue, ß->ss),
   * strips diacritics/accents, converts to lowercase, and removes punctuation.
   *
   * @param {string} str
   * @return {string}
   */
  function normalizePayee(str) {
    if (!str) return '';
    return String(str)
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/Ä/g, 'ae')
      .replace(/Ö/g, 'oe')
      .replace(/Ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extracts distinct word tokens of at least 2 characters.
   *
   * @param {string} str
   * @return {Array<string>}
   */
  function getTokens(str) {
    var norm = normalizePayee(str);
    if (!norm) return [];
    return norm.split(/\s+/).filter(function(w) { return w.length >= 2; });
  }

  /**
   * Extracts the primary payee segment (the portion before semicolons or slashes).
   * Commonly used in bank exports where name and address/notes are delimited by semicolons.
   *
   * @param {string} str
   * @return {string}
   */
  function getPrimarySegment(str) {
    if (!str) return '';
    var parts = String(str).split(/[;|\/]/);
    return parts[0].trim();
  }

  /**
   * Computes string similarity between two strings using bigram / Dice's coefficient (0.0 - 1.0).
   *
   * @param {string} n1 - Already normalized string
   * @param {string} n2 - Already normalized string
   * @return {number}
   */
  function diceCoefficient(n1, n2) {
    if (n1 === n2) return 1.0;
    if (!n1 || !n2 || n1.length < 2 || n2.length < 2) return 0.0;

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
   * Evaluates comprehensive similarity between two payee strings using:
   * 1. Primary segment matching (before delimiters)
   * 2. Substring containment
   * 3. Word token set overlap (handles word reordering)
   * 4. Bigram Dice coefficient
   *
   * @param {string} s1
   * @param {string} s2
   * @return {number} Score between 0.0 and 1.0
   */
  function stringSimilarity(s1, s2) {
    var n1 = normalizePayee(s1);
    var n2 = normalizePayee(s2);

    if (n1 === n2 && n1 !== '') return 1.0;
    if (!n1 || !n2) return 0.0;

    // 1. Primary segment match (e.g. "Aerztekasse Genossenschaft;Caisse..." vs "Ärztekasse Genossenschaft")
    var p1 = normalizePayee(getPrimarySegment(s1));
    var p2 = normalizePayee(getPrimarySegment(s2));
    if (p1 === p2 && p1.length >= 3) return 1.0;

    // 2. Substring matching (e.g. "Coop Basel" vs "Coop")
    var shorter = n1.length <= n2.length ? n1 : n2;
    var longer = n1.length > n2.length ? n1 : n2;
    if (shorter.length >= 3 && longer.indexOf(shorter) !== -1) {
      return 0.95;
    }

    // 3. Word token overlap (e.g. "Hans Müller" vs "Müller Hans")
    var tokens1 = getTokens(s1);
    var tokens2 = getTokens(s2);
    if (tokens1.length > 0 && tokens2.length > 0) {
      var set1 = {};
      for (var i = 0; i < tokens1.length; i++) set1[tokens1[i]] = true;
      var set2 = {};
      for (var j = 0; j < tokens2.length; j++) set2[tokens2[j]] = true;

      var common = 0;
      for (var k in set2) {
        if (set1[k]) common++;
      }
      var minTokens = Math.min(Object.keys(set1).length, Object.keys(set2).length);
      if (minTokens > 0) {
        var tokenRatio = common / minTokens;
        if (tokenRatio === 1.0) return 0.95;
        if (tokenRatio >= 0.75) return 0.85;
      }
    }

    // 4. Fallback: Bigram Dice similarity on primary segment and full string
    var dicePrimary = diceCoefficient(p1, p2);
    var diceFull = diceCoefficient(n1, n2);
    return Math.max(dicePrimary, diceFull);
  }

  /**
   * Calculates absolute difference in calendar days between two YYYY-MM-DD strings.
   *
   * @param {string} d1Str
   * @param {string} d2Str
   * @return {number}
   */
  function getDateDiffDays(d1Str, d2Str) {
    if (!d1Str || !d2Str) return 999;
    var p1 = d1Str.split('-');
    var p2 = d2Str.split('-');
    var t1 = Date.UTC(parseInt(p1[0], 10), parseInt(p1[1], 10) - 1, parseInt(p1[2], 10));
    var t2 = Date.UTC(parseInt(p2[0], 10), parseInt(p2[1], 10) - 1, parseInt(p2[2], 10));
    return Math.round(Math.abs(t1 - t2) / (1000 * 60 * 60 * 24));
  }

  /**
   * Matches sheet transactions against YNAB transactions using 1-to-1 consumption.
   * Groups candidates by exact milliunit amount, evaluating date distance (+/- 4 days)
   * and fuzzy payee similarity.
   *
   * @param {Array<Object>} sheetTransactions
   * @param {Array<Object>} ynabTransactions
   * @return {Object} {
   *   matchedCount: number,
   *   unmatchedCount: number,
   *   updates: Array<{ rowNum, status, ynabId }>,
   *   details: Array<string>
   * }
   */
  function matchSheetWithYnab(sheetTransactions, ynabTransactions) {
    // Build pool grouped by exact milliunit amount
    var pool = {};
    for (var y = 0; y < ynabTransactions.length; y++) {
      var tx = ynabTransactions[y];
      if (tx.deleted) continue;
      var amtKey = String(tx.amount);
      if (!pool[amtKey]) pool[amtKey] = [];
      pool[amtKey].push(tx);
    }

    var updates = [];
    var details = [];
    var matchedCount = 0;
    var unmatchedCount = 0;

    for (var i = 0; i < sheetTransactions.length; i++) {
      var sheetTx = sheetTransactions[i];
      var amtKey = String(sheetTx.milliunits);
      var candidates = pool[amtKey];

      var matchedIndex = -1;
      var bestScore = 0;
      var matchReason = '';

      if (candidates && candidates.length > 0) {
        for (var c = 0; c < candidates.length; c++) {
          var ynabTx = candidates[c];
          var dateDiff = getDateDiffDays(sheetTx.date, ynabTx.date);

          // Allow a multi-day clearing window up to 4 days
          if (dateDiff > 4) continue;

          var ynabPayee = ynabTx.payee_name || '';
          var rawScore = stringSimilarity(sheetTx.payee, ynabPayee);

          // If payee score is low, also check sheetTx.memo
          if (rawScore < 0.6 && sheetTx.memo) {
            var memoScore = stringSimilarity(sheetTx.memo, ynabPayee);
            if (memoScore * 0.9 > rawScore) {
              rawScore = memoScore * 0.9;
            }
          }

          // Apply slight penalty for date difference (5% per day)
          var dateMultiplier = 1.0 - (dateDiff * 0.05);
          var finalScore = rawScore * dateMultiplier;

          // Threshold: 0.50 if exact day & single candidate, otherwise 0.60
          var threshold = (dateDiff === 0 && candidates.length === 1) ? 0.50 : 0.60;

          if (finalScore >= threshold && finalScore > bestScore) {
            bestScore = finalScore;
            matchedIndex = c;
            matchReason = 'Matched with "' + ynabPayee + '" (' + ynabTx.date + ', diff=' + dateDiff + 'd, score=' + Math.round(finalScore * 100) + '%)';
            if (finalScore >= 0.95 && dateDiff === 0) break; // Strong match found
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
        details.push('Row ' + sheetTx.rowNum + ': ' + matchReason);
      } else {
        // Unmatched
        unmatchedCount++;
        updates.push({
          rowNum: sheetTx.rowNum,
          status: 'Unmatched',
          ynabId: ''
        });
        var count = candidates ? candidates.length : 0;
        details.push('Row ' + sheetTx.rowNum + ' (' + sheetTx.date + ', ' + (sheetTx.milliunits / 1000) + '): Unmatched (' + count + ' candidates with same amount)');
      }
    }

    return {
      matchedCount: matchedCount,
      unmatchedCount: unmatchedCount,
      updates: updates,
      details: details
    };
  }

  return {
    normalizePayee: normalizePayee,
    getPrimarySegment: getPrimarySegment,
    stringSimilarity: stringSimilarity,
    getDateDiffDays: getDateDiffDays,
    matchSheetWithYnab: matchSheetWithYnab
  };
})();
