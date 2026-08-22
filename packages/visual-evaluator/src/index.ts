export interface VisualEvidence {
  referenceImage: string;
  actualImage: string;
  viewport: { width: number; height: number };
}

export interface VisualEvaluation {
  passed: boolean;
  pixelDifferenceRatio: number;
  regions: Array<{ x: number; y: number; width: number; height: number; reason?: string }>;
}

export interface VisualEvaluator {
  evaluate(evidence: VisualEvidence): Promise<VisualEvaluation>;
}
