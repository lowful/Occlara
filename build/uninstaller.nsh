; Occlara uninstall cleanup.
; Deletes the player's local data (coached sessions, performance history,
; match summaries, logs, the match recording, the AI log's frames, and
; Electron caches) but
; deliberately KEEPS the config file, which holds the license, the Riot ID,
; and the cached Valorant tracker profile, so a reinstall picks up right where
; the player left off.
;
; The ${isUpdated} guard matters: NSIS runs this uninstaller during every
; auto-update too, and an update must NEVER touch the player's data. Only a
; real uninstall cleans up.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; The current profile folder.
    RMDir /r "$APPDATA\Occlara\sessions"
    RMDir /r "$APPDATA\Occlara\match-summaries"
    Delete "$APPDATA\Occlara\performance.json"
    Delete "$APPDATA\Occlara\debug.log"
    RMDir /r "$APPDATA\Occlara\Cache"
    RMDir /r "$APPDATA\Occlara\Code Cache"
    RMDir /r "$APPDATA\Occlara\GPUCache"
    RMDir /r "$APPDATA\Occlara\DawnGraphiteCache"
    RMDir /r "$APPDATA\Occlara\DawnWebGPUCache"
    RMDir /r "$APPDATA\Occlara\blob_storage"
    RMDir /r "$APPDATA\Occlara\Local Storage"
    RMDir /r "$APPDATA\Occlara\Session Storage"
    RMDir /r "$APPDATA\Occlara\Shared Dictionary"
    RMDir /r "$APPDATA\Occlara\Dictionaries"
    RMDir /r "$APPDATA\Occlara\logs"
    ; The match recorded on the PC (8.3): the primary display, a held match and
    ; the five minutes after it. The app deletes it at quit and sweeps it at
    ; launch, but the uninstaller kills the app first and there is no launch
    ; after it, so it would stay for good. The clips beside the reviews stay
    ; with the reviews, as the reviews always have.
    RMDir /r "$APPDATA\Occlara\recording"
    ; The AI log: frames of the player's screen from the last five sessions,
    ; every one of the last three minutes and around each death and one in ten
    ; seconds of the rest. The app prunes it only at a Start, so it too stayed
    ; for good. A review keeps the frames it looked at itself.
    RMDir /r "$APPDATA\Occlara\ai-log"

    ; And the pre-rename one. A player who uninstalls without ever having
    ; launched a build new enough to migrate still has everything under the
    ; old name, and uninstall should not strand it on their disk.
    RMDir /r "$APPDATA\GhostCoach 2.0\sessions"
    RMDir /r "$APPDATA\GhostCoach 2.0\match-summaries"
    Delete "$APPDATA\GhostCoach 2.0\performance.json"
    Delete "$APPDATA\GhostCoach 2.0\debug.log"
    RMDir /r "$APPDATA\GhostCoach 2.0\Cache"
    RMDir /r "$APPDATA\GhostCoach 2.0\Code Cache"
    RMDir /r "$APPDATA\GhostCoach 2.0\GPUCache"
    RMDir /r "$APPDATA\GhostCoach 2.0\DawnGraphiteCache"
    RMDir /r "$APPDATA\GhostCoach 2.0\DawnWebGPUCache"
    RMDir /r "$APPDATA\GhostCoach 2.0\blob_storage"
    RMDir /r "$APPDATA\GhostCoach 2.0\Local Storage"
    RMDir /r "$APPDATA\GhostCoach 2.0\Session Storage"
    RMDir /r "$APPDATA\GhostCoach 2.0\Shared Dictionary"
    RMDir /r "$APPDATA\GhostCoach 2.0\Dictionaries"
    RMDir /r "$APPDATA\GhostCoach 2.0\logs"
    ; A migration that failed keeps using this folder (profile-migration.js).
    RMDir /r "$APPDATA\GhostCoach 2.0\recording"
    RMDir /r "$APPDATA\GhostCoach 2.0\ai-log"
  ${endIf}
!macroend
