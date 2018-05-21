// inspired by https://github.com/parro-it/electron-google-oauth
import { BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import { OAuth2Client } from 'google-auth-library';
import { Credentials } from 'google-auth-library/build/src/auth/credentials';
import { google } from 'googleapis';
import { stringify } from 'querystring';
import * as url from 'url';

export class UserClosedWindowError extends Error {
  constructor() {
    super('User closed the window');
  }
}

/**
 * Tokens updated event
 *
 * @event ElectronGoogleOAuth2#tokens
 * @type {Credentials}
 */

/**
 * Handle Google Auth processes through Electron.
 * This class automatically renews expired tokens.
 * @fires ElectronGoogleOAuth2#tokens
 */
export default class ElectronGoogleOAuth2 extends EventEmitter {

  public oauth2Client: OAuth2Client;
  public scopes: string[];

  /**
   * Create a new instance of ElectronGoogleOAuth2
   * @param {string} clientId - Google Client ID
   * @param {string} clientSecret - Google Client Secret
   * @param {string[]} scopes - Google scopes. 'profile' and 'email' will always be present
   * @param {string} redirectUri - defaults to 'urn:ietf:wg:oauth:2.0:oob'
   */
  constructor(clientId: string, clientSecret: string, scopes: string[], redirectUri: string = 'urn:ietf:wg:oauth:2.0:oob') {
    super();
    // Force fetching id_token if not provided
    if (!scopes.includes('profile')) scopes.push('profile');
    if (!scopes.includes('email')) scopes.push('email');
    this.scopes = scopes;
    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );
    this.oauth2Client.on('tokens', (tokens) => {
      this.emit('tokens', tokens);
    });
  }

  /**
   * Returns authUrl generated by googleapis
   * @param {boolean} forceAddSession
   * @returns {string}
   */
  generateAuthUrl(forceAddSession: boolean = false) {
    let url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline', // 'online' (default) or 'offline' (gets refresh_token)
      scope: this.scopes,
    });

    if (forceAddSession) {
      const qs = stringify({ continue: url });
      url = `https://accounts.google.com/AddSession?${qs}`;
    }

    return url;
  }

  /**
   * Get authorization code for underlying authUrl
   * @param {boolean} forceAddSession
   * @returns {Promise<string>}
   */
  getAuthorizationCode(forceAddSession: boolean = false) {
    const url = this.generateAuthUrl(forceAddSession);
    return this.openAuthWindowAndGetAuthorizationCode(url);
  }

  /**
   * Get authorization code for given url
   * @param {string} urlParam
   * @returns {Promise<string>}
   */
  openAuthWindowAndGetAuthorizationCode(urlParam: string) {
    return new Promise<string>((resolve, reject) => {
      const win = new BrowserWindow({
        useContentSize: true,
        fullscreen: false,
      });

      win.loadURL(urlParam);

      win.on('closed', () => {
        reject(new UserClosedWindowError());
      });

      function closeWin() {
        win.removeAllListeners('closed');
        setImmediate( () => {
          win.close();
        });
      }

      win.webContents.on('did-get-redirect-request', (_event, _oldUrl, newUrl) => {
        const parsed = url.parse(newUrl, true);
        if (parsed.query.error) {
          reject(new Error(parsed.query.error_description as string));
          closeWin();
        } else if (parsed.query.code) {
          resolve(parsed.query.code as string);
          closeWin();
        }
      });

      win.on('page-title-updated', () => {
        setImmediate(() => {
          const title = win.getTitle();
          if (title.startsWith('Denied')) {
            reject(new Error(title.split(/[ =]/)[2]));
            closeWin();
          } else if (title.startsWith('Success')) {
            resolve(title.split(/[ =]/)[2]);
            closeWin();
          }
        });
      });
    });
  }

  /**
   * Get Google tokens for given scopes
   * @param {boolean} forceAddSession
   * @returns {Promise<Credentials>}
   */
  openAuthWindowAndGetTokens(forceAddSession: boolean = false) {
    return this
      .getAuthorizationCode(forceAddSession)
      .then((authorizationCode) => {
        return this.oauth2Client
          .getToken(authorizationCode)
          .then(response => {
            this.oauth2Client.setCredentials(response.tokens);
            return response.tokens;
          });
      });
  }

  setTokens(tokens: Credentials) {
    this.oauth2Client.setCredentials(tokens);
  }
}
