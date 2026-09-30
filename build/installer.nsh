; Tempo NSIS 自定义卸载逻辑：卸载时明确询问用户是否删除任务数据（默认保留）
; 数据目录 = %APPDATA%\tempo-tasks（Electron userData，与程序目录分离）

!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "是否同时删除任务数据？$\n$\n- 点「是」：删除全部任务、执行历史与设置（不可恢复）$\n- 点「否」：保留数据，重新安装后可继续使用" \
    IDYES _tempoDeleteData
  Goto _tempoKeepData
  _tempoDeleteData:
    RMDir /r "$APPDATA\tempo-tasks"
  _tempoKeepData:
!macroend
