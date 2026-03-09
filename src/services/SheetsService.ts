import { google } from 'googleapis';
import { logToFile } from '../utils/logger.js';
import type { AuthManager } from '../auth/AuthManager.js';

function extractSheetId(input: string): string {
  if (input.startsWith('http')) {
    const match = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : input;
  }
  return input;
}

export class SheetsService {
  constructor(private authManager: AuthManager) {}

  private async getSheets() {
    const auth = await this.authManager.getAuthenticatedClient();
    return google.sheets({ version: 'v4', auth });
  }

  private async getDrive() {
    const auth = await this.authManager.getAuthenticatedClient();
    return google.drive({ version: 'v3', auth });
  }

  getText = async (input: {
    spreadsheetId: string;
    format?: 'text' | 'csv' | 'json';
  }) => {
    const spreadsheetId = extractSheetId(input.spreadsheetId);
    const format = input.format || 'text';
    logToFile(`sheets.getText: ${spreadsheetId} (${format})`);
    try {
      const sheets = await this.getSheets();
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetNames =
        meta.data.sheets?.map((s) => s.properties?.title || '') || [];

      const results: Array<{ sheet: string; data: unknown }> = [];

      for (const name of sheetNames) {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: name,
        });
        const values = res.data.values || [];

        if (format === 'csv') {
          results.push({
            sheet: name,
            data: values.map((row) => row.join(',')).join('\n'),
          });
        } else if (format === 'json' && values.length > 1) {
          const headers = values[0];
          const rows = values.slice(1).map((row) => {
            const obj: Record<string, string> = {};
            headers.forEach((h, i) => {
              obj[h] = row[i] || '';
            });
            return obj;
          });
          results.push({ sheet: name, data: rows });
        } else {
          results.push({
            sheet: name,
            data: values.map((row) => row.join('\t')).join('\n'),
          });
        }
      }

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(results) },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  getRange = async (input: { spreadsheetId: string; range: string }) => {
    const spreadsheetId = extractSheetId(input.spreadsheetId);
    logToFile(`sheets.getRange: ${spreadsheetId} ${input.range}`);
    try {
      const sheets = await this.getSheets();
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: input.range,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              range: res.data.range,
              values: res.data.values,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  find = async (input: {
    query: string;
    pageToken?: string;
    pageSize?: number;
  }) => {
    logToFile(`sheets.find: ${input.query}`);
    try {
      const drive = await this.getDrive();
      const escapedQuery = input.query.replace(/'/g, "\\'");
      const res = await drive.files.list({
        q: `mimeType = 'application/vnd.google-apps.spreadsheet' and name contains '${escapedQuery}' and trashed = false`,
        pageSize: input.pageSize || 10,
        pageToken: input.pageToken,
        fields:
          'nextPageToken, files(id, name, modifiedTime, webViewLink, owners)',
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              files: res.data.files,
              nextPageToken: res.data.nextPageToken,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  getMetadata = async (input: { spreadsheetId: string }) => {
    const spreadsheetId = extractSheetId(input.spreadsheetId);
    logToFile(`sheets.getMetadata: ${spreadsheetId}`);
    try {
      const sheets = await this.getSheets();
      const res = await sheets.spreadsheets.get({ spreadsheetId });
      const meta = {
        spreadsheetId: res.data.spreadsheetId,
        title: res.data.properties?.title,
        locale: res.data.properties?.locale,
        sheets: res.data.sheets?.map((s) => ({
          sheetId: s.properties?.sheetId,
          title: s.properties?.title,
          rowCount: s.properties?.gridProperties?.rowCount,
          columnCount: s.properties?.gridProperties?.columnCount,
        })),
        url: res.data.spreadsheetUrl,
      };
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(meta) },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  private errorResponse(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logToFile(`Sheets error: ${msg}`);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
    };
  }
}
