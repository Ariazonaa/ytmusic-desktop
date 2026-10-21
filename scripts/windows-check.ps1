<#
Checks a build of the app on this Windows PC in the real app, and leaves the
PC as it was: the installed program, settings.json, the autostart entry and
the taskbar's jump list and the ytmusic:// link handler are put back at the end, also when a check fails.

  powershell -ExecutionPolicy Bypass -File scripts\windows-check.ps1 -Installer <setup.exe> [-Minutes <n>] [-Out <folder>]

Windows PowerShell 5.1 (powershell.exe), not PowerShell 7: the playback is
read from the app's own now-playing page, and some UI Automation calls want 5.1.

What it does, with PASS or FAIL per line:
- installs the build silently; for the run: autostart on, zoom 110 %, always
  on top, the now-playing page, a global shortcut (Ctrl+Alt+Shift+P) and a
  test plugin that tries to leave its frame
- starts playback with `--play-pause` from a second launch
- lets a track play on for -Minutes (default 2) and watches that it does
- the global shortcut pauses and plays, the window is above others
- the sleep timer pauses after 15 seconds, and pauses nothing once switched off
- the mini player opens above other windows and closes again
- clicks Next and Play / Pause the way a thumbnail toolbar button does
- reads the jump list and the autostart entry
- shows the taskbar if it hides itself and checks the progress drawn under
  the app's taskbar button: in the accent color while playing, another while paused
- asks the now-playing page, also with a foreign Host
- opens a ytmusic:// link the way a browser hands it to Windows
- sends the sound to another output device from the tray menu (opened as on
  a right click, clicked with UI Automation) and with --output=, and back,
  read from Windows' audio sessions (skipped with a single device); YouTube
  Music has the microphone permission only meanwhile, read from WebView2's
  preferences
- after a minute's pause in the tray the page is unloaded, and Play / Pause
  brings the track back playing
- reads the app's log: the test plugin stopped, no part of YouTube Music
  missing, nothing else
Pictures of the taskbar button go to -Out (default: a folder in %TEMP%).
Only the button is pictured, nothing else on the screen. The mouse is not moved.
#>
param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [double]$Minutes = 2,
    # Seconds the app gets after its start before the checks begin.
    [int]$Settle = 20,
    [string]$Out = (Join-Path $env:TEMP "ytmusic-desktop-check")
)
$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSEdition -ne "Desktop") { throw "run this with Windows PowerShell 5.1 (powershell.exe)" }

$App = Join-Path $env:LOCALAPPDATA "YouTube Music Desktop\ytmusic-desktop.exe"
$Config = Join-Path $env:APPDATA "io.github.ariazonaa.ytmusic-desktop"
$Run = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$RunName = "YouTube Music Desktop"
$JumpLists = Join-Path $env:APPDATA "Microsoft\Windows\Recent\CustomDestinations"
$Port = 47891
$TestPlugin = Join-Path $Config "plugins\windows-check-leak"
New-Item -ItemType Directory -Force $Out | Out-Null
$Backup = Join-Path $Out "backup"
New-Item -ItemType Directory -Force $Backup | Out-Null
$failed = 0
function Check([string]$what, [bool]$ok, [string]$detail = "") {
    $word = if ($ok) { "PASS" } else { "FAIL"; $script:failed++ }
    Write-Output ("{0}  {1}{2}" -f $word, $what, $(if ($detail) { " ($detail)" } else { "" }))
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Native {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct APPBARDATA {
    public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge;
    public int left, top, right, bottom; public IntPtr lParam; }
  [DllImport("shell32.dll")] public static extern IntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);
  [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr m);
  [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr m, int pos);
  [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr m, int pos);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetMenuStringW(IntPtr m, uint item, System.Text.StringBuilder s, int max, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string title);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
"@
[Native]::SetProcessDPIAware() | Out-Null

# --- what plays, as the page itself reports it to the now-playing page ---
# Windows' media controls were tried first: their status lags behind the
# player and was wrong for seconds at a time, the page's report is not.
function Playing {
    try {
        $client = New-Object Net.WebClient
        $client.Encoding = [Text.Encoding]::UTF8
        $now = $client.DownloadString("http://127.0.0.1:$Port/now-playing.json") | ConvertFrom-Json
    } catch { return $null }
    if (-not $now.title) { return $null }
    [pscustomobject]@{ Title = $now.title; Status = $(if ($now.paused) { "Paused" } else { "Playing" }) }
}
function WaitFor([scriptblock]$condition, [int]$seconds = 15) {
    for ($i = 0; $i -lt $seconds * 2; $i++) { $now = Playing; if ($now -and (& $condition $now)) { return $now }; Start-Sleep -Milliseconds 500 }
    Playing
}

# --- the main window and its thumbnail toolbar ---
function MainWindow { (Get-Process ytmusic-desktop -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).MainWindowHandle }
function ThumbClick([int]$id) {
    # WM_COMMAND with THBN_CLICKED in the high word, as Windows sends it for a toolbar button.
    [Native]::PostMessageW((MainWindow), 0x0111, [IntPtr]((0x1800 -shl 16) -bor $id), [IntPtr]::Zero) | Out-Null
}
# The app's window only, drawn by itself (PrintWindow): what its player bar shows.
function WindowShot([string]$name) {
    $handle = MainWindow
    $r = New-Object Native+RECT
    [Native]::GetWindowRect($handle, [ref]$r) | Out-Null
    $bitmap = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $dc = $graphics.GetHdc()
    [Native]::PrintWindow($handle, $dc, 2) | Out-Null
    $graphics.ReleaseHdc($dc)
    $path = Join-Path $Out "$name.png"
    $bitmap.Save($path)
    $bitmap.Dispose()
    $path
}
function Shot([string]$name, [System.Drawing.Rectangle]$area) {
    $bitmap = New-Object System.Drawing.Bitmap $area.Width, $area.Height
    [System.Drawing.Graphics]::FromImage($bitmap).CopyFromScreen($area.Left, $area.Top, 0, 0, $area.Size)
    $path = Join-Path $Out "$name.png"
    $bitmap.Save($path)
    $bitmap.Dispose()
    $path
}

# Where Windows plays sound: the output devices in use, and those with a
# playing session of WebView2, by the names Windows shows for them.
Add-Type -TypeDefinition @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection c); }
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection { int GetCount(out int n); int Item(int i, out IMMDevice d); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); int OpenPropertyStore(int a, out IPropertyStore s); }
[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore { int GetCount(out int c); int GetAt(int i, out PKEY k); int GetValue(ref PKEY k, out PROPVARIANT v); }
[StructLayout(LayoutKind.Sequential)] struct PKEY { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit)] struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 { int f1(); int f2(); int GetSessionEnumerator(out IAudioSessionEnumerator e); }
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator { int GetCount(out int n); int GetSession(int i, out IAudioSessionControl2 s); }
[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 { int GetState(out int s); int a(); int b(); int c(); int d(); int e(); int f(); int g(); int h(); int i(); int j(); int GetProcessId(out uint pid); }
public static class SoundDevices {
  static List<string> Walk(bool playingOnly) {
    var found = new List<string>();
    var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
    IMMDeviceCollection c; en.EnumAudioEndpoints(0, 1, out c); int n; c.GetCount(out n);
    for (int i = 0; i < n; i++) {
      IMMDevice d; c.Item(i, out d); IPropertyStore ps; d.OpenPropertyStore(0, out ps);
      var k = new PKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 }; PROPVARIANT v; ps.GetValue(ref k, out v);
      string name = Marshal.PtrToStringUni(v.p);
      if (!playingOnly) { found.Add(name); continue; }
      Guid iid = typeof(IAudioSessionManager2).GUID; object o; d.Activate(ref iid, 23, IntPtr.Zero, out o);
      IAudioSessionEnumerator se; ((IAudioSessionManager2)o).GetSessionEnumerator(out se); int m; se.GetCount(out m);
      for (int j = 0; j < m; j++) {
        IAudioSessionControl2 s; se.GetSession(j, out s); int st; s.GetState(out st); uint pid; s.GetProcessId(out pid);
        string pn = ""; try { pn = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
        if (pn == "msedgewebview2" && st == 1 && !found.Contains(name)) found.Add(name);
      }
    }
    return found;
  }
  public static string[] All() { return Walk(false).ToArray(); }
  public static string[] Playing() { return Walk(true).ToArray(); }
}
"@
function SoundOn { @([SoundDevices]::Playing()) -join ", " }

# The tray menu, opened the way Windows does on a right click on the icon
# (the message to the icon's hidden window). Its entries are drawn by the
# app and have no names for UI Automation, so the entry is found in the menu
# itself, by its text, and chosen with the command a click sends. The mouse
# is not moved.
function TrayWindow {
    $ids = @(Get-Process ytmusic-desktop -ErrorAction SilentlyContinue | ForEach-Object Id)
    $handle = [IntPtr]::Zero
    while (($handle = [Native]::FindWindowExW([IntPtr]::Zero, $handle, "tray_icon_app", [NullString]::Value)) -ne [IntPtr]::Zero) {
        $owner = 0; [void][Native]::GetWindowThreadProcessId($handle, [ref]$owner)
        if ($ids -contains $owner) { return $handle }
    }
    [IntPtr]::Zero
}
function MenuEntry([IntPtr]$menu, [string[]]$names) {
    for ($at = 0; $at -lt [Native]::GetMenuItemCount($menu); $at++) {
        $text = New-Object System.Text.StringBuilder 256
        [void][Native]::GetMenuStringW($menu, $at, $text, 256, 0x400)   # MF_BYPOSITION
        if ($names -contains $text.ToString()) { return $at }
    }
    -1
}
# TrayClick @("Output", "Ausgabe") @("Lautsprecher (...)"): each step one entry, in either language.
function TrayClick {
    $tray = TrayWindow
    if ($tray -eq [IntPtr]::Zero) { return $false }
    [void][Native]::PostMessageW($tray, 6002, [IntPtr]::Zero, [IntPtr]0x205)   # the icon's WM_RBUTTONUP
    $popup = [IntPtr]::Zero
    for ($i = 0; $i -lt 20 -and $popup -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 250; $popup = [Native]::FindWindowExW([IntPtr]::Zero, [IntPtr]::Zero, "#32768", [NullString]::Value) }
    if ($popup -eq [IntPtr]::Zero) { return $false }
    $menu = [Native]::SendMessageW($popup, 0x01E1, [IntPtr]::Zero, [IntPtr]::Zero)   # MN_GETHMENU
    $id = $null
    foreach ($step in $args) {
        $at = MenuEntry $menu $step
        if ($at -lt 0) { break }
        $sub = [Native]::GetSubMenu($menu, $at)
        if ($sub -ne [IntPtr]::Zero) { $menu = $sub } else { $id = [Native]::GetMenuItemID($menu, $at) }
    }
    # Closes the menu, then chooses the entry as its click would.
    [Native]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero); [Native]::keybd_event(0x1B, 0, 2, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 300
    if ($null -eq $id) { return $false }
    [void][Native]::PostMessageW($tray, 0x0111, [IntPtr][int]$id, [IntPtr]::Zero)   # WM_COMMAND
    $true
}
# Whether the WebView2 profile holds the microphone permission for YouTube
# Music. The browser writes its preferences some seconds after a change.
$Preferences = Join-Path $env:LOCALAPPDATA "io.github.ariazonaa.ytmusic-desktop\EBWebView\Default\Preferences"
function MicAllowed {
    try { $prefs = Get-Content $Preferences -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $false }
    $entry = $prefs.profile.content_settings.exceptions.media_stream_mic."https://music.youtube.com:443,*"
    [bool]($entry -and $entry.setting -eq 1)
}
function MicBecomes([bool]$want) {
    for ($i = 0; $i -lt 40 -and (MicAllowed) -ne $want; $i++) { Start-Sleep -Milliseconds 500 }
    (MicAllowed) -eq $want
}

# --- what is put back at the end ---
$hadApp = Test-Path $App
if ($hadApp) { Copy-Item $App (Join-Path $Backup "ytmusic-desktop.exe") -Force }
Copy-Item (Join-Path $Config "settings.json") (Join-Path $Backup "settings.json") -Force
$runBefore = (Get-ItemProperty $Run -ErrorAction SilentlyContinue).$RunName
$Scheme = "HKCU:\Software\Classes\ytmusic"
$hadScheme = Test-Path $Scheme
$jumpBefore = @(Get-ChildItem $JumpLists -Filter *.customDestinations-ms -ErrorAction SilentlyContinue | ForEach-Object Name)
$appBar = New-Object Native+APPBARDATA; $appBar.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($appBar)
$barState = [int][Native]::SHAppBarMessage(4, [ref]$appBar)   # ABM_GETSTATE
$logFile = Join-Path $Config "log.txt"
$logBefore = if (Test-Path $logFile) { (Get-Content $logFile | Measure-Object -Line).Lines } else { 0 }

try {
    Stop-Process -Name ytmusic-desktop -Force -ErrorAction SilentlyContinue; Start-Sleep 3
    $setup = Start-Process $Installer -ArgumentList "/S" -Wait -PassThru
    Check "installer" ($setup.ExitCode -eq 0) "exit $($setup.ExitCode)"
    Stop-Process -Name ytmusic-desktop -Force -ErrorAction SilentlyContinue; Start-Sleep 2

    # A plugin from others that tries to leave its frame.
    New-Item -ItemType Directory -Force $TestPlugin | Out-Null
    [IO.File]::WriteAllText((Join-Path $TestPlugin "plugin.json"), '{ "name": "windows-check-leak", "version": "0.0.1", "description": "Test only: tries to leave its frame.", "permissions": [] }')
    [IO.File]::WriteAllText((Join-Path $TestPlugin "index.js"), 'setTimeout(() => { location.href = "https://example.com/?left-the-frame=1"; }, 3000);')

    $settings = Get-Content (Join-Path $Config "settings.json") -Raw | ConvertFrom-Json
    $set = { param($name, $value) if ($settings.PSObject.Properties.Name -contains $name) { $settings.$name = $value } else { $settings | Add-Member $name $value } }
    & $set startup $true
    & $set zoom 110
    & $set alwaysOnTop $true
    & $set plugins @(@($settings.plugins) + @("now-playing", "windows-check-leak") | Select-Object -Unique)
    $nowPlaying = [pscustomobject]@{ page = $true; port = $Port; told = $true }
    if (-not $settings.pluginSettings) { & $set pluginSettings ([pscustomobject]@{}) }
    if ($settings.pluginSettings.PSObject.Properties.Name -contains "now-playing") { $settings.pluginSettings."now-playing" = $nowPlaying } else { $settings.pluginSettings | Add-Member "now-playing" $nowPlaying }
    $settings.shortcuts.playPause = "Ctrl+Alt+Shift+KeyP"
    [IO.File]::WriteAllText((Join-Path $Config "settings.json"), ($settings | ConvertTo-Json -Depth 20))

    Start-Process $App; Start-Sleep $Settle
    Check "the app starts" ([bool](MainWindow))

    $entry = (Get-ItemProperty $Run -ErrorAction SilentlyContinue).$RunName
    Check "autostart entry with the path in quotes" ($entry -eq "`"$App`" --autostart") $entry

    # The track from last time loads paused.
    $now = WaitFor { param($p) $p.Title } 30
    if (-not $now -or $now.Status -ne "Playing") {
        Start-Process $App -ArgumentList "--play-pause"
        $now = WaitFor { param($p) $p.Status -eq "Playing" } 20
        Check "--play-pause from a second launch starts playback" ($now -and $now.Status -eq "Playing") "$($now.Status): $($now.Title)"
    }
    Check "still one window after the second launch" (@(Get-Process ytmusic-desktop | Where-Object { $_.MainWindowHandle -ne 0 }).Count -eq 1)
    $topmost = ([Native]::GetWindowLongW((MainWindow), -20) -band 0x8) -ne 0   # GWL_EXSTYLE, WS_EX_TOPMOST
    Check "always on top" $topmost

    # Playing on: nothing pauses it for the whole time; the next track may come.
    $states = @(); $steady = $true
    for ($i = 0; $i -lt [int]($Minutes * 6); $i++) {
        Start-Sleep 10
        $now = Playing
        if (-not $now -or $now.Status -ne "Playing") { $steady = $false; $states += "paused" } else { $states += "playing" }
    }
    Check "plays on for $Minutes minutes" $steady ($states -join " ")

    # The sleep timer, set from a second launch: after 15 seconds, and switched off again.
    Start-Process $App -ArgumentList "--sleep=15s"
    Start-Sleep 11
    $early = Playing
    $now = WaitFor { param($p) $p.Status -eq "Paused" } 12
    Check "sleep timer: still playing before, paused after 15 s" ($early -and $early.Status -eq "Playing" -and $now -and $now.Status -eq "Paused") "$($early.Status) -> $($now.Status)"
    Start-Process $App -ArgumentList "--play-pause"
    WaitFor { param($p) $p.Status -eq "Playing" } 10 | Out-Null
    Start-Process $App -ArgumentList "--sleep=8s"; Start-Sleep 2; Start-Process $App -ArgumentList "--sleep=off"
    Start-Sleep 12
    $now = Playing
    Check "sleep timer switched off pauses nothing" ($now -and $now.Status -eq "Playing") $now.Status

    # The mini player: opens above other windows, and closes again.
    Start-Process $App -ArgumentList "--mini-player"
    $mini = [IntPtr]::Zero
    for ($i = 0; $i -lt 30 -and $mini -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 500; $mini = [Native]::FindWindowW([NullString]::Value, "Mini player") }
    Check "mini player opens with --mini-player" ($mini -ne [IntPtr]::Zero)
    if ($mini -ne [IntPtr]::Zero) {
        Check "mini player is above other windows" (([Native]::GetWindowLongW($mini, -20) -band 0x8) -ne 0)
        Start-Process $App -ArgumentList "--mini-player"
        Start-Sleep 3
        Check "mini player closes with --mini-player again" ([Native]::FindWindowW([NullString]::Value, "Mini player") -eq [IntPtr]::Zero)
    }

    # The taskbar, shown if it hides itself, and the app's button on it, for the progress.
    if ($barState -band 1) { $appBar.lParam = [IntPtr]0; [Native]::SHAppBarMessage(10, [ref]$appBar) | Out-Null; Start-Sleep 2 }  # ABM_SETSTATE
    $root = [Windows.Automation.AutomationElement]::RootElement
    $byClass = New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::ClassNameProperty), "Shell_TrayWnd"
    $tray = $root.FindFirst([Windows.Automation.TreeScope]::Children, $byClass)
    $button = $null
    if ($tray) {
        $button = $tray.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition) |
            Where-Object { $_.Current.Name -like "YouTube Music*" -and $_.Current.ControlType -eq [Windows.Automation.ControlType]::Button } |
            Select-Object -First 1
    }
    Check "the app's taskbar button" ([bool]$button)
    # Only the button itself is pictured. Windows draws the progress as a bar
    # under the icon: in the accent color while playing, yellow while paused.
    function ProgressHue([string]$name) {
        if (-not $button) { return -1 }
        Start-Sleep 2
        $r = $button.Current.BoundingRectangle
        $area = New-Object System.Drawing.Rectangle ([int]$r.X), ([int]$r.Y), ([int]$r.Width), ([int]$r.Height)
        $image = New-Object System.Drawing.Bitmap (Shot $name $area)
        $count = 0; $hue = 0.0
        for ($x = 0; $x -lt $image.Width; $x++) {
            for ($y = [int]($image.Height * 0.75); $y -lt $image.Height; $y++) {
                $c = $image.GetPixel($x, $y)
                if ($c.GetSaturation() -gt 0.5 -and $c.GetBrightness() -gt 0.3) { $count++; $hue += $c.GetHue() }
            }
        }
        $image.Dispose()
        if ($count -lt 3) { return -1 }
        [int]($hue / $count)
    }
    $yellow = { param($hue) $hue -ge 35 -and $hue -le 70 }
    # After each change, by whichever way, the bar has to say what plays.
    function Toggled([string]$how, [string]$want) {
        $now = WaitFor { param($p) $p.Status -eq $want } 10
        Check "$how -> $want" ($now -and $now.Status -eq $want) $now.Status
        $hue = ProgressHue "$($how -replace '\W', '-')-$want"
        WindowShot "window-$($how -replace '\W', '-')-$want" | Out-Null
        if ($button) {
            $right = if ($want -eq "Paused") { & $yellow $hue } else { $hue -ge 0 -and -not (& $yellow $hue) }
            Check "  taskbar progress shows $($want.ToLower())" $right "hue $hue"
        }
    }

    # The global shortcut: Ctrl+Alt+Shift+P pressed and let go.
    function Shortcut {
        foreach ($key in 0x11, 0x12, 0x10, 0x50) { [Native]::keybd_event($key, 0, 0, [UIntPtr]::Zero) }
        foreach ($key in 0x50, 0x10, 0x12, 0x11) { [Native]::keybd_event($key, 0, 2, [UIntPtr]::Zero) }
    }
    $hue = ProgressHue "before"
    WindowShot "window-before" | Out-Null
    if ($button) { Check "taskbar progress shows playing" ($hue -ge 0 -and -not (& $yellow $hue)) "hue $hue" }
    Shortcut; Toggled "global shortcut" "Paused"
    Shortcut; Toggled "global shortcut" "Playing"
    ThumbClick 2; Toggled "thumbnail Play / Pause" "Paused"
    ThumbClick 2; Toggled "thumbnail Play / Pause" "Playing"
    Start-Process $App -ArgumentList "--play-pause"; Toggled "--play-pause" "Paused"
    Start-Process $App -ArgumentList "--play-pause"; Toggled "--play-pause" "Playing"

    $first = Playing
    ThumbClick 4   # Next
    $now = WaitFor { param($p) $p.Title -ne $first.Title }
    Check "thumbnail Next goes to the next track" ($now -and $now.Title -ne $first.Title) "$($first.Title) -> $($now.Title)"

    $lists = Get-ChildItem $JumpLists -Filter *.customDestinations-ms | Where-Object {
        $bytes = [IO.File]::ReadAllBytes($_.FullName)
        $text = [Text.Encoding]::Unicode.GetString($bytes) + [Text.Encoding]::Unicode.GetString($bytes, 1, $bytes.Length - 1)
        $text.Contains("ytmusic-desktop.exe") -and $text.Contains("--play-pause") -and $text.Contains("--next") -and $text.Contains("--previous")
    }
    Check "jump list with play / pause, next and previous" ([bool]$lists) (($lists | ForEach-Object Name) -join ", ")

    # The now-playing page, for this machine only.
    Start-Sleep 2
    $web = New-Object Net.WebClient
    $web.Encoding = [Text.Encoding]::UTF8
    try { $json = $web.DownloadString("http://127.0.0.1:$Port/now-playing.json") | ConvertFrom-Json } catch { $json = $null }
    $now = Playing
    Check "now-playing page has the playing track" ($json -and $now -and $json.title -eq $now.Title) $(if ($json) { $json.title } else { "no answer" })
    $request = [Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/"); $request.Host = "example.com"
    try { $code = [int]$request.GetResponse().StatusCode } catch [Net.WebException] { $code = [int]$_.Exception.Response.StatusCode }
    Check "now-playing page refuses a foreign Host" ($code -eq 403) $code

    # A ytmusic:// link, as from a browser: Windows starts the program the installer named.
    $command = (Get-ItemProperty "$Scheme\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
    Check "ytmusic:// is handed to the app" ($command -eq "`"$App`" `"%1`"") $command
    Start-Process "ytmusic://watch?v=dQw4w9WgXcQ"
    $now = WaitFor { param($p) $p.Title -like "*Never Gonna Give You Up*" } 30
    Check "a ytmusic:// link opens its track" ($now -and $now.Title -like "*Never Gonna Give You Up*") $now.Title
    Check "still one window after the link" (@(Get-Process ytmusic-desktop | Where-Object { $_.MainWindowHandle -ne 0 }).Count -eq 1)

    # The sound's device, chosen with --output= as the tray menu does: where
    # Windows plays the WebView2 sound is read from its audio sessions.
    $now = Playing
    if (-not $now -or $now.Status -ne "Playing") { Start-Process $App -ArgumentList "--play-pause"; $null = WaitFor { param($p) $p.Status -eq "Playing" } }
    Start-Sleep 3
    $from = SoundOn
    $other = @([SoundDevices]::All() | Where-Object { $_ -ne $from -and $_ -notmatch "Hands-Free" }) | Select-Object -First 1
    if (-not $from -or $from -match "," -or -not $other) {
        Write-Output "SKIP  the sound's device (playing on: '$from', other devices: '$other')"
    } else {
        Check "the page may not use the microphone before" (MicBecomes $false)
        $clicked = TrayClick @("Output", "Ausgabe") @($other)
        for ($i = 0; $i -lt 30 -and (SoundOn) -ne $other; $i++) { Start-Sleep -Milliseconds 500 }
        Check "tray Output: the sound goes to another device" ($clicked -and (SoundOn) -eq $other) "clicked: $clicked, $from -> $(SoundOn)"
        $saved = (Get-Content (Join-Path $Config "settings.json") -Raw -Encoding UTF8 | ConvertFrom-Json).outputDevice
        Check "  the choice is saved" ($saved -eq $other) $saved
        $now = Playing
        Check "  the track plays on" ($now -and $now.Status -eq "Playing") $now.Status
        Check "  YouTube Music has the microphone permission meanwhile" (MicBecomes $true)
        $clicked = TrayClick @("Output", "Ausgabe") @("System default", "Systemstandard")
        for ($i = 0; $i -lt 30 -and (SoundOn) -ne $from; $i++) { Start-Sleep -Milliseconds 500 }
        Check "tray System default brings it back" ($clicked -and (SoundOn) -eq $from) "clicked: $clicked, $(SoundOn)"
        Check "  and takes the microphone permission back" (MicBecomes $false)

        Start-Process $App -ArgumentList "`"--output=$other`""
        for ($i = 0; $i -lt 30 -and (SoundOn) -ne $other; $i++) { Start-Sleep -Milliseconds 500 }
        Check "--output= does the same from outside" ((SoundOn) -eq $other) "$from -> $(SoundOn)"
        Check "  with the microphone permission meanwhile" (MicBecomes $true)
        Start-Process $App -ArgumentList "--output=default"
        for ($i = 0; $i -lt 30 -and (SoundOn) -ne $from; $i++) { Start-Sleep -Milliseconds 500 }
        Check "--output=default brings it back" ((SoundOn) -eq $from) "$(SoundOn)"
        Check "  and takes the microphone permission back" (MicBecomes $false)
    }

    # Save memory in the tray: started again with the setting at one minute, a
    # track plays, is paused, and the window goes to the tray. The page must
    # go, giving memory back, and Play / Pause must bring the track back playing.
    function WebViewMegabytes {
        $all = @(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe' OR Name = 'ytmusic-desktop.exe'")
        $ours = @($all | Where-Object { $_.Name -eq "ytmusic-desktop.exe" } | ForEach-Object ProcessId)
        do {
            $before = $ours.Count
            $ours = @($ours + @($all | Where-Object { $ours -contains $_.ParentProcessId } | ForEach-Object ProcessId) | Select-Object -Unique)
        } while ($ours.Count -gt $before)
        if ($ours.Count -eq 0) { return 0 }
        [int]((@(Get-Process -Id $ours -ErrorAction SilentlyContinue) | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB)
    }
    Stop-Process -Name ytmusic-desktop -Force -ErrorAction SilentlyContinue; Start-Sleep 3
    $settings = Get-Content (Join-Path $Config "settings.json") -Raw | ConvertFrom-Json
    $set = { param($name, $value) if ($settings.PSObject.Properties.Name -contains $name) { $settings.$name = $value } else { $settings | Add-Member $name $value } }
    & $set unloadAfterMinutes 1
    & $set minimizeToTray $true
    & $set resumePlayback $true
    [IO.File]::WriteAllText((Join-Path $Config "settings.json"), ($settings | ConvertTo-Json -Depth 20))
    Start-Process $App; Start-Sleep $Settle
    $now = Playing
    if (-not $now -or $now.Status -ne "Playing") { Start-Process $App -ArgumentList "--play-pause"; $now = WaitFor { param($p) $p.Status -eq "Playing" } 30 }
    $track = $now.Title
    Start-Sleep 5
    Start-Process $App -ArgumentList "--play-pause"
    $now = WaitFor { param($p) $p.Status -eq "Paused" }
    Start-Sleep 7   # the track and its place are saved every 5 seconds
    $window = MainWindow
    [Native]::PostMessageW($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null   # WM_CLOSE: to the tray
    Start-Sleep 5
    Check "the window goes to the tray when closed" ((-not [Native]::IsWindowVisible($window)) -and [bool](Get-Process ytmusic-desktop -ErrorAction SilentlyContinue))
    $loaded = WebViewMegabytes
    $low = $loaded
    for ($i = 0; $i -lt 30 -and $low -gt $loaded - 100; $i++) { Start-Sleep 5; $low = [Math]::Min($low, (WebViewMegabytes)) }
    Check "the page is unloaded after a minute's pause in the tray" ($low -le $loaded - 100) "$loaded MB -> $low MB"
    Start-Process $App -ArgumentList "--play-pause"
    $now = WaitFor { param($p) $p.Status -eq "Playing" -and $p.Title -eq $track } 60
    Check "Play / Pause loads it again and plays the same track" ($now -and $now.Status -eq "Playing" -and $now.Title -eq $track) "$($now.Status): $($now.Title) (was $track)"

    # The page check looks twice, the second time 20 seconds after a track starts.
    Start-Sleep 25
}
finally {
    if ($barState -band 1) { $appBar.lParam = [IntPtr]$barState; [Native]::SHAppBarMessage(10, [ref]$appBar) | Out-Null }
    $newLog = if (Test-Path $logFile) { @(Get-Content $logFile | Select-Object -Skip $logBefore) } else { @() }
    $stopped = "a plugin's frame tried to leave its document"
    Check "a plugin leaving its frame is stopped" ([bool]($newLog | Where-Object { $_ -like "*$stopped*" }))
    $missing = @($newLog | Where-Object { $_ -like "*parts of YouTube Music not found*" })
    Check "no part of YouTube Music missing" ($missing.Count -eq 0) ($missing -join " | ")
    $others = @($newLog | Where-Object { $_ -notlike "*$stopped*" -and $_ -notlike "*parts of YouTube Music not found*" })
    Check "no other lines in the app's log" ($others.Count -eq 0) ($others -join " | ")

    Stop-Process -Name ytmusic-desktop -Force -ErrorAction SilentlyContinue; Start-Sleep 3
    if ($hadApp) { Copy-Item (Join-Path $Backup "ytmusic-desktop.exe") $App -Force }
    Copy-Item (Join-Path $Backup "settings.json") (Join-Path $Config "settings.json") -Force
    Remove-Item -Recurse -Force $TestPlugin -ErrorAction SilentlyContinue
    if ($null -eq $runBefore) { Remove-ItemProperty $Run -Name $RunName -ErrorAction SilentlyContinue } else { Set-ItemProperty $Run -Name $RunName -Value $runBefore }
    Get-ChildItem $JumpLists -Filter *.customDestinations-ms -ErrorAction SilentlyContinue |
        Where-Object { $jumpBefore -notcontains $_.Name } | Remove-Item -Force
    if (-not $hadScheme) { Remove-Item -Recurse -Force $Scheme -ErrorAction SilentlyContinue }
    Start-Process $App
    Write-Output "put back: program, settings.json, test plugin, autostart entry, jump list, link handler; the app runs again"
}
Write-Output $(if ($failed) { "$failed check(s) failed" } else { "all checks passed" })
exit $failed
