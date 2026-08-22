export interface EvaluationCase {
  id: string;
  designFixture: string;
  targetProject: string;
  expectedComponents: string[];
}

export interface EvaluationResult {
  caseId: string;
  completed: boolean;
  metrics: Record<string, number>;
  artifactPaths: string[];
}
