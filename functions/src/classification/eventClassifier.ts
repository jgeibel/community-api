import { OpenAIChatClassifier } from './llm';
import { ClassificationCandidate, ClassificationResult, EmbeddingProvider, LlmClassifier } from './types';
import { OpenAIEmbeddingProvider } from './embeddings';
import { slugify, shouldKeepGeneratedSlug } from '../tags/proposalService';

export interface EventClassifierOptions {
  llm?: LlmClassifier | 'openai' | 'none';
  embeddings?: EmbeddingProvider | 'openai' | 'none';
}

export interface EventClassificationInput {
  title: string;
  description?: string;
  vector?: number[] | null;
}

export class EventTagClassifier {
  private readonly llm: LlmClassifier | null;
  private readonly embeddingProvider: EmbeddingProvider | null;

  constructor(options?: EventClassifierOptions) {
    if (options?.llm === 'none') {
      this.llm = null;
    } else if (options?.llm === 'openai') {
      this.llm = createOpenAiLlm();
    } else if (options?.llm && 'classifyEvent' in options.llm) {
      this.llm = options.llm;
    } else {
      this.llm = tryCreateOpenAiLlm();
    }

    if (options?.embeddings === 'none') {
      this.embeddingProvider = null;
    } else if (options?.embeddings === 'openai') {
      this.embeddingProvider = createOpenAiEmbeddingProvider();
    } else if (options?.embeddings && 'embed' in options.embeddings) {
      this.embeddingProvider = options.embeddings;
    } else {
      this.embeddingProvider = tryCreateOpenAiEmbeddingProvider();
    }
  }

  async classify(input: EventClassificationInput): Promise<ClassificationResult> {
    const textBlob = [input.title, input.description].filter(Boolean).join('\n').trim();
    if (textBlob.length === 0) {
      return { tags: [], metadata: { embeddingsUsed: false, llmUsed: false } };
    }

    let queryVector: number[] | null = input.vector ?? null;

    if (this.embeddingProvider) {
      if (!queryVector) {
        queryVector = await this.embeddingProvider.embed(textBlob);
      }
    }

    const tagMap = new Map<string, ClassificationCandidate>();

    const llmCandidates = await this.runLlmClassification(input);
    for (const candidate of llmCandidates) {
      mergeCandidate(tagMap, candidate);
    }

    const tags = Array.from(tagMap.values())
      .sort((a, b) => b.confidence - a.confidence)
      .map(candidate => candidate.tag);

    return {
      tags,
      candidates: Array.from(tagMap.values()),
      metadata: {
        llmUsed: Boolean(this.llm),
        embeddingsUsed: Boolean(queryVector),
      },
      vector: queryVector,
    };
  }

  private async runLlmClassification(input: EventClassificationInput): Promise<ClassificationCandidate[]> {
    if (!this.llm) {
      return [];
    }

    try {
      const candidates = await this.llm.classifyEvent({
        title: input.title,
        description: input.description,
        maxSuggestions: 15,
      });

      const results: ClassificationCandidate[] = [];
      for (const candidate of candidates) {
        const label = candidate.tag.trim();
        const slug = slugify(label);
        if (!slug || !shouldKeepGeneratedSlug(slug)) {
          continue;
        }

        results.push({
          tag: slug,
          confidence: candidate.confidence,
          rationale: candidate.rationale ?? label,
          source: 'llm',
        });
      }

      return results;
    } catch (error) {
      console.error('LLM classification error', error);
      return [];
    }
  }
}

function mergeCandidate(map: Map<string, ClassificationCandidate>, candidate: ClassificationCandidate) {
  const existing = map.get(candidate.tag);
  if (!existing || candidate.confidence > existing.confidence) {
    map.set(candidate.tag, candidate);
  } else if (existing && candidate.confidence > 0) {
    existing.confidence = Math.min(1, (existing.confidence + candidate.confidence) / 2);
  }
}

function createOpenAiLlm(): LlmClassifier {
  return new OpenAIChatClassifier();
}

function tryCreateOpenAiLlm(): LlmClassifier | null {
  try {
    return new OpenAIChatClassifier();
  } catch (_) {
    return null;
  }
}

function createOpenAiEmbeddingProvider(): EmbeddingProvider {
  return new OpenAIEmbeddingProvider();
}

function tryCreateOpenAiEmbeddingProvider(): EmbeddingProvider | null {
  try {
    return new OpenAIEmbeddingProvider();
  } catch (_) {
    return null;
  }
}

