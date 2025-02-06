export enum AnalysisDepth {
  QUICK = 'QUICK',
  STANDARD = 'STANDARD',
  DEEP = 'DEEP',
}

export enum AnalysisConfidence {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export interface IAnalysisMetadata {
  fileCount: number;
  totalSize: number;
  languages: { [key: string]: number };
  dependencies: string[];
  hasTests: boolean;
  hasDocumentation: boolean;
  complexity: {
    files: number;
    functions: number;
    averageComplexity: number;
  };
}

export interface IPartialAnalysis {
  isComplete: boolean;
  processedFiles: number;
  totalFiles: number;
  currentResults: IAnalysisResult;
  remainingPaths: string[];
}

export interface IAnalysisResult {
  isLarp: boolean;
  confidence: AnalysisConfidence;
  explanation: string;
  metadata?: IAnalysisMetadata;
  indicators: {
    positive: string[];
    negative: string[];
    neutral: string[];
  };
  recommendations?: string[];
}

export interface IAnalysisOptions {
  depth: AnalysisDepth;
  timeout?: number;
  maxFileSize?: number;
  includeDependencies?: boolean;
  includeTests?: boolean;
  progressCallback?: (progress: number) => Promise<void>;
}

export interface IAIAnalysisService {
  analyzeCode(code: string, options?: IAnalysisOptions): Promise<IAnalysisResult>;
  analyzeMetadata(metadata: IAnalysisMetadata): Promise<Partial<IAnalysisResult>>;
  analyzeProgressively(
    chunks: AsyncIterator<string>,
    options?: IAnalysisOptions
  ): AsyncIterator<IPartialAnalysis>;
} 