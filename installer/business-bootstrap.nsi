Unicode true
ManifestDPIAware true

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define PRODUCT_NAME "תכל'ס — התקנה מקוונת"
!ifndef PRODUCT_VERSION
  !error "PRODUCT_VERSION must be supplied by scripts/build-bootstrap.ps1"
!endif

Name "${PRODUCT_NAME}"
Caption "${PRODUCT_NAME}"
OutFile "..\release\Hermes-Business-Web-Setup-${PRODUCT_VERSION}.exe"
Icon "..\build\icon.ico"
InstallDir "$TEMP\HermesBusinessBootstrap"
RequestExecutionLevel user
ShowInstDetails show
BrandingText "Hermes Business"

!define MUI_ABORTWARNING
!define MUI_ICON "..\build\icon.ico"
!define MUI_FINISHPAGE_NOAUTOCLOSE
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "Hebrew"
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /oname=bootstrap.ps1 "bootstrap.ps1"
  File /oname=bootstrap-companion.ps1 "bootstrap-companion.ps1"
  File /oname=companion-release.json "companion-release.json"
  File /oname=plugin.js "..\hermes-plugin\business-shell\plugin.js"
  File /oname=business-bootstrap.SKILL.md "..\hermes-plugin\business-shell\skills\business-bootstrap\SKILL.md"
  File /oname=business-partner.SKILL.md "..\hermes-plugin\business-partner\SKILL.md"

  ; Shared PowerShell library — bootstrap.ps1 and bootstrap-companion.ps1 dot-source
  ; these from .\lib. This list MUST stay in sync with the loaders in bootstrap.ps1
  ; and bootstrap-companion.ps1 so a clean packaged install can never omit a module.
  SetOutPath "$INSTDIR\lib"
  File "lib\Logging.ps1"
  File "lib\Hashing.ps1"
  File "lib\HttpRetry.ps1"
  File "lib\HttpDownload.ps1"
  File "lib\FileOps.ps1"
  File "lib\ZipPolicy.ps1"
  File "lib\SafeZip.ps1"
  File "lib\SemVer.ps1"
  File "lib\HermesEnv.ps1"
  File "lib\Release.ps1"
  File "lib\ReleaseSelection.ps1"
  File "lib\ReleaseAcquisition.ps1"
  File "lib\Payload.ps1"
  File "lib\VerifyMode.ps1"
  File "lib\BackendEnable.ps1"
  File "lib\enable_plugin.py"
  File "lib\BusinessInstall.ps1"
  File "lib\CompanionEntrypoint.ps1"
  File "lib\CompanionInstall.ps1"
  File "lib\CompanionManifest.ps1"
  SetOutPath "$INSTDIR"

  ; Companion backend payload (strictly read-only paused-inclusive cron door). The
  ; bootstrap installs the manifest and the mounted, self-contained plugin_api.py into
  ; <HERMES_HOME>\plugins\business-shell\dashboard and enables business-shell in
  ; config.yaml — all inside the business-shell payload transaction. The business-context
  ; skill is persisted through the official Hermes Skills API, so no write engine ships.
  SetOutPath "$INSTDIR\dashboard"
  File "..\hermes-plugin\business-shell\dashboard\manifest.json"
  File "..\hermes-plugin\business-shell\dashboard\plugin_api.py"
  SetOutPath "$INSTDIR"

  SetOutPath "$INSTDIR\whatsapp-policy"
  File "..\hermes-plugin\business-whatsapp-policy\__init__.py"
  File "..\hermes-plugin\business-whatsapp-policy\policy.py"
  File "..\hermes-plugin\business-whatsapp-policy\ingest.py"
  File "..\hermes-plugin\business-whatsapp-policy\contract.py"
  File "..\hermes-plugin\business-whatsapp-policy\surface.py"
  File "..\hermes-plugin\business-whatsapp-policy\guards.py"
  File "..\hermes-plugin\business-whatsapp-policy\transport.py"
  File "..\hermes-plugin\business-whatsapp-policy\registry.py"
  File "..\hermes-plugin\business-whatsapp-policy\guard_core.py"
  File "..\hermes-plugin\business-whatsapp-policy\surface_core.py"
  File "..\hermes-plugin\business-whatsapp-policy\dispatch.py"
  File "..\hermes-plugin\business-whatsapp-policy\families.py"
  File "..\hermes-plugin\business-whatsapp-policy\egress.py"
  File "..\hermes-plugin\business-whatsapp-policy\tool_hook.py"
  File "..\hermes-plugin\business-whatsapp-policy\tool_transport.py"
  File "..\hermes-plugin\business-whatsapp-policy\tool_contract.py"
  File "..\hermes-plugin\business-whatsapp-policy\guard_status.py"
  File "..\hermes-plugin\business-whatsapp-policy\plugin.yaml"
  SetOutPath "$INSTDIR"

  ; Self-contained community management/runtime payload. It is copied into
  ; HERMES_HOME\tachles\community by BusinessInstall.ps1 and includes its own
  ; YAML parser dependencies, so an installed product never depends on this
  ; repository's node_modules or source checkout.
  SetOutPath "$INSTDIR\community\scripts"
  File "..\scripts\community-generate.mjs"
  File "..\scripts\community-provision.mjs"
  SetOutPath "$INSTDIR\community\scripts\lib\community"
  File /x "*.test.mjs" "..\scripts\lib\community\*.mjs"
  SetOutPath "$INSTDIR\community\assets\community-skills\community-bootstrap"
  File "..\assets\community-skills\community-bootstrap\SKILL.md"
  SetOutPath "$INSTDIR\community\assets\community-skills\community-admin"
  File "..\assets\community-skills\community-admin\SKILL.md"
  SetOutPath "$INSTDIR\community\hermes-plugin\community-archive"
  File "..\hermes-plugin\community-archive\__init__.py"
  File "..\hermes-plugin\community-archive\filters.py"
  File "..\hermes-plugin\community-archive\policy.py"
  File "..\hermes-plugin\community-archive\query.py"
  File "..\hermes-plugin\community-archive\storage.py"
  File "..\hermes-plugin\community-archive\tool.py"
  File "..\hermes-plugin\community-archive\plugin.yaml"
  SetOutPath "$INSTDIR\community\node_modules\js-yaml"
  File /r "..\node_modules\js-yaml\*"
  SetOutPath "$INSTDIR\community\node_modules\argparse"
  File /r "..\node_modules\argparse\*"
  SetOutPath "$INSTDIR"

  DetailPrint "Detecting or installing Hermes Agent..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\bootstrap.ps1" -PayloadRoot "$INSTDIR" -BootstrapVersion "${PRODUCT_VERSION}"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "ההתקנה לא הושלמה. פרטים נשמרו ב-$LOCALAPPDATA\HermesBusinessBootstrap\install.log"
    SetErrorLevel 1
    Abort
  ${EndIf}

  RMDir /r "$INSTDIR"
SectionEnd
