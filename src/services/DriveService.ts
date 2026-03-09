import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import { logToFile } from '../utils/logger.js';
import type { AuthManager } from '../auth/AuthManager.js';

function extractIdFromUrl(input: string): string {
  if (input.startsWith('http')) {
    const match = input.match(/[-\w]{25,}/);
    return match ? match[0] : input;
  }
  return input;
}

export class DriveService {
  constructor(private authManager: AuthManager) {}

  private async getDrive() {
    const auth = await this.authManager.getAuthenticatedClient();
    return google.drive({ version: 'v3', auth });
  }

  search = async (input: {
    query?: string;
    pageSize?: number;
    pageToken?: string;
    corpus?: string;
    sharedWithMe?: boolean;
  }) => {
    const { query, pageSize = 20, pageToken, corpus, sharedWithMe } = input;
    logToFile(`drive.search: ${query}`);
    try {
      const drive = await this.getDrive();

      let q = '';
      if (query) {
        if (query.startsWith('http')) {
          const id = extractIdFromUrl(query);
          q = `'${id}' in parents or name contains '${id}'`;
        } else if (
          query.includes('contains') ||
          query.includes('=') ||
          query.includes(' in ')
        ) {
          q = query;
        } else {
          q = `name contains '${query.replace(/'/g, "\\'")}'`;
        }
      }

      if (sharedWithMe) {
        q = q ? `${q} and sharedWithMe = true` : 'sharedWithMe = true';
      }
      q = q ? `${q} and trashed = false` : 'trashed = false';

      const res = await drive.files.list({
        q,
        pageSize,
        pageToken,
        corpus,
        fields:
          'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, owners)',
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

  findFolder = async (input: { folderName: string }) => {
    logToFile(`drive.findFolder: ${input.folderName}`);
    try {
      const drive = await this.getDrive();
      const res = await drive.files.list({
        q: `name = '${input.folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name, webViewLink)',
      });
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(res.data.files) },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  createFolder = async (input: { name: string; parentId?: string }) => {
    logToFile(`drive.createFolder: ${input.name}`);
    try {
      const drive = await this.getDrive();
      const res = await drive.files.create({
        requestBody: {
          name: input.name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: input.parentId ? [input.parentId] : undefined,
        },
        fields: 'id, name, webViewLink',
      });
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(res.data) },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  downloadFile = async (input: { fileId: string; localPath: string }) => {
    const fileId = extractIdFromUrl(input.fileId);
    logToFile(`drive.downloadFile: ${fileId} -> ${input.localPath}`);
    try {
      const drive = await this.getDrive();
      const dir = path.dirname(input.localPath);
      fs.mkdirSync(dir, { recursive: true });

      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' },
      );

      const writer = fs.createWriteStream(input.localPath);
      await new Promise<void>((resolve, reject) => {
        (res.data as NodeJS.ReadableStream)
          .pipe(writer)
          .on('finish', resolve)
          .on('error', reject);
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              message: `File downloaded to ${input.localPath}`,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  moveFile = async (input: {
    fileId: string;
    folderId?: string;
    folderName?: string;
  }) => {
    const fileId = extractIdFromUrl(input.fileId);
    logToFile(`drive.moveFile: ${fileId}`);
    try {
      const drive = await this.getDrive();

      let targetFolderId = input.folderId;
      if (!targetFolderId && input.folderName) {
        const result = await this.findFolder({
          folderName: input.folderName,
        });
        const folders = JSON.parse(result.content[0].text);
        if (folders.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Folder "${input.folderName}" not found`,
                }),
              },
            ],
          };
        }
        targetFolderId = folders[0].id;
      }

      if (!targetFolderId) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Either folderId or folderName must be provided',
              }),
            },
          ],
        };
      }

      const file = await drive.files.get({
        fileId,
        fields: 'parents',
      });
      const previousParents = file.data.parents?.join(',') || '';

      const res = await drive.files.update({
        fileId,
        addParents: targetFolderId,
        removeParents: previousParents,
        fields: 'id, name, parents, webViewLink',
      });

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(res.data) },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  trashFile = async (input: { fileId: string }) => {
    const fileId = extractIdFromUrl(input.fileId);
    logToFile(`drive.trashFile: ${fileId}`);
    try {
      const drive = await this.getDrive();
      await drive.files.update({
        fileId,
        requestBody: { trashed: true },
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ message: `File ${fileId} moved to trash` }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  renameFile = async (input: { fileId: string; newName: string }) => {
    const fileId = extractIdFromUrl(input.fileId);
    logToFile(`drive.renameFile: ${fileId} -> ${input.newName}`);
    try {
      const drive = await this.getDrive();
      const res = await drive.files.update({
        fileId,
        requestBody: { name: input.newName },
        fields: 'id, name, webViewLink',
      });
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(res.data) },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  getComments = async (input: { fileId: string }) => {
    const fileId = extractIdFromUrl(input.fileId);
    logToFile(`drive.getComments: ${fileId}`);
    try {
      const drive = await this.getDrive();
      const res = await drive.comments.list({
        fileId,
        fields:
          'comments(id, content, author, createdTime, resolved, replies)',
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(res.data.comments || []),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  private errorResponse(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logToFile(`Drive error: ${msg}`);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
    };
  }
}
