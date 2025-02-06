import OpenAI from 'openai';
import { 
  IAIService,
  IAnalysisResult,
  AnalysisMethod
} from '../types/interfaces';
import logger from './logger';

export class AIService implements IAIService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async analyzeCode(code: string): Promise<IAnalysisResult> {
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
          {
            role: "system",
            content: "You are an expert AI engineer who can identify genuine AI implementations versus LARPs."
          },
          {
            role: "user",
            content: `Analyze the following code to determine if it's a LARP or genuine AI implementation.
            Consider:
            1. Code complexity and implementation details
            2. Actual AI/ML integration
            3. Error handling and edge cases
            4. Real functionality vs. superficial appearance
            
            Code to analyze:
            ${code}`
          }
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const analysis = response.choices[0].message.content || '';
      
      // Parse the analysis to create a structured result
      return {
        repositoryUrl: '', // This will be set by the caller
        analysisMethod: AnalysisMethod.QUICK,
        summary: analysis.slice(0, 500), // Take first 500 chars as summary
        confidence: this.calculateConfidence(analysis),
        isLarp: this.determineIsLarp(analysis),
        details: {
          codeQuality: this.calculateMetric(analysis, 'code quality'),
          commitHistory: 0, // Not available from code analysis
          documentation: this.calculateMetric(analysis, 'documentation'),
          testCoverage: this.calculateMetric(analysis, 'test coverage'),
          dependencies: this.calculateMetric(analysis, 'dependencies'),
        },
        metadata: {
          owner: '',
          name: '',
          description: '',
          stars: 0,
          forks: 0,
          issues: 0,
          lastCommit: new Date(),
          contributors: 0,
          languages: {},
          topics: [],
          url: '',
          size: 0
        },
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error('Error analyzing code:', error);
      throw new Error('Failed to analyze code');
    }
  }

  private calculateConfidence(analysis: string): number {
    // Simple confidence calculation based on the length and detail of the analysis
    const length = analysis.length;
    const hasDetails = analysis.includes('implementation') || analysis.includes('integration');
    const hasEvidence = analysis.includes('because') || analysis.includes('evidence');
    
    let confidence = 50; // Base confidence
    
    if (length > 500) confidence += 10;
    if (length > 1000) confidence += 10;
    if (hasDetails) confidence += 15;
    if (hasEvidence) confidence += 15;
    
    return Math.min(confidence, 100);
  }

  private determineIsLarp(analysis: string): boolean {
    const lowerAnalysis = analysis.toLowerCase();
    
    // Keywords that suggest LARP
    const larpIndicators = [
      'superficial',
      'fake',
      'pretend',
      'missing implementation',
      'no actual',
      'larp',
    ];

    // Keywords that suggest genuine implementation
    const genuineIndicators = [
      'proper implementation',
      'well integrated',
      'comprehensive',
      'thorough',
      'genuine',
    ];

    const larpScore = larpIndicators.filter(word => lowerAnalysis.includes(word)).length;
    const genuineScore = genuineIndicators.filter(word => lowerAnalysis.includes(word)).length;

    return larpScore > genuineScore;
  }

  private calculateMetric(analysis: string, aspect: string): number {
    const lowerAnalysis = analysis.toLowerCase();
    
    type MetricAspect = 'code quality' | 'documentation' | 'test coverage' | 'dependencies';
    type AspectIndicators = {
      positive: string[];
      negative: string[];
    };
    
    const indicators: Record<MetricAspect, AspectIndicators> = {
      'code quality': {
        positive: ['well structured', 'clean code', 'maintainable', 'organized'],
        negative: ['messy', 'poorly structured', 'unmaintainable', 'disorganized']
      },
      'documentation': {
        positive: ['well documented', 'clear comments', 'detailed docs'],
        negative: ['poorly documented', 'missing documentation', 'unclear']
      },
      'test coverage': {
        positive: ['well tested', 'comprehensive tests', 'test cases'],
        negative: ['untested', 'missing tests', 'no test']
      },
      'dependencies': {
        positive: ['appropriate dependencies', 'well managed', 'up to date'],
        negative: ['missing dependencies', 'outdated', 'unnecessary']
      }
    };

    const aspectIndicators = indicators[aspect as MetricAspect];
    if (!aspectIndicators) return 50; // Default score

    const positiveScore = aspectIndicators.positive.filter((word: string) => lowerAnalysis.includes(word)).length;
    const negativeScore = aspectIndicators.negative.filter((word: string) => lowerAnalysis.includes(word)).length;

    // Calculate score (0-100)
    if (positiveScore === 0 && negativeScore === 0) return 50;
    const total = positiveScore + negativeScore;
    return Math.round((positiveScore / total) * 100);
  }
} 