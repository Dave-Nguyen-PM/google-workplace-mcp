import { google } from 'googleapis';
import { logToFile } from '../utils/logger.js';
import type { AuthManager } from '../auth/AuthManager.js';

export class ChatService {
  constructor(private authManager: AuthManager) {}

  private async getChat() {
    const auth = await this.authManager.getAuthenticatedClient();
    return google.chat({ version: 'v1', auth });
  }

  listSpaces = async () => {
    logToFile('chat.listSpaces');
    try {
      const chat = await this.getChat();
      const res = await chat.spaces.list();
      const spaces = (res.data.spaces || []).map((s) => ({
        name: s.name,
        displayName: s.displayName,
        type: s.type,
        spaceType: s.spaceType,
      }));
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(spaces) },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  findSpaceByName = async (input: { displayName: string }) => {
    logToFile(`chat.findSpaceByName: ${input.displayName}`);
    try {
      const chat = await this.getChat();
      const res = await chat.spaces.list();
      const found = (res.data.spaces || []).filter(
        (s) =>
          s.displayName
            ?.toLowerCase()
            .includes(input.displayName.toLowerCase()),
      );
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(found) },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  sendMessage = async (input: {
    spaceName: string;
    message: string;
    threadName?: string;
  }) => {
    logToFile(`chat.sendMessage: ${input.spaceName}`);
    try {
      const chat = await this.getChat();
      const res = await chat.spaces.messages.create({
        parent: input.spaceName,
        requestBody: {
          text: input.message,
          thread: input.threadName
            ? { name: input.threadName }
            : undefined,
        },
        messageReplyOption: input.threadName
          ? 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD'
          : undefined,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              name: res.data.name,
              text: res.data.text,
              createTime: res.data.createTime,
              thread: res.data.thread,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  getMessages = async (input: {
    spaceName: string;
    threadName?: string;
    pageSize?: number;
    pageToken?: string;
    orderBy?: string;
  }) => {
    logToFile(`chat.getMessages: ${input.spaceName}`);
    try {
      const chat = await this.getChat();

      let filter = '';
      if (input.threadName) {
        filter = `thread.name = "${input.threadName}"`;
      }

      const res = await chat.spaces.messages.list({
        parent: input.spaceName,
        pageSize: input.pageSize || 25,
        pageToken: input.pageToken,
        orderBy: input.orderBy,
        filter: filter || undefined,
      });

      const messages = (res.data.messages || []).map((m) => ({
        name: m.name,
        sender: m.sender?.name,
        text: m.text,
        createTime: m.createTime,
        thread: m.thread?.name,
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              messages,
              nextPageToken: res.data.nextPageToken,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  sendDm = async (input: {
    email: string;
    message: string;
    threadName?: string;
  }) => {
    logToFile(`chat.sendDm: ${input.email}`);
    try {
      const dmSpace = await this.findOrCreateDm(input.email);
      if (!dmSpace) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Could not find or create DM with ${input.email}`,
              }),
            },
          ],
        };
      }
      return this.sendMessage({
        spaceName: dmSpace,
        message: input.message,
        threadName: input.threadName,
      });
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  findDmByEmail = async (input: { email: string }) => {
    logToFile(`chat.findDmByEmail: ${input.email}`);
    try {
      const chat = await this.getChat();
      const res = await chat.spaces.list({
        filter: `spaceType = "DIRECT_MESSAGE"`,
      });

      for (const space of res.data.spaces || []) {
        if (!space.name) continue;
        const members = await chat.spaces.members.list({
          parent: space.name,
        });
        const found = members.data.memberships?.some(
          (m) =>
            m.member?.name &&
            m.member.name.includes(input.email),
        );
        if (found) {
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify(space) },
            ],
          };
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: `No DM space found with ${input.email}`,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  listThreads = async (input: {
    spaceName: string;
    pageSize?: number;
    pageToken?: string;
  }) => {
    logToFile(`chat.listThreads: ${input.spaceName}`);
    try {
      const chat = await this.getChat();
      const res = await chat.spaces.messages.list({
        parent: input.spaceName,
        pageSize: input.pageSize || 25,
        pageToken: input.pageToken,
        orderBy: 'createTime desc',
      });

      const threadMap = new Map<
        string,
        { threadName: string; lastMessage: string; createTime: string }
      >();

      for (const msg of res.data.messages || []) {
        const threadName = msg.thread?.name;
        if (threadName && !threadMap.has(threadName)) {
          threadMap.set(threadName, {
            threadName,
            lastMessage: msg.text || '',
            createTime: msg.createTime || '',
          });
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              threads: Array.from(threadMap.values()),
              nextPageToken: res.data.nextPageToken,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  setUpSpace = async (input: {
    displayName: string;
    userNames: string[];
  }) => {
    logToFile(`chat.setUpSpace: ${input.displayName}`);
    try {
      const chat = await this.getChat();
      const res = await chat.spaces.setup({
        requestBody: {
          space: {
            displayName: input.displayName,
            spaceType: 'SPACE',
          },
          memberships: input.userNames.map((name) => ({
            member: { name, type: 'HUMAN' },
          })),
        },
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              name: res.data.name,
              displayName: res.data.displayName,
              type: res.data.type,
            }),
          },
        ],
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  };

  private async findOrCreateDm(email: string): Promise<string | null> {
    const chat = await this.getChat();
    try {
      const res = await chat.spaces.list({
        filter: `spaceType = "DIRECT_MESSAGE"`,
      });
      for (const space of res.data.spaces || []) {
        if (!space.name) continue;
        try {
          const members = await chat.spaces.members.list({
            parent: space.name,
          });
          const found = members.data.memberships?.some(
            (m) => m.member?.name?.includes(email),
          );
          if (found) return space.name;
        } catch {
          continue;
        }
      }
    } catch {
      // Fall through to setup
    }

    try {
      const res = await chat.spaces.setup({
        requestBody: {
          space: { spaceType: 'DIRECT_MESSAGE' },
          memberships: [{ member: { name: `users/${email}`, type: 'HUMAN' } }],
        },
      });
      return res.data.name || null;
    } catch {
      return null;
    }
  }

  private errorResponse(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logToFile(`Chat error: ${msg}`);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
    };
  }
}
