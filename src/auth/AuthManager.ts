import { google, Auth } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { authenticate } from '@google-cloud/local-auth';
import { logToFile } from '../utils/logger.js';
import { TOKEN_EXPIRY_BUFFER_MS } from '../utils/constants.js';

const CONFIG_DIR = path.join(os.homedir(), '.google-workspace-mcp');
const TOKEN_PATH = path.join(CONFIG_DIR, 'tokens.json');

function findCredentialsPath(): string {
  const envPath = process.env['GOOGLE_CREDENTIALS_PATH'];
  if (envPath && fs.existsSync(envPath)) return envPath;

  const localPath = path.join(process.cwd(), 'credentials.json');
  if (fs.existsSync(localPath)) return localPath;

  const configPath = path.join(CONFIG_DIR, 'credentials.json');
  if (fs.existsSync(configPath)) return configPath;

  throw new Error(
    'credentials.json not found. Place it in the project root, ' +
      `~/.google-workspace-mcp/, or set GOOGLE_CREDENTIALS_PATH. ` +
      'Download it from https://console.cloud.google.com/ ' +
      '(APIs & Services > Credentials > OAuth 2.0 Client > Desktop app).',
  );
}

export class AuthManager {
  private client: Auth.OAuth2Client | null = null;
  private scopes: string[];

  constructor(scopes: string[]) {
    this.scopes = scopes;
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  async getAuthenticatedClient(): Promise<Auth.OAuth2Client> {
    logToFile('getAuthenticatedClient called');

    if (this.client?.credentials?.refresh_token) {
      if (this.isTokenExpiringSoon(this.client.credentials)) {
        logToFile('Token expiring soon, refreshing...');
        try {
          const { credentials } = await this.client.refreshAccessToken();
          this.client.setCredentials(credentials);
          await this.saveTokens(this.client);
          logToFile('Token refreshed successfully');
        } catch (err) {
          logToFile(`Token refresh failed: ${err}`);
          this.client = null;
        }
      }
      if (this.client) return this.client;
    }

    const saved = await this.loadSavedTokens();
    if (saved) {
      logToFile('Loaded saved tokens');
      this.client = saved;

      if (this.isTokenExpiringSoon(saved.credentials)) {
        logToFile('Saved token expiring, refreshing...');
        try {
          const { credentials } = await saved.refreshAccessToken();
          saved.setCredentials(credentials);
          await this.saveTokens(saved);
        } catch (err) {
          logToFile(`Saved token refresh failed: ${err}`);
          this.client = null;
        }
      }
      if (this.client) return this.client;
    }

    logToFile('No valid tokens, starting OAuth flow...');
    this.client = await this.authorizeWithBrowser();
    await this.saveTokens(this.client);
    return this.client;
  }

  async clearAuth(): Promise<void> {
    logToFile('Clearing authentication...');
    this.client = null;
    if (fs.existsSync(TOKEN_PATH)) {
      fs.unlinkSync(TOKEN_PATH);
    }
    logToFile('Authentication cleared.');
  }

  async refreshToken(): Promise<void> {
    if (!this.client) {
      this.client = await this.getAuthenticatedClient();
    }
    const { credentials } = await this.client.refreshAccessToken();
    this.client.setCredentials(credentials);
    await this.saveTokens(this.client);
    logToFile('Token manually refreshed');
  }

  private isTokenExpiringSoon(credentials: Auth.Credentials): boolean {
    return !!(
      credentials.expiry_date &&
      credentials.expiry_date < Date.now() + TOKEN_EXPIRY_BUFFER_MS
    );
  }

  private async authorizeWithBrowser(): Promise<Auth.OAuth2Client> {
    const credentialsPath = findCredentialsPath();
    logToFile(`Using credentials from: ${credentialsPath}`);

    const client = await authenticate({
      scopes: this.scopes,
      keyfilePath: credentialsPath,
    });

    return client as unknown as Auth.OAuth2Client;
  }

  private async loadSavedTokens(): Promise<Auth.OAuth2Client | null> {
    try {
      if (!fs.existsSync(TOKEN_PATH)) return null;

      const content = fs.readFileSync(TOKEN_PATH, 'utf-8');
      const tokens = JSON.parse(content);
      const credentialsPath = findCredentialsPath();
      const keys = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
      const key = keys.installed || keys.web;

      const client = new google.auth.OAuth2(
        key.client_id,
        key.client_secret,
        key.redirect_uris?.[0],
      );
      client.setCredentials(tokens);

      client.on('tokens', async (newTokens) => {
        const merged = {
          ...tokens,
          ...newTokens,
          refresh_token: newTokens.refresh_token || tokens.refresh_token,
        };
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
        logToFile('Tokens auto-saved after refresh event');
      });

      return client;
    } catch (err) {
      logToFile(`Failed to load saved tokens: ${err}`);
      return null;
    }
  }

  private async saveTokens(client: Auth.OAuth2Client): Promise<void> {
    const tokens = client.credentials;
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    logToFile('Tokens saved');
  }
}
