import { IGeminiParsedData, ICalculatedMaterials } from '../types';
import { logger } from '../utils/logger';

export function calculateMaterials(data: IGeminiParsedData): ICalculatedMaterials {
  try {
    logger.debug({ context: 'Calculator', message: 'Starting calculation', data });

    let dowels = 0;
    let screws = 0;
    let klopScrews = 0;
    let wagoTerminals = 0;
    let mountingAngles = 0;
    let platformsPlastic = 0;
    let platformsWood = 0;
    let hangers = 0;

    // Safe fallbacks in case Gemini returned null/undefined for nested objects
    const profileTypes = data.profileTypes ?? [];
    const lighting = data.lightingPoints ?? { roundSquareBuiltIn: 0, chandeliers: 0, pendantLights: 0 };
    const ventilation = data.ventilationGrilles ?? { count: 0, hasEngine: false };
    const trackLength = data.trackLength ?? 0;
    const ledStripLength = data.ledStripLength ?? 0;
    const totalEstimatePrice = data.totalEstimatePrice ?? 0;

    // 1. Profiles
    const calculatedProfiles = profileTypes.map((profile) => {
      const sticksCount = Math.ceil(profile.length / 2);
      dowels += sticksCount * 10;
      screws += sticksCount * 10;
      return { type: profile.type, sticksCount };
    });

    // 2. Tracks
    if (trackLength > 0) {
      const trackSticks = Math.ceil(trackLength / 2);
      mountingAngles += trackSticks * 5;
    }

    // 3. Lighting (Round/Square Built-in)
    if (lighting.roundSquareBuiltIn > 0) {
      const count = lighting.roundSquareBuiltIn;
      platformsPlastic += count * 1;
      hangers += count * 2;
      klopScrews += count * 6;
      dowels += count * 2;
      screws += count * 2;
      wagoTerminals += count * 2;
    }

    // 4. Chandeliers
    if (lighting.chandeliers > 0) {
      const count = lighting.chandeliers;
      platformsWood += count * 1;
      hangers += count * 4;
      klopScrews += count * 8;
      dowels += count * 4;
      screws += count * 4;
      wagoTerminals += count * 2;
    }

    // 5. Pendant Lights
    if (lighting.pendantLights > 0) {
      const count = lighting.pendantLights;
      platformsWood += count * 1;
      hangers += count * 4;
      klopScrews += count * 8;
      dowels += count * 4;
      screws += count * 4;
      wagoTerminals += count * 2;
    }

    // 6. Ventilation Grilles
    let engineCount = 0;
    if (ventilation.count > 0) {
      const count = ventilation.count;
      hangers += count * 4;
      klopScrews += count * 8;
      dowels += count * 4;
      screws += count * 4;

      if (ventilation.hasEngine) {
        engineCount = count;
      }
    }

    // 7. LED Strip
    if (ledStripLength > 0) {
      wagoTerminals += 2;
    }

    // 8. Finances
    const totalFund = totalEstimatePrice * 0.30;
    const perWorker = totalFund / 2;

    const result: ICalculatedMaterials = {
      profiles: calculatedProfiles,
      dowels,
      screws,
      klopScrews,
      wagoTerminals,
      mountingAngles,
      platformsPlastic,
      platformsWood,
      hangers,
      salaries: {
        totalFund,
        perWorker,
      },
      engineCount: engineCount > 0 ? engineCount : undefined,
    };

    logger.debug({ context: 'Calculator', message: 'Calculation finished successfully', result });
    return result;

  } catch (error) {
    logger.error({ context: 'Calculator', message: 'Failed to calculate materials', stack: error instanceof Error ? error.stack : undefined });
    throw error;
  }
}
