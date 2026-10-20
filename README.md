<p align="center"><img src="logo.png" width="128" alt="LZ Launcher"></p>

# LZ Launcher

Biblioteca e launcher para Windows que junta num lugar só os seus **jogos recompilados**
(ports nativos de jogos de PS4, PS3, Xbox etc.) e os seus **jogos de PC**, com capas,
tempo de jogo e atualização automática.

## Download

Na página de [Releases](https://github.com/LagazYT/lz-launcher/releases/latest):

| Arquivo | Para quem |
|---|---|
| `LZ-Launcher-Setup-x.y.z.exe` | Instalador. Cria atalhos no Menu Iniciar/Área de Trabalho e não precisa de administrador. |
| `LZ-Launcher-Portable-x.y.z.zip` | Versão portable. Extraia em qualquer pasta (até num pendrive) e abra `LZ Launcher.exe`. Os dados ficam na pasta `data` ao lado do programa. |

Requer Windows 10/11 64 bits (usa o WebView2 que já vem no Windows).

## Recursos

- **Recompilados · Jogos de PC · Todos** na barra lateral, além de Favoritos, Jogados recentemente e Ocultos.
- **Adicionar pasta de jogos**: cada subpasta vira um jogo, reconhecido automaticamente.
  - Ports recompilados: dumps de PS4/PS5 (`CUSAxxxxx/sce_sys/param.sfo`), PS3 (`PS3_GAME`),
    Xbox One (`AppxManifest.xml`) e marcadores de ports (`out/analysis.json`, `eboot.bin`,
    `Play <Jogo>.exe`, nomes com *PC Port*/*recomp*...). O nome vem do próprio dump.
  - Jogos da **Steam** e da **Epic Games** instalados no PC também aparecem (opcional).
- **Capas e fundos** automáticos: arte do próprio jogo, Steam, Wikipédia e SteamGridDB (chave opcional). Dá para trocar por qualquer imagem.
- **Tempo de jogo**, última vez jogado e sessões — conta mesmo quando o jogo é aberto fora do launcher.
- Modo **grade** ou **lista**, busca e ordenação.
- Temas **Sóbrio** e **Neon**.
- Fechar a janela **minimiza para a bandeja** (opcional).
- **Atualização automática**: o app verifica as releases deste repositório, avisa quando sai uma versão nova e atualiza com um clique (instalador ou portable).

O LZ Launcher nunca altera nada dentro das pastas dos jogos.

## Desenvolvimento

```powershell
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python main.py
```

`dev_server.py` sobe só a interface num servidor local para testar no navegador.

### Gerar uma versão

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

Cria em `release\` o instalador e o `.zip` portable (precisa do [Inno Setup 6](https://jrsoftware.org/isdl.php) e do PyInstaller).

### Publicar uma atualização

1. Aumente `APP_VERSION` em `gamevault/__init__.py` (ex.: `1.2.1`) e faça commit/push.
2. Crie a release: `gh release create v1.2.1 --title "LZ Launcher 1.2.1" --notes "O que mudou..."`
3. O GitHub Actions gera e anexa o instalador e o portable à release.
   Os apps instalados detectam a versão nova e oferecem a atualização.
