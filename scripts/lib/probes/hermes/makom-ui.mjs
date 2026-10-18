import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

// Real user input against the shipped shared form and authenticated backend.
// The caller owns an isolated Hermes home, its host window and teardown.
export async function verifyMakomUi(page, { link, directory = '.artifacts/makom', connectedCheck = async () => {} }) {
  await mkdir(directory, { recursive: true })
  await page.getByLabel('קישור לקהילה במקום').fill(link)
  await page.getByRole('button', { name: 'בדיקת הקהילה', exact: true }).press('Enter')
  await page.getByText('נמצאה הקהילה:', { exact: false }).waitFor({ timeout: 45000 })
  await page.getByRole('button', { name: 'חיבור מקום', exact: true }).press('Enter')
  await page.getByText(/המידע נבדק והסקיל הותקן/).waitFor({ timeout: 90000 })
  assert.equal(await page.getByRole('alert').count(), 0)
  await page.screenshot({ path: directory + '/connected.png', fullPage: true })
  await connectedCheck()
  await page.getByRole('button', { name: 'רענון מצב החיבור', exact: true }).press('Enter')
  await page.getByText(/נבדק וזמין/).waitFor({ timeout: 45000 })
  await page.getByRole('button', { name: 'ניתוק מהמרחבים שנבחרו', exact: true, disabled: false }).waitFor({ timeout: 45000 })
  await page.getByRole('button', { name: 'ניתוק מהמרחבים שנבחרו', exact: true }).press('Enter')
  await page.getByText(/החיבור והסקיל הוסרו/).waitFor({ timeout: 45000 })
  await page.screenshot({ path: directory + '/disconnected.png', fullPage: true })
  return { resolved: true, connected: true, refreshed: true, disconnected: true }
}
