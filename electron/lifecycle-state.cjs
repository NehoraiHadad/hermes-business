// Tiny shared flag for the app quit sequence. The window close handler must
// distinguish "user closed the window" (hide to tray) from "app is quitting"
// (let it close). main.cjs flips `quitting` in before-quit; windows.cjs reads it.
module.exports = { quitting: false }
