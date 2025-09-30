import { ClassificationCandidate, LlmClassifier, LlmClassificationInput } from './types';

export class NoopLlmClassifier implements LlmClassifier {
  async classifyEvent(): Promise<ClassificationCandidate[]> {
    return [];
  }
}

export class OpenAIChatClassifier implements LlmClassifier {
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

  async classifyEvent(input: LlmClassificationInput): Promise<ClassificationCandidate[]> {
    const prompt = this.buildPrompt(input);
    const systemMessage = 'You are an expert at tagging community content with rich, diverse tags across multiple categories to enable behavioral recommendation systems.';
    const debugMode = process.env.ENABLE_CLASSIFICATION_DEBUG === 'true';

    if (debugMode) {
      console.log('[CLASSIFICATION_DEBUG] Starting classification', {
        title: input.title,
        descriptionLength: input.description?.length ?? 0,
      });
    }

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
      throw new Error(`LLM classification failed: ${response.status} ${err}`);
    }

    const json = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = json.choices[0]?.message.content;
    if (!content) {
      return [];
    }

    try {
      const parsed = JSON.parse(content) as {
        tags?: Array<{ label?: string; confidence?: number; rationale?: string }>;
      };

      const candidates = (parsed.tags ?? [])
        .filter(candidate => typeof candidate.label === 'string' && candidate.label.trim().length > 0)
        .map(candidate => ({
          tag: candidate.label!.trim(),
          confidence: clamp(candidate.confidence ?? 0.5, 0, 1),
          rationale: candidate.rationale,
        }));

      if (debugMode) {
        console.log('[CLASSIFICATION_DEBUG] Result', {
          title: input.title,
          description: input.description?.substring(0, 200),
          systemMessage,
          prompt,
          llmResponse: content,
          extractedTags: candidates.map(c => ({ tag: c.tag, confidence: c.confidence })),
        });
      }

      return candidates;
    } catch (error) {
      console.error('[CLASSIFICATION_ERROR] Failed to parse LLM response', {
        error,
        title: input.title,
        systemMessage,
        prompt,
        llmResponse: content,
      });
      return [];
    }
  }

  private buildPrompt(input: LlmClassificationInput): string {
    const description = input.description?.trim() || 'No description provided.';
    const max = input.maxSuggestions ?? 15;

    return [
      'You are tagging community content for a local social app. Generate 10-15 diverse INTEREST-BASED tags that users would search for or follow.',
      '',
      '**CRITICAL: Tags must be nouns or noun phrases representing interests, activities, or topics. DO NOT use:**',
      '- Random common words (because, ensure, first, after, during, etc.)',
      '- Verbs (join, learn, create, etc.)',
      '- Adjectives alone (recommended, special, great, etc.)',
      '- Generic filler words (event, community, local, etc.)',
      '- Proper nouns (business names, venue names, people names)',
      '',
      'Generate tags across these 5 categories (aim for 2-3 tags per category):',
      '',
      '1. **Specific Topics**: Concrete nouns/interests - what IS this?',
      '   ✓ GOOD: "bagels", "chess", "soccer", "pottery", "jazz", "yoga", "basketball"',
      '   ✗ BAD: "recommended", "because", "ensure", "first", "join"',
      '',
      '2. **Activity Types**: The format or type of activity',
      '   ✓ GOOD: "flash-deal", "tournament", "workshop", "meetup", "performance", "class"',
      '   ✗ BAD: "event", "activity", "opportunity"',
      '',
      '3. **Broader Categories**: High-level interest areas',
      '   ✓ GOOD: "food", "sports", "arts", "wellness", "education", "entertainment"',
      '   ✗ BAD: "community", "local", "public"',
      '',
      '4. **Audience Types**: Who would be interested?',
      '   ✓ GOOD: "families", "youth", "seniors", "foodies", "bargain-hunters", "beginners"',
      '   ✗ BAD: "people", "everyone", "individuals"',
      '',
      '5. **Vibe/Context**: Atmosphere descriptors (adjectives OK here)',
      '   ✓ GOOD: "competitive", "relaxing", "educational", "social", "family-friendly", "time-sensitive"',
      '   ✗ BAD: "recommended", "special", "great"',
      '',
      'Ask yourself: "Would a user follow this tag to see more content like this?"',
      'If the answer is no, it\'s not a good tag.',
      '',
      `Content Title: ${input.title}`,
      `Content Description: ${description}`,
      '',
      `Respond with JSON: {"tags": [{"label": "tag-text", "category": "specific"|"activity-type"|"broader"|"audience"|"vibe", "confidence": 0-1}]}`,
      `Provide between 10-${max} tags with good coverage across all 5 categories.`
    ].join('\n');
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
