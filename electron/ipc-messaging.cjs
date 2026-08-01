const { installWhatsappPolicyPlugin } = require('./whatsapp-plugin-install.cjs')
const { getWhatsappPolicy } = require('./whatsapp-policy.cjs')
const { saveWhatsappPolicySynced } = require('./whatsapp-policy-sync.cjs')
const { getTelegramPolicy } = require('./telegram-policy.cjs')
const { saveTelegramPolicySynced } = require('./telegram-policy-sync.cjs')

function ensureWhatsappSafety() {
  const result = installWhatsappPolicyPlugin()
  if (!result.ok || !result.enabled) {
    throw new Error('רכיב ההגנה של WhatsApp אינו פעיל. החיבור לא יופעל במצב לא בטוח.')
  }
  return result
}

// The same policy plugin enforces Telegram (one engine, two families), so
// ensuring Telegram safety installs/verifies exactly that plugin.
function ensureTelegramSafety() {
  const result = installWhatsappPolicyPlugin()
  if (!result.ok || !result.enabled) {
    throw new Error('רכיב ההגנה של Telegram אינו פעיל. החיבור לא יופעל במצב לא בטוח.')
  }
  return result
}

// Wires the WhatsApp/Telegram reply-policy IPC channels. The set handlers fail
// closed by ensuring the shared policy plugin is installed and enabled before
// persisting any policy change.
function registerMessagingPolicyIpc(ipcMain) {
  ipcMain.handle('hermes:whatsapp-policy:get', getWhatsappPolicy)
  ipcMain.handle('hermes:whatsapp-policy:set', async (_event, policy) => {
    ensureWhatsappSafety()
    return saveWhatsappPolicySynced(policy)
  })
  ipcMain.handle('hermes:whatsapp-policy:ensure', ensureWhatsappSafety)
  ipcMain.handle('hermes:telegram-policy:get', getTelegramPolicy)
  ipcMain.handle('hermes:telegram-policy:set', async (_event, policy) => {
    ensureTelegramSafety()
    return saveTelegramPolicySynced(policy)
  })
  ipcMain.handle('hermes:telegram-policy:ensure', ensureTelegramSafety)
}

module.exports = { registerMessagingPolicyIpc, ensureWhatsappSafety, ensureTelegramSafety }
