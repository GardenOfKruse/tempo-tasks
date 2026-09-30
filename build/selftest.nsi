; 最小卸载询问验证器：与 Tempo 安装包相同的询问逻辑（数据目录为自测哑目录）
Name "Tempo Uninst SelfTest"
OutFile "Tempo-Uninst-SelfTest.exe"
InstallDir "$LOCALAPPDATA\Programs\TempoSelfTest"
RequestExecutionLevel user

Page directory
Page instfiles
UninstPage instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File "dummy-app.txt"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Delete task data? YES = delete dummy data, NO = keep it" \
    IDYES _del
  Goto _keep
  _del:
    RMDir /r "$APPDATA\tempo-uninst-selftest"
  _keep:
!macroend

Section "Uninstall"
  Delete "$INSTDIR\dummy-app.txt"
  !insertmacro customUnInstall
  RMDir "$INSTDIR"
SectionEnd
