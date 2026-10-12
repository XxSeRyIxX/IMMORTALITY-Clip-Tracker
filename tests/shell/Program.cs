using System.Text;
using ImmortalityClipTracker;

async Task<string?> ReadTarget(string request, int chunkSize = 3)
{
    using ChunkedStream stream = new(Encoding.ASCII.GetBytes(request), chunkSize);
    return await SiteServer.ReadRequestTarget(stream);
}

void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

foreach (int size in new[] { 1, 3, 512 })
{
    Check(await ReadTarget("GET /index.html?test=1 HTTP/1.1\r\nHost: localhost\r\n\r\n", size) == "/index.html?test=1",
        $"Request parsing failed for {size}-byte chunks.");
}
Check(await ReadTarget("POST / HTTP/1.1\r\n\r\n") is null, "Non-GET requests must be rejected.");
Check(await ReadTarget("GET / HTTP/1.1\r\nHost: localhost") is null, "Incomplete headers must be rejected.");
Check(await ReadTarget("GET / HTTP/1.1\r\nHeader: " + new string('x', 8192) + "\r\n\r\n") is null,
    "Oversized headers must be rejected.");

string folder = Path.Combine(Path.GetTempPath(), "ict-shell-checks-" + Guid.NewGuid());
Directory.CreateDirectory(Path.Combine(folder, "account"));
try
{
    string first = Path.Combine(folder, "SaveGame.abr");
    string second = Path.Combine(folder, "account", "SaveGame.abr");
    string other = Path.Combine(folder, "SaveThumbnail.abr");
    File.WriteAllText(first, "fixture");
    File.WriteAllText(second, "fixture");
    File.WriteAllText(other, "fixture");
    IEnumerable<string> Scan(string root) => SaveLocator.SafeEnumerate(root);
    Check(new HashSet<string>(Scan(folder)).SetEquals([first, second]), "Save scanning returned the wrong files.");
    Check(!Scan(Path.Combine(folder, "missing")).Any(), "A missing folder must be skipped.");
    Check(!Scan(other).Any(), "A file used as a folder must be skipped.");
}
finally
{
    Directory.Delete(folder, true);
}

Console.WriteLine("Desktop checks passed: fragmented requests, header validation and safe save scanning.");

sealed class ChunkedStream(byte[] bytes, int chunkSize) : MemoryStream(bytes)
{
    public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
        base.ReadAsync(buffer[..Math.Min(buffer.Length, chunkSize)], cancellationToken);
}