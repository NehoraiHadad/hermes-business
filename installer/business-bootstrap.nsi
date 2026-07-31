Unicode true
ManifestDPIAware true

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define PRODUCT_NAME "העוזר לעסק — התקנה מקוונת"
!define PRODUCT_VERSION "0.3.2"

Name "${PRODUCT_NAME}"
Caption "${PRODUCT_NAME}"
OutFile "..\release\Hermes-Business-Web-Setup-0.3.2.exe"
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
  File /oname=plugin.js "..\hermes-plugin\business-shell\plugin.js"
  File /oname=business-bootstrap.SKILL.md "..\hermes-plugin\business-shell\skills\business-bootstrap\SKILL.md"

  DetailPrint "Detecting or installing Hermes Agent..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\bootstrap.ps1" -PayloadRoot "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "ההתקנה לא הושלמה. פרטים נשמרו ב-$LOCALAPPDATA\HermesBusinessBootstrap\install.log"
    SetErrorLevel 1
    Abort
  ${EndIf}

  RMDir /r "$INSTDIR"
SectionEnd
