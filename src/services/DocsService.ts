import { google, docs_v1 } from 'googleapis';
import { logToFile } from '../utils/logger.js';
import type { AuthManager } from '../auth/AuthManager.js';

function extractDocId(input: string): string {
  if (input.startsWith('http')) {
    const match = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : input;
  }
  return input;
}

export class DocsService {
  constructor(private authManager: AuthManager) {}

  private async getDocs() {
    const auth = await this.authManager.getAuthenticatedClient();
    return google.docs({ version: 'v1', auth });
  }

  create = async (input: { title: string; content?: string }) => {
    logToFile(`docs.create: ${input.title}`);
    try {
      const docs = await this.getDocs();
      const res = await docs.documents.create({
        requestBody: { title: input.title },
      });

      if (input.content && res.data.documentId) {
        await docs.documents.batchUpdate({
          documentId: res.data.documentId,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: { index: 1 },
                  text: input.content,
                },
              },
            ],
          },
        });
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              documentId: res.data.documentId,
              title: res.data.title,
              url: `https://docs.google.com/document/d/${res.data.documentId}/edit`,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  getText = async (input: { documentId: string; tabId?: string }) => {
    const documentId = extractDocId(input.documentId);
    logToFile(`docs.getText: ${documentId}`);
    try {
      const docs = await this.getDocs();
      const res = await docs.documents.get({
        documentId,
        includeTabsContent: true,
      });

      const tabs = res.data.tabs || [];
      const results: { tabId: string; title: string; text: string }[] = [];

      for (const tab of tabs) {
        if (input.tabId && tab.tabProperties?.tabId !== input.tabId) continue;
        const body = tab.documentTab?.body;
        if (!body) continue;

        const text = this.extractTextFromBody(body);
        results.push({
          tabId: tab.tabProperties?.tabId || '',
          title: tab.tabProperties?.title || '',
          text,
        });
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

  writeText = async (input: {
    documentId: string;
    text: string;
    position?: string;
    tabId?: string;
  }) => {
    const documentId = extractDocId(input.documentId);
    logToFile(`docs.writeText: ${documentId}`);
    try {
      const docs = await this.getDocs();

      let index: number;
      if (input.position === 'beginning') {
        index = 1;
      } else if (!input.position || input.position === 'end') {
        const doc = await docs.documents.get({ documentId });
        const body = doc.data.body;
        index = body?.content
          ? body.content[body.content.length - 1]?.endIndex
            ? body.content[body.content.length - 1].endIndex! - 1
            : 1
          : 1;
      } else {
        index = parseInt(input.position, 10) || 1;
      }

      const requests: docs_v1.Schema$Request[] = [
        { insertText: { location: { index, tabId: input.tabId }, text: input.text } },
      ];

      await docs.documents.batchUpdate({
        documentId,
        requestBody: { requests },
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              message: `Text written to document at position ${index}`,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  replaceText = async (input: {
    documentId: string;
    findText: string;
    replaceText: string;
    tabId?: string;
  }) => {
    const documentId = extractDocId(input.documentId);
    logToFile(`docs.replaceText: ${documentId}`);
    try {
      const docs = await this.getDocs();
      const requests: docs_v1.Schema$Request[] = [
        {
          replaceAllText: {
            containsText: { text: input.findText, matchCase: true },
            replaceText: input.replaceText,
            tabsCriteria: input.tabId
              ? { tabIds: [input.tabId] }
              : undefined,
          },
        },
      ];

      const res = await docs.documents.batchUpdate({
        documentId,
        requestBody: { requests },
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

  formatText = async (input: {
    documentId: string;
    formats: Array<{
      startIndex: number;
      endIndex: number;
      style: string;
      url?: string;
    }>;
    tabId?: string;
  }) => {
    const documentId = extractDocId(input.documentId);
    logToFile(`docs.formatText: ${documentId}`);
    try {
      const docs = await this.getDocs();
      const requests: docs_v1.Schema$Request[] = [];

      for (const fmt of input.formats) {
        const range: docs_v1.Schema$Range = {
          startIndex: fmt.startIndex,
          endIndex: fmt.endIndex,
          tabId: input.tabId,
        };

        const headingStyles: Record<string, string> = {
          heading1: 'HEADING_1',
          heading2: 'HEADING_2',
          heading3: 'HEADING_3',
          heading4: 'HEADING_4',
          heading5: 'HEADING_5',
          heading6: 'HEADING_6',
          normalText: 'NORMAL_TEXT',
        };

        if (headingStyles[fmt.style]) {
          requests.push({
            updateParagraphStyle: {
              range,
              paragraphStyle: {
                namedStyleType: headingStyles[fmt.style],
              },
              fields: 'namedStyleType',
            },
          });
        } else {
          const textStyle: docs_v1.Schema$TextStyle = {};
          let fields = '';

          switch (fmt.style) {
            case 'bold':
              textStyle.bold = true;
              fields = 'bold';
              break;
            case 'italic':
              textStyle.italic = true;
              fields = 'italic';
              break;
            case 'underline':
              textStyle.underline = true;
              fields = 'underline';
              break;
            case 'strikethrough':
              textStyle.strikethrough = true;
              fields = 'strikethrough';
              break;
            case 'code':
              textStyle.weightedFontFamily = { fontFamily: 'Courier New' };
              fields = 'weightedFontFamily';
              break;
            case 'link':
              textStyle.link = { url: fmt.url };
              fields = 'link';
              break;
          }

          if (fields) {
            requests.push({
              updateTextStyle: { range, textStyle, fields },
            });
          }
        }
      }

      if (requests.length > 0) {
        await docs.documents.batchUpdate({
          documentId,
          requestBody: { requests },
        });
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              message: `Applied ${requests.length} formatting operations`,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  getSuggestions = async (input: { documentId: string }) => {
    const documentId = extractDocId(input.documentId);
    logToFile(`docs.getSuggestions: ${documentId}`);
    try {
      const docs = await this.getDocs();
      const res = await docs.documents.get({
        documentId,
        suggestionsViewMode: 'SUGGESTIONS_INLINE',
      });

      const suggestions: Array<{
        suggestionId: string;
        type: string;
        content?: string;
      }> = [];
      const body = res.data.body;
      if (body?.content) {
        for (const element of body.content) {
          if (element.paragraph?.elements) {
            for (const el of element.paragraph.elements) {
              if (el.textRun?.suggestedInsertionIds) {
                suggestions.push({
                  suggestionId: el.textRun.suggestedInsertionIds[0],
                  type: 'insertion',
                  content: el.textRun.content,
                });
              }
              if (el.textRun?.suggestedDeletionIds) {
                suggestions.push({
                  suggestionId: el.textRun.suggestedDeletionIds[0],
                  type: 'deletion',
                  content: el.textRun.content,
                });
              }
            }
          }
        }
      }

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(suggestions) },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  private extractTextFromBody(body: docs_v1.Schema$Body): string {
    let text = '';
    if (!body.content) return text;
    for (const element of body.content) {
      if (element.paragraph?.elements) {
        for (const el of element.paragraph.elements) {
          if (el.textRun?.content) {
            text += el.textRun.content;
          }
        }
      } else if (element.table) {
        for (const row of element.table.tableRows || []) {
          for (const cell of row.tableCells || []) {
            if (cell.content) {
              for (const cellElement of cell.content) {
                if (cellElement.paragraph?.elements) {
                  for (const el of cellElement.paragraph.elements) {
                    if (el.textRun?.content) text += el.textRun.content;
                  }
                }
              }
            }
          }
        }
      }
    }
    return text;
  }

  private errorResponse(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logToFile(`Docs error: ${msg}`);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
    };
  }
}
