import { google, gmail_v1 } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import { logToFile } from '../utils/logger.js';
import { GMAIL_SEARCH_MAX_RESULTS } from '../utils/constants.js';
import type { AuthManager } from '../auth/AuthManager.js';

export class GmailService {
  constructor(private authManager: AuthManager) {}

  private async getGmail() {
    const auth = await this.authManager.getAuthenticatedClient();
    return google.gmail({ version: 'v1', auth });
  }

  search = async (input: {
    query?: string;
    maxResults?: number;
    pageToken?: string;
    labelIds?: string[];
    includeSpamTrash?: boolean;
  }) => {
    logToFile(`gmail.search: ${input.query}`);
    try {
      const gmail = await this.getGmail();
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: input.query,
        maxResults: input.maxResults || GMAIL_SEARCH_MAX_RESULTS,
        pageToken: input.pageToken,
        labelIds: input.labelIds,
        includeSpamTrash: input.includeSpamTrash,
      });

      const messages = res.data.messages || [];
      const details = await Promise.all(
        messages.map(async (msg) => {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id!,
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Subject', 'Date'],
          });
          const headers = detail.data.payload?.headers || [];
          const getHeader = (name: string) =>
            headers.find(
              (h) => h.name?.toLowerCase() === name.toLowerCase(),
            )?.value || '';
          return {
            id: msg.id,
            threadId: msg.threadId,
            from: getHeader('From'),
            to: getHeader('To'),
            subject: getHeader('Subject'),
            date: getHeader('Date'),
            snippet: detail.data.snippet,
            labelIds: detail.data.labelIds,
          };
        }),
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              messages: details,
              nextPageToken: res.data.nextPageToken,
              resultSizeEstimate: res.data.resultSizeEstimate,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  get = async (input: { messageId: string; format?: string }) => {
    logToFile(`gmail.get: ${input.messageId}`);
    try {
      const gmail = await this.getGmail();
      const res = await gmail.users.messages.get({
        userId: 'me',
        id: input.messageId,
        format: (input.format as gmail_v1.Params$Resource$Users$Messages$Get['format']) || 'full',
      });

      const data = res.data;
      const headers = data.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find(
          (h) => h.name?.toLowerCase() === name.toLowerCase(),
        )?.value || '';

      let body = '';
      if (data.payload?.body?.data) {
        body = Buffer.from(data.payload.body.data, 'base64').toString('utf-8');
      } else if (data.payload?.parts) {
        const textPart = data.payload.parts.find(
          (p) => p.mimeType === 'text/plain',
        );
        const htmlPart = data.payload.parts.find(
          (p) => p.mimeType === 'text/html',
        );
        const part = textPart || htmlPart;
        if (part?.body?.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      }

      const attachments = (data.payload?.parts || [])
        .filter((p) => p.filename && p.body?.attachmentId)
        .map((p) => ({
          filename: p.filename,
          mimeType: p.mimeType,
          attachmentId: p.body!.attachmentId,
          size: p.body!.size,
        }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              id: data.id,
              threadId: data.threadId,
              from: getHeader('From'),
              to: getHeader('To'),
              cc: getHeader('Cc'),
              subject: getHeader('Subject'),
              date: getHeader('Date'),
              body,
              labelIds: data.labelIds,
              attachments,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  downloadAttachment = async (input: {
    messageId: string;
    attachmentId: string;
    localPath: string;
  }) => {
    logToFile(`gmail.downloadAttachment: ${input.messageId}/${input.attachmentId}`);
    try {
      const gmail = await this.getGmail();
      const res = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: input.messageId,
        id: input.attachmentId,
      });

      if (!res.data.data) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'No attachment data' }),
            },
          ],
        };
      }

      const dir = path.dirname(input.localPath);
      fs.mkdirSync(dir, { recursive: true });
      const buffer = Buffer.from(res.data.data, 'base64');
      fs.writeFileSync(input.localPath, buffer);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              message: `Attachment saved to ${input.localPath}`,
              size: buffer.length,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  modify = async (input: {
    messageId: string;
    addLabelIds?: string[];
    removeLabelIds?: string[];
  }) => {
    logToFile(`gmail.modify: ${input.messageId}`);
    try {
      const gmail = await this.getGmail();
      const res = await gmail.users.messages.modify({
        userId: 'me',
        id: input.messageId,
        requestBody: {
          addLabelIds: input.addLabelIds,
          removeLabelIds: input.removeLabelIds,
        },
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              id: res.data.id,
              labelIds: res.data.labelIds,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  batchModify = async (input: {
    messageIds: string[];
    addLabelIds?: string[];
    removeLabelIds?: string[];
  }) => {
    logToFile(`gmail.batchModify: ${input.messageIds.length} messages`);
    try {
      const gmail = await this.getGmail();
      await gmail.users.messages.batchModify({
        userId: 'me',
        requestBody: {
          ids: input.messageIds,
          addLabelIds: input.addLabelIds,
          removeLabelIds: input.removeLabelIds,
        },
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              message: `Modified ${input.messageIds.length} messages`,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  modifyThread = async (input: {
    threadId: string;
    addLabelIds?: string[];
    removeLabelIds?: string[];
  }) => {
    logToFile(`gmail.modifyThread: ${input.threadId}`);
    try {
      const gmail = await this.getGmail();
      const res = await gmail.users.threads.modify({
        userId: 'me',
        id: input.threadId,
        requestBody: {
          addLabelIds: input.addLabelIds,
          removeLabelIds: input.removeLabelIds,
        },
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ id: res.data.id }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  send = async (input: {
    to: string | string[];
    subject: string;
    body: string;
    cc?: string | string[];
    bcc?: string | string[];
    isHtml?: boolean;
  }) => {
    logToFile(`gmail.send: to=${input.to}`);
    try {
      const gmail = await this.getGmail();
      const raw = this.buildRawEmail(input);
      const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              id: res.data.id,
              threadId: res.data.threadId,
              message: 'Email sent successfully',
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  createDraft = async (input: {
    to: string | string[];
    subject: string;
    body: string;
    cc?: string | string[];
    bcc?: string | string[];
    isHtml?: boolean;
    threadId?: string;
  }) => {
    logToFile(`gmail.createDraft: to=${input.to}`);
    try {
      const gmail = await this.getGmail();
      const raw = this.buildRawEmail(input);
      const res = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: { raw, threadId: input.threadId },
        },
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              draftId: res.data.id,
              messageId: res.data.message?.id,
              message: 'Draft created successfully',
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  sendDraft = async (input: { draftId: string }) => {
    logToFile(`gmail.sendDraft: ${input.draftId}`);
    try {
      const gmail = await this.getGmail();
      const res = await gmail.users.drafts.send({
        userId: 'me',
        requestBody: { id: input.draftId },
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              id: res.data.id,
              threadId: res.data.threadId,
              message: 'Draft sent successfully',
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  listLabels = async () => {
    logToFile('gmail.listLabels');
    try {
      const gmail = await this.getGmail();
      const res = await gmail.users.labels.list({ userId: 'me' });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(res.data.labels || []),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  createLabel = async (input: {
    name: string;
    labelListVisibility?: string;
    messageListVisibility?: string;
  }) => {
    logToFile(`gmail.createLabel: ${input.name}`);
    try {
      const gmail = await this.getGmail();
      const res = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: input.name,
          labelListVisibility:
            input.labelListVisibility || 'labelShow',
          messageListVisibility: input.messageListVisibility || 'show',
        },
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

  private buildRawEmail(input: {
    to: string | string[];
    subject: string;
    body: string;
    cc?: string | string[];
    bcc?: string | string[];
    isHtml?: boolean;
  }): string {
    const to = Array.isArray(input.to) ? input.to.join(', ') : input.to;
    const contentType = input.isHtml
      ? 'text/html; charset=utf-8'
      : 'text/plain; charset=utf-8';

    let email = `To: ${to}\r\n`;
    if (input.cc) {
      const cc = Array.isArray(input.cc) ? input.cc.join(', ') : input.cc;
      email += `Cc: ${cc}\r\n`;
    }
    if (input.bcc) {
      const bcc = Array.isArray(input.bcc) ? input.bcc.join(', ') : input.bcc;
      email += `Bcc: ${bcc}\r\n`;
    }
    email += `Subject: ${input.subject}\r\n`;
    email += `Content-Type: ${contentType}\r\n`;
    email += `\r\n${input.body}`;

    return Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  private errorResponse(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logToFile(`Gmail error: ${msg}`);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
    };
  }
}
