/**
 * AuthManager.js
 * Manages YNAB authentication using Personal Access Tokens (PAT).
 * Persists token per-user in UserProperties (with fallback to ScriptProperties).
 */

var AuthManager = (function() {
  var TOKEN_KEY = 'YNAB_ACCESS_TOKEN';

  /**
   * Retrieves the stored YNAB Personal Access Token.
   * Checks UserProperties first, then falls back to ScriptProperties.
   * @return {string|null}
   */
  function getAccessToken() {
    var userToken = PropertiesService.getUserProperties().getProperty(TOKEN_KEY);
    if (userToken && userToken.trim()) {
      return userToken.trim();
    }
    var scriptToken = PropertiesService.getScriptProperties().getProperty(TOKEN_KEY);
    if (scriptToken && scriptToken.trim()) {
      return scriptToken.trim();
    }
    return null;
  }

  /**
   * Checks whether a YNAB access token is configured.
   * @return {boolean}
   */
  function isAuthorized() {
    return !!getAccessToken();
  }

  /**
   * Saves the YNAB Personal Access Token into UserProperties.
   * @param {string} token - Raw PAT from YNAB Settings > Developer Settings
   */
  function setAccessToken(token) {
    if (!token || typeof token !== 'string' || !token.trim()) {
      throw new Error('Personal Access Token cannot be blank.');
    }
    var cleanedToken = token.trim();
    // In case the user pasted "Bearer <token>", strip leading "Bearer "
    if (cleanedToken.toLowerCase().indexOf('bearer ') === 0) {
      cleanedToken = cleanedToken.substring(7).trim();
    }
    PropertiesService.getUserProperties().setProperty(TOKEN_KEY, cleanedToken);
  }

  /**
   * Clears the stored YNAB token to disconnect/log out.
   */
  function disconnect() {
    PropertiesService.getUserProperties().deleteProperty(TOKEN_KEY);
    PropertiesService.getScriptProperties().deleteProperty(TOKEN_KEY);
  }

  /**
   * Returns a masked representation of the active token (e.g. "••••••1234").
   * @return {string}
   */
  function getMaskedToken() {
    var token = getAccessToken();
    if (!token) return 'None';
    if (token.length <= 8) return '••••••••';
    return '••••••••' + token.substring(token.length - 4);
  }

  return {
    getAccessToken: getAccessToken,
    isAuthorized: isAuthorized,
    setAccessToken: setAccessToken,
    disconnect: disconnect,
    getMaskedToken: getMaskedToken
  };
})();
