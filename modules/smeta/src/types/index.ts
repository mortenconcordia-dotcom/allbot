export interface IGeminiParsedData {
  projectName: string;
  totalEstimatePrice: number;
  totalPerimeter: number;
  profileTypes: Array<{ type: string; length: number }>;
  trackLength: number;
  lightingPoints: {
    roundSquareBuiltIn: number;
    chandeliers: number;
    pendantLights: number;
  };
  ventilationGrilles: {
    count: number;
    hasEngine: boolean;
  };
  ledStripLength: number;
}

export interface ICalculatedMaterials {
  profiles: { type: string; sticksCount: number }[];
  dowels: number;
  screws: number;
  klopScrews: number;
  wagoTerminals: number;
  mountingAngles: number;
  platformsPlastic: number;
  platformsWood: number;
  hangers: number;
  salaries: { totalFund: number; perWorker: number };
  engineCount?: number;
}
