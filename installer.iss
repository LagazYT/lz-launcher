; Instalador do LZ Launcher (Inno Setup 6)
; Gerado pelo build.ps1:  ISCC /DAppVersion=x.y.z /DSourceDir=build\dist\LZ Launcher installer.iss

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "build\dist\LZ Launcher"
#endif

[Setup]
AppId={{8F3C2A51-6B7E-4E2D-9C1A-5D7B2F4E9A10}
AppName=LZ Launcher
AppVersion={#AppVersion}
AppVerName=LZ Launcher {#AppVersion}
AppPublisher=LagazYT
AppPublisherURL=https://github.com/LagazYT/lz-launcher
AppSupportURL=https://github.com/LagazYT/lz-launcher/issues
AppUpdatesURL=https://github.com/LagazYT/lz-launcher/releases
DefaultDirName={localappdata}\Programs\LZ Launcher
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputDir=release
OutputBaseFilename=LZ-Launcher-Setup-{#AppVersion}
SetupIconFile=lzlauncher.ico
UninstallDisplayIcon={app}\LZ Launcher.exe
UninstallDisplayName=LZ Launcher
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; remove os arquivos da versão anterior antes de copiar os novos
Type: filesandordirs; Name: "{app}\runtime"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\LZ Launcher"; Filename: "{app}\LZ Launcher.exe"
Name: "{autodesktop}\LZ Launcher"; Filename: "{app}\LZ Launcher.exe"; Tasks: desktopicon

[Run]
; também roda nas atualizações silenciosas, para o app abrir de novo já atualizado
Filename: "{app}\LZ Launcher.exe"; Description: "{cm:LaunchProgram,LZ Launcher}"; Flags: nowait postinstall
