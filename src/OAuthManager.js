/**
 * OAuthManager.js
 * Manages OAuth 2.0 Authorization Code Grant and token refresh cycles with YNAB.
 */

var OAuthManager = (function() {
  var SERVICE_NAME = 'ynab';
  var AUTH_URL = 'https://app.ynab.com/oauth/authorize';
  var TOKEN_URL = 'https://app.ynab.com/oauth/token';

  /**
   * Checks whether the external OAuth2 library is available in the current context.
   */
  function isLibraryLoaded() {
    return typeof OAuth2 !== 'undefined' && typeof OAuth2.createService === 'function';
  }

  /**
   * Retrieves the OAuth2 service instance for YNAB.
   * Uses Developer Client ID/Secret stored in ScriptProperties,
   * and persists user tokens in UserProperties.
   */
  function getYnabService() {
    if (!isLibraryLoaded()) {
      throw new Error('OAuth2 library is not linked. Please ensure the library is added under Libraries in the Apps Script editor.');
    }
    var scriptProps = PropertiesService.getScriptProperties();
    var clientId = scriptProps.getProperty('YNAB_CLIENT_ID') || '';
    var clientSecret = scriptProps.getProperty('YNAB_CLIENT_SECRET') || '';

    return OAuth2.createService(SERVICE_NAME)
      .setAuthorizationBaseUrl(AUTH_URL)
      .setTokenUrl(TOKEN_URL)
      .setClientId(clientId)
      .setClientSecret(clientSecret)
      .setCallbackFunction('authCallback')
      .setPropertyStore(PropertiesService.getUserProperties())
      .setParam('response_type', 'code');
  }

  /**
   * Checks whether developer credentials have been configured in Script Properties.
   */
  function hasDeveloperCredentials() {
    var scriptProps = PropertiesService.getScriptProperties();
    var clientId = scriptProps.getProperty('YNAB_CLIENT_ID');
    var clientSecret = scriptProps.getProperty('YNAB_CLIENT_SECRET');
    return !!(clientId && clientSecret);
  }

  /**
   * Sets the developer client ID and client secret into Script Properties.
   */
  function setDeveloperCredentials(clientId, clientSecret) {
    if (!clientId || !clientSecret) {
      throw new Error('Both Client ID and Client Secret are required.');
    }
    PropertiesService.getScriptProperties().setProperties({
      YNAB_CLIENT_ID: clientId.trim(),
      YNAB_CLIENT_SECRET: clientSecret.trim()
    });
  }

  /**
   * Returns the exact Redirect URI needed for the YNAB Developer App.
   */
  function getRedirectUri() {
    return 'https://script.google.com/macros/d/' + ScriptApp.getScriptId() + '/usercallback';
  }

  /**
   * Checks if the current user has authorized the YNAB add-on.
   */
  function isAuthorized() {
    if (!isLibraryLoaded() || !hasDeveloperCredentials()) {
      return false;
    }
    try {
      return getYnabService().hasAccess();
    } catch (e) {
      return false;
    }
  }

  /**
   * Returns the OAuth authorization URL for the user to authenticate.
   */
  function getAuthorizationUrl() {
    if (!isLibraryLoaded()) {
      throw new Error('OAuth2 library is not linked in Apps Script.');
    }
    if (!hasDeveloperCredentials()) {
      throw new Error('YNAB Developer Client ID and Secret are not configured yet.');
    }
    return getYnabService().getAuthorizationUrl();
  }

  /**
   * Logs out the user by resetting the OAuth2 token store.
   */
  function disconnect() {
    if (isLibraryLoaded()) {
      getYnabService().reset();
    }
  }

  /**
   * Retrieves a valid access token (automatically refreshes expired tokens using the refresh_token).
   */
  function getAccessToken() {
    if (!isLibraryLoaded()) {
      throw new Error('OAuth2 library is not linked in Apps Script.');
    }
    var service = getYnabService();
    if (!service.hasAccess()) {
      throw new Error('User is not authorized with YNAB. Please connect your account first.');
    }
    return service.getAccessToken();
  }

  return {
    isLibraryLoaded: isLibraryLoaded,
    getYnabService: getYnabService,
    hasDeveloperCredentials: hasDeveloperCredentials,
    setDeveloperCredentials: setDeveloperCredentials,
    getRedirectUri: getRedirectUri,
    isAuthorized: isAuthorized,
    getAuthorizationUrl: getAuthorizationUrl,
    disconnect: disconnect,
    getAccessToken: getAccessToken
  };
})();

/**
 * Global OAuth2 callback handler invoked by Google Apps Script upon redirection from YNAB.
 */
function authCallback(request) {
  var service = OAuthManager.getYnabService();
  var isAuthorized = service.handleCallback(request);
  if (isAuthorized) {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding-top:40px;">' +
      '<h2 style="color:#137333;">✓ Successfully Connected to YNAB!</h2>' +
      '<p>You can close this tab and return to Google Sheets.</p>' +
      '</body></html>'
    );
  } else {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding-top:40px;">' +
      '<h2 style="color:#d93025;">Authorization Denied or Failed</h2>' +
      '<p>Please close this tab and try connecting again.</p>' +
      '</body></html>'
    );
  }
}
