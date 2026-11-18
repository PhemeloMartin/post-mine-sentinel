using System.Security.Cryptography;
using System.Text;

namespace Sentinel.Cases.Domain;

/// <summary>
/// SHA-256 hash chaining (same construction as the API's audit log):
/// h₀ = SHA-256("GENESIS"), hᵢ = SHA-256(hᵢ₋₁ ‖ payloadᵢ).
/// Any edit, insertion or deletion breaks every later link.
/// </summary>
public static class HashChain
{
    public static readonly string Genesis = Sha256Hex("GENESIS");

    public static string Sha256Hex(string text) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)));

    public static string Link(string previous, string payload) => Sha256Hex(previous + payload);
}
