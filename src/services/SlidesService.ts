import { google, slides_v1 } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import { logToFile } from '../utils/logger.js';
import type { AuthManager } from '../auth/AuthManager.js';

function extractPresentationId(input: string): string {
  if (input.startsWith('http')) {
    const match = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : input;
  }
  return input;
}

export class SlidesService {
  constructor(private authManager: AuthManager) {}

  private async getSlides() {
    const auth = await this.authManager.getAuthenticatedClient();
    return google.slides({ version: 'v1', auth });
  }

  private async getDrive() {
    const auth = await this.authManager.getAuthenticatedClient();
    return google.drive({ version: 'v3', auth });
  }

  getText = async (input: { presentationId: string }) => {
    const presentationId = extractPresentationId(input.presentationId);
    logToFile(`slides.getText: ${presentationId}`);
    try {
      const slides = await this.getSlides();
      const res = await slides.presentations.get({ presentationId });

      const slideTexts = (res.data.slides || []).map((slide, idx) => {
        const texts: string[] = [];
        for (const element of slide.pageElements || []) {
          const text = this.extractTextFromElement(element);
          if (text) texts.push(text);
        }
        return {
          slideIndex: idx,
          objectId: slide.objectId,
          text: texts.join('\n'),
        };
      });

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(slideTexts) },
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
    logToFile(`slides.find: ${input.query}`);
    try {
      const drive = await this.getDrive();
      const escapedQuery = input.query.replace(/'/g, "\\'");
      const res = await drive.files.list({
        q: `mimeType = 'application/vnd.google-apps.presentation' and name contains '${escapedQuery}' and trashed = false`,
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

  getMetadata = async (input: { presentationId: string }) => {
    const presentationId = extractPresentationId(input.presentationId);
    logToFile(`slides.getMetadata: ${presentationId}`);
    try {
      const slides = await this.getSlides();
      const res = await slides.presentations.get({ presentationId });
      const meta = {
        presentationId: res.data.presentationId,
        title: res.data.title,
        slideCount: res.data.slides?.length || 0,
        slides: res.data.slides?.map((s, idx) => ({
          index: idx,
          objectId: s.objectId,
          elementCount: s.pageElements?.length || 0,
        })),
        pageSize: res.data.pageSize,
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

  getImages = async (input: {
    presentationId: string;
    localPath: string;
  }) => {
    const presentationId = extractPresentationId(input.presentationId);
    logToFile(`slides.getImages: ${presentationId} -> ${input.localPath}`);
    try {
      const slides = await this.getSlides();
      const res = await slides.presentations.get({ presentationId });
      fs.mkdirSync(input.localPath, { recursive: true });

      const downloaded: string[] = [];

      for (const slide of res.data.slides || []) {
        for (const element of slide.pageElements || []) {
          const imageUrl =
            element.image?.contentUrl ||
            element.image?.sourceUrl;
          if (imageUrl && element.objectId) {
            const ext = imageUrl.includes('.png') ? '.png' : '.jpg';
            const filePath = path.join(
              input.localPath,
              `${element.objectId}${ext}`,
            );
            try {
              const response = await fetch(imageUrl);
              const buffer = Buffer.from(await response.arrayBuffer());
              fs.writeFileSync(filePath, buffer);
              downloaded.push(filePath);
            } catch {
              logToFile(`Failed to download image: ${imageUrl}`);
            }
          }
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              message: `Downloaded ${downloaded.length} images`,
              files: downloaded,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  getSlideThumbnail = async (input: {
    presentationId: string;
    slideObjectId: string;
    localPath: string;
  }) => {
    const presentationId = extractPresentationId(input.presentationId);
    logToFile(`slides.getSlideThumbnail: ${presentationId}/${input.slideObjectId}`);
    try {
      const slides = await this.getSlides();
      const res = await slides.presentations.pages.getThumbnail({
        presentationId,
        pageObjectId: input.slideObjectId,
      });

      const url = res.data.contentUrl;
      if (!url) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'No thumbnail URL returned' }),
            },
          ],
        };
      }

      const dir = path.dirname(input.localPath);
      fs.mkdirSync(dir, { recursive: true });

      const response = await fetch(url);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(input.localPath, buffer);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              message: `Thumbnail saved to ${input.localPath}`,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  private extractTextFromElement(
    element: slides_v1.Schema$PageElement,
  ): string {
    if (!element.shape?.text?.textElements) return '';
    return element.shape.text.textElements
      .map((te) => te.textRun?.content || '')
      .join('');
  }

  private errorResponse(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logToFile(`Slides error: ${msg}`);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
    };
  }
}
