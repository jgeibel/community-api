export interface ClassificationCandidate {
  tag: string;
  confidence: number;
  rationale?: string;
  source?: 'keyword' | 'llm' | 'embedding';
}

export interface ClassificationResult {
  tags: string[];
  candidates?: ClassificationCandidate[];
  metadata?: Record<string, unknown>;
  vector?: number[] | null;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedMany(texts: string[]): Promise<number[][]>;
}

export interface LlmClassifier {
  classifyEvent(input: LlmClassificationInput): Promise<ClassificationCandidate[]>;
}

export interface LlmClassificationInput {
  title: string;
  description?: string;
  examples?: string[];
  maxSuggestions?: number;
}
