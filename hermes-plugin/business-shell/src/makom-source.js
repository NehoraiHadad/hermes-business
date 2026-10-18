let rest
export const setMakomRest = value => { rest = value }
export async function makomRequest(path, init) {
  if (!rest) throw Error('חיבור מקום דורש את רכיב השירות של תכל׳ס. עדכנו או התקינו מחדש את תכל׳ס.')
  const value = await rest(path, init ? { ...init, timeoutMs: 120000 } : { timeoutMs: 30000 })
  if (!value) throw Error('רכיב החיבור למקום אינו זמין כרגע')
  return value
}
