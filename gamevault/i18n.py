"""Traduções das mensagens geradas pelo programa (a interface tem as suas em ui/i18n.js)."""
import ctypes

LANGS = ("pt", "en", "es")

_T = {
    "Procurando jogos...": {"en": "Looking for games...", "es": "Buscando juegos..."},
    "Lendo biblioteca da Steam...": {"en": "Reading Steam library...", "es": "Leyendo la biblioteca de Steam..."},
    "Lendo jogos da {store}...": {"en": "Reading {store} games...", "es": "Leyendo juegos de {store}..."},
    "Escaneando {path}...": {"en": "Scanning {path}...", "es": "Escaneando {path}..."},
    "Jogo não encontrado.": {"en": "Game not found.", "es": "Juego no encontrado."},
    "Executável não existe mais:\n{path}": {"en": "The executable no longer exists:\n{path}",
                                            "es": "El ejecutable ya no existe:\n{path}"},
    "Nenhum executável definido para este jogo. Use \"Editar\" para escolher o .exe.": {
        "en": "No executable set for this game. Use \"Edit\" to choose the .exe.",
        "es": "No hay ejecutable definido para este juego. Usa \"Editar\" para elegir el .exe."},
    "Pasta inválida.": {"en": "Invalid folder.", "es": "Carpeta no válida."},
    "Essa pasta já está na biblioteca.": {"en": "This folder is already in the library.",
                                          "es": "Esta carpeta ya está en la biblioteca."},
    "Não foi possível verificar atualizações (sem internet?).": {
        "en": "Could not check for updates (no internet?).", "es": "No se pudo buscar actualizaciones (¿sin internet?)."},
    "Falha ao baixar a atualização. Tente de novo.": {"en": "Failed to download the update. Try again.",
                                                      "es": "No se pudo descargar la actualización. Inténtalo de nuevo."},
    "Rodando pelo código-fonte: atualize com git pull. Abrindo a página da release…": {
        "en": "Running from source: update with git pull. Opening the release page…",
        "es": "Ejecutando desde el código fuente: actualiza con git pull. Abriendo la página de la versión…"},
    "Nenhuma atualização disponível.": {"en": "No update available.", "es": "No hay actualizaciones disponibles."},
    "Falha ao instalar: {error}": {"en": "Failed to install: {error}", "es": "Error al instalar: {error}"},
    "Abrir {app}": {"en": "Open {app}", "es": "Abrir {app}"},
    "Sair": {"en": "Quit", "es": "Salir"},
    "O {app} continua aberto aqui na bandeja. Clique duas vezes no ícone para voltar.": {
        "en": "{app} is still running here in the tray. Double-click the icon to bring it back.",
        "es": "{app} sigue abierto aquí en la bandeja. Haz doble clic en el icono para volver."},
    "Nova versão {version} do {app} disponível.": {"en": "{app} {version} is available.",
                                                   "es": "Nueva versión {version} de {app} disponible."},
}


def system_lang() -> str:
    try:
        primary = ctypes.windll.kernel32.GetUserDefaultUILanguage() & 0x3FF
        return {0x16: "pt", 0x0A: "es"}.get(primary, "en")
    except Exception:
        return "pt"


def resolve(setting: str | None) -> str:
    return setting if setting in LANGS else system_lang()


def tr(text: str, lang: str, **kw) -> str:
    out = _T.get(text, {}).get(lang, text) if lang != "pt" else text
    return out.format(**kw) if kw else out
