const { activateWhatsappGuard } = require('./whatsapp-guard-activation.cjs')
const { getWhatsappPolicy } = require('./whatsapp-policy.cjs')
const { saveWhatsappPolicySynced } = require('./whatsapp-policy-sync.cjs')
const { readWhatsappDirectory } = require('./whatsapp-directory.cjs')

// WhatsApp is connected to an account with existing conversations, so its
// read-only/selected-chat policy remains a product safety boundary. Telegram is
// intentionally absent: its dedicated bot uses Hermes' native access policy.
async function ensureWhatsappSafety() {
  const result = await activateWhatsappGuard()
  if (result.blocked) {
    throw new Error('רכיב ההגנה של WhatsApp אינו פעיל. החיבור לא יופעל במצב לא בטוח.')
  }
  return result
}

function registerMessagingPolicyIpc(ipcMain) {
  ipcMain.handle('hermes:whatsapp-policy:get', getWhatsappPolicy)
  ipcMain.handle('hermes:whatsapp-directory:get', readWhatsappDirectory)
  ipcMain.handle('hermes:whatsapp-policy:set', async (_event, policy) => {
    await ensureWhatsappSafety()
    return saveWhatsappPolicySynced(policy)
  })
  ipcMain.handle('hermes:whatsapp-policy:ensure', () => ensureWhatsappSafety())
}

module.exports = { registerMessagingPolicyIpc, ensureWhatsappSafety }
