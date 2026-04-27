// Аналог core/navigation.py — стек состояний для кнопки «Назад»
const STACK_KEY = '_nav_stack';

/**
 * Переходим в новое состояние, текущее кладём в стек.
 * @param {object} session - ctx.session.botState
 * @param {string} newState
 * @param {object} [extra] - доп. данные для session
 */
export function goTo(session, newState, extra = {}) {
  const stack = session[STACK_KEY] ?? [];
  if (session.state) {
    stack.push(session.state);
  }
  session[STACK_KEY] = stack;
  session.state = newState;
  Object.assign(session, extra);
}

/**
 * Достаём предыдущий стейт из стека и переходим в него.
 * Возвращает имя предыдущего стейта или null если стек пуст.
 * @param {object} session
 * @returns {string|null}
 */
export function goBack(session) {
  const stack = session[STACK_KEY] ?? [];
  if (!stack.length) return null;
  const prev = stack.pop();
  session[STACK_KEY] = stack;
  session.state = prev;
  return prev;
}

/**
 * Сбрасываем в корневое состояние, очищаем стек.
 * @param {object} session
 * @param {string} rootState
 */
export function goRoot(session, rootState) {
  session[STACK_KEY] = [];
  session.state = rootState;
}
