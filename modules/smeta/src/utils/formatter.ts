import { ICalculatedMaterials } from '../types';

export function formatMaterialList(clientName: string, materials: ICalculatedMaterials): string {
  let text = `🛠 <b>Список материалов на объект [${clientName}]</b>\n\n`;

  // Profiles
  if (materials.profiles.length > 0) {
    text += `<b>Профили:</b>\n`;
    for (const profile of materials.profiles) {
      text += `— ${profile.type}: ${profile.sticksCount} шт. (палок)\n`;
    }
    text += `\n`;
  }

  // General Hardware
  text += `<b>Фурнитура и крепеж:</b>\n`;
  text += `— Дюбеля: ${materials.dowels} шт.\n`;
  text += `— Саморезы обычные: ${materials.screws} шт.\n`;
  if (materials.klopScrews > 0) text += `— Саморезы "клоп": ${materials.klopScrews} шт.\n`;
  if (materials.wagoTerminals > 0) text += `— Клеммы WAGO: ${materials.wagoTerminals} шт.\n`;
  if (materials.mountingAngles > 0) text += `— Монтажные углы (для треков): ${materials.mountingAngles} шт.\n`;
  if (materials.hangers > 0) text += `— Подвесы: ${materials.hangers} шт.\n`;
  
  text += `\n<b>Расходники для освещения:</b>\n`;
  if (materials.platformsPlastic > 0) text += `— Платформы (пластик): ${materials.platformsPlastic} шт.\n`;
  if (materials.platformsWood > 0) text += `— Платформы (дерево): ${materials.platformsWood} шт.\n`;

  if (materials.engineCount && materials.engineCount > 0) {
    text += `\n<b>Дополнительно:</b>\n`;
    text += `— Вентилятор / Движок вытяжки: ${materials.engineCount} шт.\n`;
  }

  return text;
}

export function formatFinancialStatement(materials: ICalculatedMaterials): string {
  let text = `💰 <b>Финансовая выписка</b>\n\n`;
  text += `Общий фонд ЗП монтажников: <b>${materials.salaries.totalFund.toFixed(2)} руб.</b>\n`;
  text += `Выплата на 1 сотрудника (из 2-х): <b>${materials.salaries.perWorker.toFixed(2)} руб.</b>\n`;

  return text;
}
