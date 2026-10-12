using System.Net.Sockets;
using System.Text.Json;
using Photino.NET;

namespace ImmortalityClipTracker;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        using Mutex instance = new(false, "ImmortalityClipTracker");
        try
        {
            if (!instance.WaitOne(0)) return;
        }
        catch (AbandonedMutexException) { }

        try
        {
            RunWindow(args);
        }
        finally
        {
            instance.ReleaseMutex();
        }
    }

    private static void RunWindow(string[] args)
    {
        PhotinoWindow window = new PhotinoWindow()
            .SetTitle("IMMORTALITY Clip Tracker")
            .SetUseOsDefaultSize(false)
            // Wide enough that the clip list keeps its side detail pane rather
            // than falling back to the narrow, collapsing layout.
            .SetSize(1500, 900)
            .SetMinSize(420, 480)
            .Center()
            .SetContextMenuEnabled(false)
            .SetDevToolsEnabled(args.Contains("--dev"));

        try
        {
            using SiteServer site = new();
            window.RegisterWebMessageReceivedHandler(OnMessage);
            window.Load(new Uri($"http://127.0.0.1:{site.Port}/index.html"));
            window.WaitForClose();
        }
        catch (SocketException)
        {
            window.LoadRawString($"""
                <!doctype html>
                <html lang="en">
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>IMMORTALITY Clip Tracker</title>
                <body style="font:16px/1.5 system-ui;max-width:42rem;margin:2rem auto;padding:0 1.5rem;color:#ddd;background:#0a0908">
                <h1 style="font-size:1.5rem">IMMORTALITY Clip Tracker</h1>
                <p>Local port {SiteServer.StablePort} is unavailable.</p>
                <p>Close other copies of the tracker or free this port, then reopen the app.
                Your saved marks have not been changed.</p>
                </body>
                </html>
                """);
            window.WaitForClose();
        }
    }

    // A real save is tens of kilobytes. SaveThumbnail.abr in the same folder tree
    // runs to hundreds of megabytes, and base64 of that overflows what JSON can
    // carry, so the size is checked before the file is ever read.
    private const long MaxSaveBytes = 32L * 1024 * 1024;

    private static void OnMessage(object? sender, string message)
    {
        if (sender is not PhotinoWindow window) return;

        string payload;
        try
        {
            Request? request = JsonSerializer.Deserialize(message, ShellJson.Default.Request);
            Reply reply = request?.Cmd switch
            {
                "find" => Find(),
                "open" => Open(window),
                "read" => Read(request.Path),
                _ => Fail("Unknown command.", null),
            };
            payload = JsonSerializer.Serialize(reply, ShellJson.Default.Reply);
        }
        catch (Exception e)
        {
            // Nothing here is worth taking the window down for.
            payload = JsonSerializer.Serialize(
                Fail("The app could not read that file.", e.Message),
                ShellJson.Default.Reply);
        }

        window.SendWebMessage(payload);
    }

    private static Reply Find()
    {
        string? path = SaveLocator.Find();
        return path is null
            ? Fail("No save found on this machine.",
                "Checked:\n" + string.Join('\n', SaveLocator.SearchedFolders()))
            : Read(path);
    }

    /// <summary>A native dialog, opened at the save folder rather than wherever the OS last was.</summary>
    private static Reply Open(PhotinoWindow window)
    {
        string[] picked = window.ShowOpenFile(
            "Choose your IMMORTALITY save",
            SaveLocator.StartFolder(),
            false,
            [("IMMORTALITY save", ["abr"]), ("All files", ["*"])]);

        return picked is { Length: > 0 } ? Read(picked[0]) : new Reply { Cancelled = true };
    }

    private static Reply Read(string? path)
    {
        if (string.IsNullOrEmpty(path)) return Fail("No file was given.", null);

        FileInfo file = new(path);
        if (!file.Exists) return Fail($"\u201C{file.Name}\u201D is no longer there.", "Choose it again.");

        if (file.Length > MaxSaveBytes)
        {
            return Fail($"\u201C{file.Name}\u201D is too big to be a save.",
                "An IMMORTALITY save is well under a megabyte. SaveThumbnail.abr holds the "
                + "preview images and is not the file you want. Look for SaveGame.abr.");
        }

        byte[] bytes = File.ReadAllBytes(path);
        if (!LooksLikeSave(bytes))
        {
            return Fail($"\u201C{file.Name}\u201D is not an IMMORTALITY save.",
                "The file you want is called SaveGame.abr.");
        }

        return new Reply { Ok = true, Path = path, Data = Convert.ToBase64String(bytes) };
    }

    /// <summary>An MS-NRBF stream opens with record type 0 and the version pair 1.0.</summary>
    private static bool LooksLikeSave(byte[] bytes) =>
        bytes.Length >= 17
        && bytes[0] == 0
        && BitConverter.ToInt32(bytes, 9) == 1
        && BitConverter.ToInt32(bytes, 13) == 0;

    private static Reply Fail(string error, string? hint) => new() { Ok = false, Error = error, Hint = hint };
}
