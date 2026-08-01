const { activateWhatsappGuard } = require('./whatsapp-guard-activation.cjs')
const { getWhatsappPolicy } = require('./whatsapp-policy.cjs')
const { saveWhatsappPolicySynced } = require('./whatsapp-policy-sync.cjs')
const { getTelegramPolicy } = require('./telegram-policy.cjs')
const { saveTelegramPolicySynced } = require('./telegram-policy-sync.cjs')

// Fail-closed activation gate shared by both messaging families (one policy plugin enforces
// WhatsApp AND Telegram). A plugin UPDATE restarts the running gateway through the OFFICIAL
// control endpoint and reverifies a FRESH heartbeat before the connection is treated safe.
// We throw ONLY when the guard is genuinely unsafe:
//   * the plugin could not be installed/enabled, or
//   * `blocked` — a required restart/reverification FAILED (the gateway may still run OLD code).
// A `pending` result (installed+enabled, gateway simply not up / channel not connected yet) is
// NOT an unsafe state: the status reader stays fail-closed, so a connection cannot be reported
// connected until a real heartbeat appears. Blocking configuration there would break setup.
async function ensureMessagingSafety(channelLabel) {
  const result = await activateWhatsappGuard()
  if (result.blocked) {
    throw new Error(`רכיב ההגנה של ${channelLabel} אינו פעיל. החיבור לא יופעל במצב לא בטוח.`)
  }
  return result
}

function ensureWhatsappSafety() {
  return ensureMessagingSafety('WhatsApp')
}

function ensureTelegramSafety() {
  return ensureMessagingSafety('Telegram')
}

// Wires the WhatsApp/Telegram reply-policy IPC channels. The set handlers fail
// closed by ensuring the shared policy plugin is installed and enabled before
// persisting any policy change.
function registerMessagingPolicyIpc(ipcMain) {
  ipcMain.handle('hermes:whatsapp-policy:get', getWhatsappPolicy)
  ipcMain.handle('hermes:whatsapp-policy:set', async (_event, policy) => {
    await ensureWhatsappSafety() // fail closed BEFORE persisting — must await the guard check
    return saveWhatsappPolicySynced(policy)
  })
  ipcMain.handle('hermes:whatsapp-policy:ensure', () => ensureWhatsappSafety())
  ipcMain.handle('hermes:telegram-policy:get', getTelegramPolicy)
  ipcMain.handle('hermes:telegram-policy:set', async (_event, policy) => {
    await ensureTelegramSafety() // fail closed BEFORE persisting — must await the guard check
    return saveTelegramPolicySynced(policy)
  })
  ipcMain.handle('hermes:telegram-policy:ensure', () => ensureTelegramSafety())
}

module.exports = { registerMessagingPolicyIpc, ensureWhatsappSafety, ensureTelegramSafety }
