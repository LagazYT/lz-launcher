# LZ Launcher

App em Python (pywebview) para Windows. Lógica em `gamevault/`, interface em `ui/` (HTML/JS/CSS).
Textos do app em português, inglês e espanhol: mensagens do Python em `gamevault/i18n.py`, da interface em `ui/i18n.js`.

## Rodar pelo código
- Ambiente: `.venv` com Python 3.11 (`.venv\Scripts\python.exe -m pip install -r requirements.txt pyinstaller`).
- Abrir: `Iniciar LZ Launcher (sem compilar).bat`. Usa os mesmos dados do app instalado (`%APPDATA%\LZ Launcher`), então feche o instalado antes.

## Como publicar uma versão (fazer sempre depois de cada mudança)
1. Subir `APP_VERSION` em `gamevault/__init__.py` (correção: x.y.Z+1; recurso novo: x.Y+1.0).
2. Commit em português e `git push origin main`.
3. Criar a release com a tag igual à versão:
   `gh release create vX.Y.Z --title "LZ Launcher X.Y.Z" --notes-file <notas.md>`
   Notas em português no estilo das anteriores: `## Novidades` / `## Correções`, itens com negrito, e no fim
   `**Downloads:** \`LZ-Launcher-Setup-X.Y.Z.exe\` (instalador) ou \`LZ-Launcher-Portable-X.Y.Z.zip\` (portable, sem instalar).`
4. O workflow `.github/workflows/release.yml` gera o instalador e o portable e anexa os dois à release (~5 min).
   Conferir com `gh run list` e `gh release view vX.Y.Z`.

A atualização automática (`gamevault/updater.py`) lê a última release de `LagazYT/lz-launcher` e baixa
`setup*.exe` (instalado) ou `portable*.zip` (portable). Sem esses dois arquivos na release, ninguém atualiza.
