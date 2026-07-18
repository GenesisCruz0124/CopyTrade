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
  "symbol": string | null,       // trading pair in the form "BTC_USDT" (base_quote, uppercase). Null if you cannot read it clearly.
  "side": "long" | "short" | null,
  "leverage": number | null,     // as a plain multiplier, e.g. 10 for "10x". Null if not shown.
  "entryPrice": number | null,
  "stopLoss": number | null,
  "takeProfit": number | null,   // if multiple TP levels are shown, use the first/nearest one
  "confidence": number,          // 0.0-1.0: how confident you are this extraction is correct and complete
  "notes": string                // brief note on anything ambiguous, multiple TPs, or why confidence is low
}

Rules for "symbol":
- Transcribe the ticker EXACTLY as it appears. Do NOT guess, autocorrect, or substitute a real coin that merely looks similar to what you see (e.g. do not turn an unclear "CROUS" into "CRO" or "CROSS").
- Only report a symbol you can read with high confidence. If the ticker is blurry, partially cut off, low-resolution, or you are not sure you read every character correctly, set "symbol" to null, lower "confidence" to 0.3 or below, and say in "notes" what you saw and why you're unsure.
- Include only the base asset ticker plus its quote (usually USDT); do not invent a quote if none is shown.

If the image is not a trading signal at all, set all trade fields to null, confidence to 0, and explain in notes.`;

const TEXT_EXTRACTION_PROMPT = `You are reading a trading signal posted as a plain-text Discord message (e.g. "Market short zec sl 559.35" or "MARKET SHORT $MET"). Extract the trade the poster is calling.

Respond with ONLY a JSON object, no prose, matching exactly this shape:
{
  "symbol": string | null,       // trading pair in the form "BTC_USDT" (base_quote, uppercase). Null if the ticker isn't clearly stated.
  "side": "long" | "short" | null,
  "leverage": number | null,     // as a plain multiplier, e.g. 10 for "10x". Null if not mentioned.
  "entryPrice": number | null,   // null for a "market" call with no explicit entry level
  "stopLoss": number | null,
  "takeProfit": number | null,   // if multiple TP levels are given, use the first/nearest one
  "confidence": number,          // 0.0-1.0: how confident you are this extraction is correct and complete
  "notes": string                // brief note on anything ambiguous or why confidence is low
}

Rules for "symbol":
- Use the ticker EXACTLY as written in the message (uppercased, with the "$" prefix removed). Do NOT autocorrect it to a different coin that looks or sounds similar, and do NOT invent a ticker that isn't in the message.
- If no ticker is clearly present, or the "coin" looks like an ordinary word rather than a ticker, set "symbol" to null, lower "confidence" to 0.3 or below, and explain in "notes".
- Append "_USDT" as the quote only when the message doesn't specify one.

If the message is not actually a trading signal, set all trade fields to null, confidence to 0, and explain in notes.`;

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
    return this.parseExtractionResponse(raw);
  }

  async extractFromText(text: string): Promise<ExtractedSignal> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      messages: [{ role: "user", content: `${TEXT_EXTRACTION_PROMPT}\n\nMessage:\n${text}` }]
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    return this.parseExtractionResponse(raw);
  }

  private parseExtractionResponse(raw: string): ExtractedSignal {
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
