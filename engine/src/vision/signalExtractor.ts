import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../logger.js";

export interface ExtractedSignal {
  symbol: string | null; // normalized to MEXC futures format, e.g. "BTC_USDT"
  side: "long" | "short" | null;
  leverage: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  confidence: number; // 0-1, model's own confidence in the extraction
  notes: string;
}

const EXTRACTION_PROMPT = `You are reading a trading signal screenshot (likely a TradingView chart with entry/stop-loss/take-profit annotations, or a text-based signal card). Extract the trade the poster is calling.

Respond with ONLY a JSON object, no prose, matching exactly this shape:
{
  "symbol": string | null,       // trading pair in the form "BTC_USDT" (base_quote, uppercase). Null if unreadable.
  "side": "long" | "short" | null,
  "leverage": number | null,     // as a plain multiplier, e.g. 10 for "10x". Null if not shown.
  "entryPrice": number | null,
  "stopLoss": number | null,
  "takeProfit": number | null,   // if multiple TP levels are shown, use the first/nearest one
  "confidence": number,          // 0.0-1.0: how confident you are this extraction is correct and complete
  "notes": string                // brief note on anything ambiguous, multiple TPs, or why confidence is low
}

If the image is not a trading signal at all, set all trade fields to null, confidence to 0, and explain in notes.`;

export interface SignalExtractorOptions {
  apiKey: string;
  model?: string;
}

export class SignalExtractor {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: SignalExtractorOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? "claude-sonnet-4-5";
  }

  async extract(imageBuffer: Buffer, contentType: string): Promise<ExtractedSignal> {
    const base64 = imageBuffer.toString("base64");
    const mediaType = this.normalizeMediaType(contentType);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: EXTRACTION_PROMPT }
          ]
        }
      ]
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";

    try {
      const parsed = this.parseJson(raw);
      return {
        symbol: parsed.symbol ?? null,
        side: parsed.side === "long" || parsed.side === "short" ? parsed.side : null,
        leverage: typeof parsed.leverage === "number" ? parsed.leverage : null,
        entryPrice: typeof parsed.entryPrice === "number" ? parsed.entryPrice : null,
        stopLoss: typeof parsed.stopLoss === "number" ? parsed.stopLoss : null,
        takeProfit: typeof parsed.takeProfit === "number" ? parsed.takeProfit : null,
        confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
        notes: typeof parsed.notes === "string" ? parsed.notes : ""
      };
    } catch (err) {
      logger.warn({ err, raw }, "failed to parse vision extraction response");
      return {
        symbol: null,
        side: null,
        leverage: null,
        entryPrice: null,
        stopLoss: null,
        takeProfit: null,
        confidence: 0,
        notes: "Failed to parse model response; manual review required."
      };
    }
  }

  private parseJson(raw: string): any {
    const trimmed = raw.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("no JSON object found in response");
    return JSON.parse(jsonMatch[0]);
  }

  private normalizeMediaType(contentType: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
    if (contentType.includes("jpeg") || contentType.includes("jpg")) return "image/jpeg";
    if (contentType.includes("gif")) return "image/gif";
    if (contentType.includes("webp")) return "image/webp";
    return "image/png";
  }
}
