import { Client, GatewayIntentBits, Events, type Attachment, type Message } from "discord.js";
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

      const imageAttachments = this.collectImageAttachments(message);

      for (const [index, attachment] of imageAttachments.entries()) {
        // A message can carry more than one image (multiple attachments, or a
        // forwarded message combined with the forwarder's own attachment) —
        // suffix the id so each gets its own signal/image file instead of colliding.
        const channelMessageId = imageAttachments.length > 1 ? `${message.id}-${index}` : message.id;
        this.handleAttachment(channelMessageId, attachment).catch((err) =>
          logger.error({ err, messageId: message.id }, "failed to process Discord signal image")
        );
      }
    });

    this.client.once(Events.ClientReady, (c) => {
      logger.info({ channelId: this.opts.channelId }, `Discord signal listener ready as ${c.user.tag}`);
    });

    await this.client.login(this.opts.botToken);
  }

  /**
   * A manually-forwarded message (Discord's "Forward" action, as opposed to a
   * reply or a Follow-Channel crosspost) carries its image inside
   * message.messageSnapshots rather than message.attachments — the top-level
   * message is just the forward wrapper and is usually attachment-less. Check
   * both so screenshots relayed this way from a channel the bot can't join
   * (no invite permission, not an announcement channel) still get picked up.
   */
  private collectImageAttachments(message: Message): Attachment[] {
    const direct = [...message.attachments.values()];
    const forwarded = [...message.messageSnapshots.values()].flatMap((snapshot) => [...snapshot.attachments.values()]);
    return [...direct, ...forwarded].filter((a: Attachment) => (a.contentType ?? "").startsWith("image/"));
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
