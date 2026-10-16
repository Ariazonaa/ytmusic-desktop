; Included by Tauri's installer script, ahead of its own sections.
;
; WebView2 comes with Windows 11, but on some systems, such as Windows
; Sandbox, it is not registered with EdgeUpdate, which is where the installer
; looks. It would then run Microsoft's WebView2 setup, which fails there, and
; give up. If the runtime's files are in place, the WebView2 section is left
; out instead; the app finds them itself (src-tauri/src/webview_runtime.rs).

; Included before Tauri defines WEBVIEW2APPGUID, so the id is written out.
Section -FindUnregisteredWebView2
  ${If} ${RunningX64}
    ReadRegStr $R2 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${Else}
    ReadRegStr $R2 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $R2 == ""
    ReadRegStr $R2 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $R2 != ""
    Return
  ${EndIf}

  ; A folder Application\<version> with the runtime's executable in it.
  StrCpy $R3 ""
  FindFirst $R4 $R5 "$PROGRAMFILES32\Microsoft\EdgeWebView\Application\*.*"
  ${DoWhile} $R5 != ""
    ${If} ${FileExists} "$PROGRAMFILES32\Microsoft\EdgeWebView\Application\$R5\msedgewebview2.exe"
      StrCpy $R3 $R5
    ${EndIf}
    FindNext $R4 $R5
  ${Loop}
  FindClose $R4
  ${If} $R3 == ""
    Return
  ${EndIf}

  ; Sections are counted in the order they are written; find WebView2 by name.
  StrCpy $R6 0
  ${Do}
    ClearErrors
    SectionGetText $R6 $R7
    ${If} ${Errors}
      ${Break}
    ${EndIf}
    ${If} $R7 == "WebView2"
      DetailPrint "WebView2 $R3 is there without being registered; not installing it"
      SectionSetFlags $R6 0
      ${Break}
    ${EndIf}
    IntOp $R6 $R6 + 1
  ${Loop}
SectionEnd
