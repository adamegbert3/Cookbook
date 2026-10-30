on run
    try
        my runHelper("start")
    on error messageText
        display dialog messageText with title "Cookbook Scanner" buttons {"OK"} default button "OK" with icon caution
        quit
    end try
end run

on reopen
    my run()
end reopen

on idle
    return 60
end idle

on quit
    try
        my runHelper("stop")
    end try
    continue quit
end quit

on runHelper(actionName)
    set resourcesPath to (POSIX path of (path to me)) & "Contents/Resources/"
    set scriptPath to resourcesPath & "mac-launcher.mjs"
    set commandText to "export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin; if ! command -v node >/dev/null 2>&1; then echo 'Install Node.js LTS from nodejs.org, then reopen Cookbook Scanner.' >&2; exit 1; fi; exec node " & quoted form of scriptPath & " " & quoted form of actionName
    do shell script commandText
end runHelper
