using System.Text.Json.Serialization;

namespace ImmortalityClipTracker;

/// <summary>What the page asks the shell to do, and the language its dialogs should use.</summary>
internal sealed record Request
{
    [JsonPropertyName("cmd")] public string? Cmd { get; init; }
    [JsonPropertyName("path")] public string? Path { get; init; }
    [JsonPropertyName("lang")] public string? Lang { get; init; }
}

/// <summary>
/// The save, or why it could not be produced: a code the page words in its own
/// language, the file's name and, for some codes, the folders searched or the
/// system's own message.
/// </summary>
internal sealed record Reply
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("cancelled")] public bool Cancelled { get; init; }
    [JsonPropertyName("path")] public string? Path { get; init; }
    [JsonPropertyName("data")] public string? Data { get; init; }
    [JsonPropertyName("code")] public string? Code { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("detail")] public string? Detail { get; init; }
}

// Source-generated so the shell can publish trimmed; reflection-based
// serialisation would be stripped out and fail at runtime.
[JsonSourceGenerationOptions(DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(Request))]
[JsonSerializable(typeof(Reply))]
internal sealed partial class ShellJson : JsonSerializerContext;
