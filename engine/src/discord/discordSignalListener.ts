import { Client, GatewayIntentBits, Events, type Attachment } from "discord.js";
import { logger } from "../logger.js";

export interface DiscordImageSignal {
  channelMessageId: string;
  imageUrl: string;
  imageBuffer: Buffer;
  contentType: string;
  postedAt: number;
}

export interface DiscordSignalListenerOptions {
  botToken: string;
  channelId: string;
  onImage: (signal: DiscordImageSignal) => Promise<void>;
}

/**
 * Watches a single Discord channel for image attachments (chart screenshots
 * with entry/SL/TP annotations) and hands each one to onImage for vision
 * extraction. Text-only messages are ignored — we only act on images.
 */
export class DiscordSignalListener {
  private client: Client;

  constructor(private readonly opts: DiscordSignalListenerOptions) {
    this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
  }

  async connect(): Promise<void> {
    this.client.on(Events.MessageCreate, (message) => {
      if (message.channelId !== this.opts.channelId) return;
      if (message.author.bot) return;

      const imageAttachments = [...message.attachments.values()].filter((a: Attachment) =>
        (a.contentType ?? "").startsWith("image/")
      );

      for (const attachment of imageAttachments) {
        this.handleAttachment(message.id, attachment).catch((err) =>
          logger.error({ err, messageId: message.id }, "failed to process Discord signal image")
        );
      }
    });

    this.client.once(Events.ClientReady, (c) => {
      logger.info({ channelId: this.opts.channelId }, `Discord signal listener ready as ${c.user.tag}`);
    });

    await this.client.login(this.opts.botToken);
  }

  private async handleAttachment(messageId: string, attachment: Attachment): Promise<void> {
    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(`failed to download Discord attachment: HTTP ${response.status}`);
    }
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    await this.opts.onImage({
      channelMessageId: messageId,
      imageUrl: attachment.url,
      imageBuffer,
      contentType: attachment.contentType ?? "image/png",
      postedAt: Date.now()
    });
  }

  close(): void {
    this.client.destroy();
  }
}
