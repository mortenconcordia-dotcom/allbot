import test from 'node:test';
import assert from 'node:assert';
import { calculateMaterials } from './calculator';
import { IGeminiParsedData } from '../types';

test('calculateMaterials accurately calculates profiles and structural hardware', () => {
  const mockData: IGeminiParsedData = {
    projectName: 'Test Project',
    totalEstimatePrice: 100000,
    totalPerimeter: 20, // Not directly used in hardware calculation, only for info, profileTypes is used.
    profileTypes: [
      { type: 'Стеновой', length: 15 },
      { type: 'Теневой', length: 5 },
    ],
    trackLength: 4,
    lightingPoints: {
      roundSquareBuiltIn: 10,
      chandeliers: 1,
      pendantLights: 2,
    },
    ventilationGrilles: { count: 1, hasEngine: true },
    ledStripLength: 10,
  };

  const result = calculateMaterials(mockData);

  // Profiles (length):
  // 15m / 2 = 7.5 -> 8 sticks
  // 5m / 2 = 2.5 -> 3 sticks
  assert.strictEqual(result.profiles[0].sticksCount, 8, 'Стеновой профиль 8 палок');
  assert.strictEqual(result.profiles[1].sticksCount, 3, 'Теневой профиль 3 палки');
  
  // Total sticks = 11.
  // Profile dowels & screws = 11 * 10 = 110.
  
  // Tracks
  // 4m / 2 = 2 sticks.
  // track angles = 2 * 5 = 10.
  assert.strictEqual(result.mountingAngles, 10, 'Монтажные углы трека = 10');

  // Lighting built-in (10):
  // dowels = 10 * 2 = 20
  // screws = 10 * 2 = 20
  // klopScrews = 10 * 6 = 60
  // platformsPlastic = 10
  // hangers = 10 * 2 = 20
  // wago = 10 * 2 = 20
  assert.strictEqual(result.platformsPlastic, 10, 'Пластиковые платформы = 10');

  // Chandeliers (1) & Pendants (2) = 3 total:
  // dowels = 3 * 4 = 12
  // screws = 3 * 4 = 12
  // klopScrews = 3 * 8 = 24
  // platformsWood = 3
  // hangers = 3 * 4 = 12
  // wago = 3 * 2 = 6
  assert.strictEqual(result.platformsWood, 3, 'Деревянные платформы = 3');

  // Ventilation grilles (1):
  // dowels = 1 * 4 = 4
  // screws = 1 * 4 = 4
  // klopScrews = 1 * 8 = 8
  // hangers = 1 * 4 = 4
  assert.strictEqual(result.engineCount, 1, 'Вентиляторы = 1');

  // LED Strip (10m)
  // wago = 2
  
  // Totals verification
  // Dowels = 110 + 20 + 12 + 4 = 146
  assert.strictEqual(result.dowels, 146, 'Общее количество дюбелей должно быть 146');

  // Screws = 110 + 20 + 12 + 4 = 146
  assert.strictEqual(result.screws, 146, 'Общее количество саморезов должно быть 146');

  // Klop Screws = 60 + 24 + 8 = 92
  assert.strictEqual(result.klopScrews, 92, 'Общее количество саморезов "клоп" должно быть 92');

  // WAGO = 20 + 6 + 2 = 28
  assert.strictEqual(result.wagoTerminals, 28, 'Общее количество клемм WAGO должно быть 28');

  // Hangers = 20 + 12 + 4 = 36
  assert.strictEqual(result.hangers, 36, 'Общее количество подвесов должно быть 36');

  // Salaries: 100000 * 0.3 = 30000, / 2 = 15000
  assert.strictEqual(result.salaries.totalFund, 30000, 'Фонд ЗП = 30000');
  assert.strictEqual(result.salaries.perWorker, 15000, 'ЗП на 1 монтажника = 15000');

  console.log('✅ All calculator tests passed successfully!');
});
