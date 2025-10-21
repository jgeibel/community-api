import { createHash } from 'crypto';

interface ExistingCategoryInfo {
  id: string;
  name: string;
  description?: string | null;
  sampleSeriesTitles: string[];
}

export interface EventCategoryClassificationInput {
  hostName: string | null;
  seriesTitle: string;
  seriesDescription?: string | null;
  seriesTags: string[];
  existingCategories: ExistingCategoryInfo[];
}

export interface EventCategoryClassificationResult {
  categoryName: string;
  action: 'use-existing' | 'create-new';
  reason?: string;
}

interface OpenAIResponse {
  choices: Array<{ message: { content: string } }>;
}

export class EventCategoryClassifier {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options?: { apiKey?: string; model?: string }) {
    const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    this.apiKey = apiKey;
    this.model = options?.model ?? 'gpt-4o-mini';
  }

  async classify(input: EventCategoryClassificationInput): Promise<EventCategoryClassificationResult> {
    const systemMessage = 'You categorize community programming into user-friendly interest categories.';
    const prompt = this.buildPrompt(input);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Event category classification failed: ${response.status} ${err}`);
    }

    const json = (await response.json()) as OpenAIResponse;
    const content = json.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Event category classification returned empty response');
    }

    try {
      const parsed = JSON.parse(content) as {
        category?: {
          name?: string;
          action?: 'use-existing' | 'create-new';
          reason?: string;
        };
      };
      const name = parsed.category?.name?.trim();
      if (!name) {
        throw new Error('Missing category name in response');
      }
      const action = parsed.category?.action === 'use-existing' ? 'use-existing' : 'create-new';
      return {
        categoryName: name,
        action,
        reason: parsed.category?.reason,
      };
    } catch (error) {
      console.error('Failed to parse category classification response', {
        error,
        content,
      });
      throw new Error('Invalid JSON response from category classifier');
    }
  }

  private buildPrompt(input: EventCategoryClassificationInput): string {
    const { hostName, existingCategories, seriesTitle, seriesDescription, seriesTags } = input;
    const description = seriesDescription?.trim() || 'No description provided.';
    const formattedTags = seriesTags.length > 0 ? seriesTags.join(', ') : 'No tags yet.';

    const categoriesSection = existingCategories.length === 0
      ? 'No existing categories yet for this host.'
      : existingCategories
          .map((category, index) => {
            const samples = category.sampleSeriesTitles.slice(0, 5).join(', ') || 'No sample titles stored yet.';
            const descriptionLine = category.description ? `Description: ${category.description}` : 'Description: (none provided)';
            return [
              `${index + 1}. ${category.name}`,
              `   ${descriptionLine}`,
              `   Sample classes: ${samples}`,
            ].join('\n');
          })
          .join('\n');

    return [
      `Host: ${hostName ?? 'Unknown host'}`,
      '',
      'Existing categories for this host:',
      categoriesSection,
      '',
      'New or updated class details:',
      `Title: ${seriesTitle}`,
      `Description: ${description}`,
      `Tags: ${formattedTags}`,
      '',
      'Instructions:',
      '- If the class clearly matches one of the existing categories, reuse that category name exactly.',
      '- Otherwise, create a concise new category name (2-4 words) that a user would understand (e.g. "Dance Classes", "Youth Sports").',
      '- Categories should represent broad interest areas, not individual class names.',
      '- When the programming is instructional (lessons, workshops, ongoing classes), favor names that make that explicit (e.g. use "Dance Classes" instead of a broad performing arts label).',
      '- Prefer reusing categories to avoid duplicates unless there is a meaningful difference in subject matter or audience.',
      '',
      'Respond with JSON of the form:',
      '{',
      '  "category": {',
      '    "name": "Chosen or new category name",',
      '    "action": "use-existing" | "create-new",',
      '    "reason": "Brief explanation (optional)"',
      '  }',
      '}',
    ].join('\n');
  }
}

export function buildCategoryId(hostId: string, name: string): string {
  const normalized = name.trim().toLowerCase();
  const hash = createHash('sha1').update(`${hostId}:${normalized}`).digest('hex').slice(0, 12);
  return `category:${hash}`;
}
